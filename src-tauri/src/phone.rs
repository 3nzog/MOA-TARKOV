// The map on a phone on the same Wi-Fi: this PC serves the app's own page over
// plain HTTP on the home network (port 8791) and streams the map state (map,
// position, floor, exits, quests, squadmates, raid clock) over a WebSocket.
//
// - Only from this PC or its home network (same router). Not Radmin, not the
//   internet.
// - The page itself is the app's bundle (public anyway); the live data needs
//   the key carried by the QR code. A new key cuts off every phone.
// - Read-only: a phone only receives. All it may send is a tiny ping, answered
//   at once with the PC's clock: the page measures the delay with it, and the
//   steady trickle keeps the phone's Wi-Fi from dozing between screenshots
//   (a dozing phone gets each packet up to a few hundred ms late).
// - Everything else the PC's map draws (map intel, quest pins, markers,
//   drawings, the party's, hot zones) comes on its own frame, `{"layers":…}`,
//   only when it changes and to each phone that connects.
// - A screenshot's position also comes straight from the screenshot watcher
//   (`publish_pos`), not only inside the app's next map state: the app's window
//   sits behind the game, where its page runs slowly, and that cost the phone
//   most of a second.

use futures_util::{Sink, SinkExt, StreamExt};
use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http;
use tokio_tungstenite::tungstenite::protocol::Message;

use crate::net::{self, LocalNet, NetKind};

pub const PHONE_PORT: u16 = 8791;
/// Biggest state frame accepted from the app.
const STATE_MAX: usize = 512 * 1024;
/// Biggest layers frame (every marker of the map) accepted from the app.
const LAYERS_MAX: usize = 4 * 1024 * 1024;
const MAX_CLIENTS: usize = 8;
const HEAD_MAX: usize = 8 * 1024;
const HEAD_WAIT: Duration = Duration::from_secs(5);
/// How long a finished reply waits for the browser to close its side.
const CLOSE_WAIT: Duration = Duration::from_secs(3);
/// With nothing new to send, a phone still hears from the PC this often. The
/// page takes a long silence for a dead link: a phone asleep while the PC gave
/// up on it is never told, and would wait forever on a link that is gone. It
/// also keeps phones' Wi-Fi from dropping an idle socket.
#[cfg(not(test))]
const HEARTBEAT: Duration = Duration::from_secs(10);
#[cfg(test)]
const HEARTBEAT: Duration = Duration::from_millis(150);
/// The heartbeat. Not a map state (no points), so any page, old ones too, skips it.
const HEARTBEAT_FRAME: &str = r#"{"hb":1}"#;
/// Biggest message a phone may send (a ping is ~25 bytes).
const PING_MAX: usize = 64;
/// A phone that stops reading (a frozen page) is let go after this long.
#[cfg(not(test))]
const SEND_WAIT: Duration = Duration::from_secs(15);
#[cfg(test)]
const SEND_WAIT: Duration = Duration::from_millis(300);

/// An app file by path ("index.html", "assets/x.js") → (bytes, mime type).
pub type AssetsFn = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;
/// Whether a peer may connect.
pub type AllowFn = Arc<dyn Fn(&IpAddr) -> bool + Send + Sync>;

pub struct Handle {
    stop: watch::Sender<bool>,
    state: watch::Sender<Arc<String>>,
    pos: watch::Sender<Arc<String>>,
    layers: watch::Sender<Arc<String>>,
    clients: Arc<AtomicUsize>,
    #[cfg_attr(not(test), allow(dead_code))]
    pub port: u16,
}

impl Handle {
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
    pub fn publish(&self, json: String) {
        let _ = self.state.send(Arc::new(json));
    }
    /// A position frame (`{"pos":{…}}`), sent to the phones ahead of the next map state.
    pub fn publish_pos(&self, json: String) {
        let _ = self.pos.send(Arc::new(json));
    }
    /// Everything the map draws (`{"layers":{…}}`), sent when it changes and to each new phone.
    pub fn publish_layers(&self, json: String) {
        let _ = self.layers.send(Arc::new(json));
    }
    pub fn clients(&self) -> usize {
        self.clients.load(Ordering::Relaxed)
    }
}

/// A phone may connect from the home network, or over Tailscale when this PC
/// is on Tailscale (the player's own devices; the key is still needed).
pub fn phone_peer(peer: &IpAddr, nets: &[LocalNet], tailscale: Option<Ipv4Addr>) -> bool {
    home_peer(peer, nets) || (tailscale.is_some() && matches!(peer, IpAddr::V4(v4) if net::is_tailscale(*v4)))
}

/// This PC or a PC/phone on its home network (Wi-Fi, same router).
pub fn home_peer(peer: &IpAddr, nets: &[LocalNet]) -> bool {
    let lan: Vec<LocalNet> = nets.iter().filter(|n| n.kind == NetKind::Lan).copied().collect();
    net::peer_allowed(peer, &lan, true)
}

/// The phone page's address on each home network of this PC, the one the PC
/// reaches the internet through (`router`: the router's network, where the
/// phone's Wi-Fi is) first. A virtual adapter (Hyper-V / WSL "Default Switch",
/// 172.x, VirtualBox…) also looks like a home network but no phone reaches it:
/// in first place it made the QR code a page that "cannot be reached".
pub fn phone_urls(nets: &[LocalNet], port: u16, key: &str, router: Option<Ipv4Addr>) -> Vec<String> {
    let mut ips: Vec<Ipv4Addr> = nets.iter().filter(|n| n.kind == NetKind::Lan).map(|n| n.ip).collect();
    ips.dedup();
    if let Some(r) = router {
        ips.sort_by_key(|ip| *ip != r);
    }
    ips.into_iter().map(|ip| format!("http://{ip}:{port}/?view=phone&k={key}")).collect()
}

pub async fn start(bind: Ipv4Addr, port: u16, key: String, assets: AssetsFn, allow: AllowFn) -> Result<Handle, String> {
    // Restarting (a new key, off and on again): the old server lets go of the
    // port a moment after it is told to stop, so a busy port is tried again
    // for a little while before it counts as another program's.
    let mut tries = 0;
    let listener = loop {
        match TcpListener::bind(SocketAddr::from((bind, port))).await {
            Ok(l) => {
                net::no_inherit(&l);
                break l;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse && tries < 15 => {
                tries += 1;
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return Err("port_busy".to_string()),
            Err(e) => return Err(e.to_string()),
        }
    };
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let (stop, stop_rx) = watch::channel(false);
    let (state, state_rx) = watch::channel(Arc::new(String::new()));
    let (pos, pos_rx) = watch::channel(Arc::new(String::new()));
    let (layers, layers_rx) = watch::channel(Arc::new(String::new()));
    let clients = Arc::new(AtomicUsize::new(0));
    let key = Arc::new(key);
    let c2 = clients.clone();
    tauri::async_runtime::spawn(async move {
        let mut stop_rx2 = stop_rx.clone();
        loop {
            tokio::select! {
                _ = stop_rx2.changed() => break,
                r = listener.accept() => {
                    let Ok((stream, peer)) = r else { continue };
                    net::no_inherit(&stream);
                    if !allow(&peer.ip()) {
                        continue;
                    }
                    let feeds = Feeds { state: state_rx.clone(), pos: pos_rx.clone(), layers: layers_rx.clone(), stop: stop_rx.clone() };
                    tauri::async_runtime::spawn(serve(stream, assets.clone(), key.clone(), feeds, c2.clone()));
                }
            }
        }
    });
    Ok(Handle { stop, state, pos, layers, clients, port })
}

/// What a phone's link listens to: map states, positions, the map's layers, and the stop.
struct Feeds {
    state: watch::Receiver<Arc<String>>,
    pos: watch::Receiver<Arc<String>>,
    layers: watch::Receiver<Arc<String>>,
    stop: watch::Receiver<bool>,
}

/// Reads the request head without consuming it (a WebSocket handshake reads it
/// again). Gives the head and its length in bytes, blank line included.
async fn peek_head(stream: &TcpStream) -> Option<(String, usize)> {
    let mut buf = vec![0u8; HEAD_MAX];
    let deadline = tokio::time::Instant::now() + HEAD_WAIT;
    loop {
        let n = tokio::time::timeout_at(deadline, stream.peek(&mut buf)).await.ok()?.ok()?;
        if n == 0 {
            return None;
        }
        if let Some(end) = buf[..n].windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8(buf[..end].to_vec()).ok()?;
            return Some((head, end + 4));
        }
        if n == HEAD_MAX {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
    }
}

/// "/assets/x.js?v=1" → "assets/x.js"; "/" → "index.html"; anything odd → None.
pub fn asset_path(target: &str) -> Option<String> {
    let path = target.split(['?', '#']).next()?;
    let path = path.strip_prefix('/')?;
    let path = if path.is_empty() { "index.html" } else { path };
    let ok = path.len() <= 200
        && !path.contains("..")
        && !path.starts_with('/')
        && path.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'/' | b'-' | b'_'));
    ok.then(|| path.to_string())
}

/// The key in "/ws?k=KEY".
fn ws_key_ok(uri: &http::Uri, key: &str) -> bool {
    uri.path() == "/ws"
        && uri
            .query()
            .unwrap_or("")
            .split('&')
            .any(|kv| kv.strip_prefix("k=").is_some_and(|v| !key.is_empty() && v == key))
}

async fn serve(
    stream: TcpStream,
    assets: AssetsFn,
    key: Arc<String>,
    feeds: Feeds,
    clients: Arc<AtomicUsize>,
) {
    let _ = stream.set_nodelay(true);
    let Some((head, head_len)) = peek_head(&stream).await else { return };
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or("");
    let mut parts = first.split(' ');
    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let upgrade = lines.any(|l| {
        let l = l.to_ascii_lowercase();
        l.starts_with("upgrade:") && l.contains("websocket")
    });
    if upgrade {
        serve_ws(stream, key, feeds, clients).await;
    } else {
        serve_http(stream, method, target, head_len, assets).await;
    }
}

async fn serve_http(mut stream: TcpStream, method: &str, target: &str, head_len: usize, assets: AssetsFn) {
    // Take the request off the connection first. On Windows, closing a
    // connection that still holds unread data resets it, and the browser then
    // loses the end of the reply: a small file may get through, the app's
    // script never arrives whole, and the phone page stays blank.
    let mut head = vec![0u8; head_len];
    if stream.read_exact(&mut head).await.is_err() {
        return;
    }
    let found = if method == "GET" { asset_path(target).and_then(|p| assets(&p).map(|a| (p, a))) } else { None };
    let reply = match found {
        Some((path, (bytes, mime))) => {
            // index.html changes with every app update; the hashed bundles never do.
            let cache = if path == "index.html" { "no-cache" } else { "public, max-age=604800" };
            let mut r = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: {cache}\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
                bytes.len()
            )
            .into_bytes();
            r.extend_from_slice(&bytes);
            r
        }
        None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
    };
    if stream.write_all(&reply).await.is_err() {
        return;
    }
    let _ = stream.flush().await;
    // Close gently: say the reply is over, then let the browser close first,
    // taking whatever else it sends so nothing is left unread.
    let _ = stream.shutdown().await;
    let mut sink = [0u8; 4096];
    let _ = tokio::time::timeout(CLOSE_WAIT, async {
        while matches!(stream.read(&mut sink).await, Ok(n) if n > 0) {}
    })
    .await;
}

async fn serve_ws(
    stream: TcpStream,
    key: Arc<String>,
    feeds: Feeds,
    clients: Arc<AtomicUsize>,
) {
    let Feeds { state: mut state_rx, pos: mut pos_rx, layers: mut layers_rx, stop: mut stop_rx } = feeds;
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        if ws_key_ok(req.uri(), &key) && clients.load(Ordering::Relaxed) < MAX_CLIENTS {
            Ok(resp)
        } else {
            let mut e = ErrorResponse::new(Some("forbidden".into()));
            *e.status_mut() = http::StatusCode::FORBIDDEN;
            Err(e)
        }
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, check).await else { return };
    clients.fetch_add(1, Ordering::Relaxed);
    net::log("celular: um celular abriu o mapa");
    let (mut sink, mut source) = ws.split();
    let first = state_rx.borrow_and_update().clone();
    // The first state already holds the latest position.
    pos_rx.borrow_and_update();
    let mut ok = first.is_empty() || send_within(&mut sink, Message::text(first.as_str())).await;
    let layers = layers_rx.borrow_and_update().clone();
    if ok && !layers.is_empty() {
        ok = send_within(&mut sink, Message::text(layers.as_str())).await;
    }
    while ok {
        tokio::select! {
            _ = stop_rx.changed() => break,
            r = state_rx.changed() => {
                if r.is_err() {
                    break;
                }
                let s = state_rx.borrow_and_update().clone();
                ok = send_within(&mut sink, Message::text(s.as_str())).await;
            }
            r = layers_rx.changed() => {
                if r.is_err() {
                    break;
                }
                let l = layers_rx.borrow_and_update().clone();
                ok = send_within(&mut sink, Message::text(l.as_str())).await;
            }
            r = pos_rx.changed() => {
                if r.is_err() {
                    break;
                }
                let p = pos_rx.borrow_and_update().clone();
                ok = send_within(&mut sink, Message::text(p.as_str())).await;
            }
            m = source.next() => match m {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                // The page's ping: answered at once. Anything else is ignored
                // (WebSocket pings are answered by the library).
                Some(Ok(Message::Text(t))) => {
                    if let Some(pong) = pong_for(t.as_str(), now_ms()) {
                        ok = send_within(&mut sink, Message::text(pong)).await;
                    }
                }
                Some(Ok(_)) => {}
            },
            // Nothing new for a while: the phone still hears that the link is there.
            _ = tokio::time::sleep(HEARTBEAT) => {
                ok = send_within(&mut sink, Message::text(HEARTBEAT_FRAME)).await;
            }
        }
    }
    let _ = tokio::time::timeout(Duration::from_secs(1), sink.send(Message::Close(None))).await;
    clients.fetch_sub(1, Ordering::Relaxed);
}

/// `{"ping":N}` from a page → `{"pong":N,"t":<PC clock, ms>}`; anything else → None.
fn pong_for(text: &str, now: u64) -> Option<String> {
    if text.len() > PING_MAX {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let n = v.get("ping")?.as_f64().filter(|n| n.is_finite())?;
    Some(serde_json::json!({ "pong": n, "t": now }).to_string())
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A screenshot's position (`{"pos":{…}}`), straight to the phones when the server is on.
pub fn publish_pos(json: String) {
    if let Some(h) = cell().lock().ok().as_ref().and_then(|g| g.as_ref()) {
        h.publish_pos(json);
    }
}

/// Sends one frame, or gives up on a phone that has stopped reading (SEND_WAIT).
async fn send_within<S: Sink<Message> + Unpin>(sink: &mut S, m: Message) -> bool {
    matches!(tokio::time::timeout(SEND_WAIT, sink.send(m)).await, Ok(Ok(())))
}

// ---- app commands -----------------------------------------------------------------

fn cell() -> &'static Mutex<Option<Handle>> {
    static C: OnceLock<Mutex<Option<Handle>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

fn key_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|d| d.join("phone-key.txt"))
}

fn valid_key(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn load_or_new_key(app: &tauri::AppHandle, fresh: bool) -> String {
    let path = key_path(app);
    if !fresh {
        if let Some(k) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).map(|s| s.trim().to_string()) {
            if valid_key(&k) {
                return k;
            }
        }
    }
    let k = uuid::Uuid::new_v4().simple().to_string();
    if let Some(p) = path {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, &k);
    }
    k
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Qr {
    pub size: usize,
    /// Row by row, '1' = dark.
    pub cells: String,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PhoneStatus {
    pub running: bool,
    pub urls: Vec<String>,
    pub qr: Option<Qr>,
    pub clients: usize,
    pub firewall: bool,
    /// Away from home (4G/5G): the address over Tailscale, when this PC is on it.
    pub remote_url: Option<String>,
    pub remote_qr: Option<Qr>,
    /// The firewall lets Tailscale reach the map.
    pub remote_firewall: bool,
}

pub fn qr_of(text: &str) -> Option<Qr> {
    let code = qrcode::QrCode::new(text.as_bytes()).ok()?;
    let size = code.width();
    let cells = code.to_colors().iter().map(|c| if *c == qrcode::Color::Dark { '1' } else { '0' }).collect();
    Some(Qr { size, cells })
}

fn current_key() -> &'static Mutex<String> {
    static K: OnceLock<Mutex<String>> = OnceLock::new();
    K.get_or_init(|| Mutex::new(String::new()))
}

async fn status_now(firewall: bool) -> PhoneStatus {
    let running = cell().lock().unwrap().as_ref().map(|h| h.clients());
    let Some(clients) = running else { return PhoneStatus::default() };
    let nets = tauri::async_runtime::spawn_blocking(net::local_nets).await.unwrap_or_default();
    let key = current_key().lock().unwrap().clone();
    let router = tauri::async_runtime::spawn_blocking(net::internet_ip).await.ok().flatten();
    let urls = phone_urls(&nets, PHONE_PORT, &key, router);
    let qr = urls.first().and_then(|u| qr_of(u));
    let tailscale = net::tailscale_ip();
    let remote_url = tailscale.map(|ip| format!("http://{ip}:{PHONE_PORT}/?view=phone&k={key}"));
    let remote_qr = remote_url.as_deref().and_then(qr_of);
    let remote_firewall = if tailscale.is_some() {
        tauri::async_runtime::spawn_blocking(crate::party::phone_remote_rule_present).await.unwrap_or(false)
    } else {
        false
    };
    PhoneStatus { running: true, urls, qr, clients, firewall, remote_url, remote_qr, remote_firewall }
}

/// One start at a time: two at once (the app turning it on as it opens while
/// the player taps the switch) would both find it off, and the second would
/// find the port taken by the first ("another program is using port 8791").
fn start_lock() -> &'static tokio::sync::Mutex<()> {
    static L: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    L.get_or_init(|| tokio::sync::Mutex::new(()))
}

async fn start_for(app: tauri::AppHandle, fresh_key: bool) -> Result<PhoneStatus, String> {
    let _one_at_a_time = start_lock().lock().await;
    if fresh_key {
        if let Some(h) = cell().lock().unwrap().take() {
            h.stop();
        }
    }
    if cell().lock().unwrap().is_none() {
        let key = load_or_new_key(&app, fresh_key);
        *current_key().lock().unwrap() = key.clone();
        let a2 = app.clone();
        let assets: AssetsFn = Arc::new(move |path: &str| {
            a2.asset_resolver().get(path.to_string()).map(|a| (a.bytes, a.mime_type))
        });
        let allow: AllowFn = Arc::new(|peer: &IpAddr| phone_peer(peer, &net::local_nets(), net::tailscale_ip()));
        let h = start(Ipv4Addr::UNSPECIFIED, PHONE_PORT, key, assets, allow).await?;
        net::log("celular: mapa no celular ligado (porta 8791)");
        *cell().lock().unwrap() = Some(h);
    }
    let firewall = tauri::async_runtime::spawn_blocking(crate::party::firewall_rules_present).await.unwrap_or(false);
    Ok(status_now(firewall).await)
}

#[tauri::command]
pub async fn phone_start(app: tauri::AppHandle) -> Result<PhoneStatus, String> {
    start_for(app, false).await
}

/// A new key: every phone that has the old QR is cut off.
#[tauri::command]
pub async fn phone_new_key(app: tauri::AppHandle) -> Result<PhoneStatus, String> {
    start_for(app, true).await
}

#[tauri::command]
pub fn phone_stop() {
    if let Some(h) = cell().lock().unwrap().take() {
        h.stop();
        net::log("celular: mapa no celular desligado");
    }
}

#[tauri::command]
pub async fn phone_status() -> PhoneStatus {
    let firewall = if cell().lock().unwrap().is_some() {
        tauri::async_runtime::spawn_blocking(crate::party::firewall_rules_present).await.unwrap_or(false)
    } else {
        false
    };
    status_now(firewall).await
}

/// The map state for the phones (JSON from the app). False when off or refused.
#[tauri::command]
pub fn phone_publish(state: String) -> bool {
    if state.len() > STATE_MAX || serde_json::from_str::<serde::de::IgnoredAny>(&state).is_err() {
        return false;
    }
    match cell().lock().unwrap().as_ref() {
        Some(h) => {
            h.publish(state);
            true
        }
        None => false,
    }
}

/// Lets Tailscale reach the map (Windows asks for admin rights). True when it is allowed.
#[tauri::command]
pub async fn phone_remote_firewall() -> bool {
    tauri::async_runtime::spawn_blocking(|| crate::party::phone_remote_rule_present() || (crate::party::request_firewall_rules() && crate::party::phone_remote_rule_present()))
        .await
        .unwrap_or(false)
}

/// Everything the map draws, for the phones (JSON from the app). False when off or refused.
#[tauri::command]
pub fn phone_publish_layers(layers: String) -> bool {
    if layers.len() > LAYERS_MAX || serde_json::from_str::<serde::de::IgnoredAny>(&layers).is_err() {
        return false;
    }
    match cell().lock().unwrap().as_ref() {
        Some(h) => {
            h.publish_layers(layers);
            true
        }
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assets() -> AssetsFn {
        Arc::new(|p: &str| match p {
            "index.html" => Some((b"<html>MoA</html>".to_vec(), "text/html".into())),
            "assets/app.js" => Some((b"console.log(1)".to_vec(), "text/javascript".into())),
            _ => None,
        })
    }

    async fn ws(port: u16, target: &str) -> Result<tokio_tungstenite::WebSocketStream<TcpStream>, String> {
        let s = TcpStream::connect(("127.0.0.1", port)).await.map_err(|e| e.to_string())?;
        tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}{target}"), s).await.map(|(w, _)| w).map_err(|e| e.to_string())
    }

    async fn get(port: u16, target: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out).await;
        out
    }

    /// The next map state, past any heartbeat.
    async fn next_state(ws: &mut tokio_tungstenite::WebSocketStream<TcpStream>) -> String {
        loop {
            let m = ws.next().await.unwrap().unwrap();
            let t = m.to_text().unwrap();
            if t != HEARTBEAT_FRAME {
                return t.to_string();
            }
        }
    }

    /// Nothing new to send (no screenshot for a while): the phone still hears
    /// from the PC, so a page can tell a quiet link from a dead one.
    #[test]
    fn a_quiet_link_still_hears_from_the_pc() {
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            h.publish(r#"{"points":[]}"#.into());
            let mut ws = ws(h.port, "/ws?k=abcdef0123456789").await.unwrap();
            assert_eq!(next_state(&mut ws).await, r#"{"points":[]}"#);
            for _ in 0..3 {
                let m = tokio::time::timeout(HEARTBEAT * 4, ws.next()).await.expect("a heartbeat in time").unwrap().unwrap();
                assert_eq!(m.to_text().unwrap(), HEARTBEAT_FRAME);
            }
            // A new state still goes out as soon as it comes.
            h.publish(r#"{"points":[1]}"#.into());
            assert_eq!(next_state(&mut ws).await, r#"{"points":[1]}"#);
            h.stop();
        });
    }

    /// The page's ping comes back at once with the PC's clock; nothing else is answered.
    #[test]
    fn a_ping_is_answered_with_the_pc_clock() {
        assert_eq!(pong_for(r#"{"ping":1234.5}"#, 99).as_deref(), Some(r#"{"pong":1234.5,"t":99}"#));
        assert_eq!(pong_for(r#"{"ping":"x"}"#, 99), None);
        assert_eq!(pong_for(r#"{"points":[]}"#, 99), None);
        assert_eq!(pong_for(&format!(r#"{{"ping":1,"pad":"{}"}}"#, "x".repeat(80)), 99), None);
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            h.publish(r#"{"points":[]}"#.into());
            let mut ws = ws(h.port, "/ws?k=abcdef0123456789").await.unwrap();
            assert_eq!(next_state(&mut ws).await, r#"{"points":[]}"#);
            ws.send(Message::text(r#"{"ping":7}"#)).await.unwrap();
            let pong = next_state(&mut ws).await;
            assert!(pong.starts_with(r#"{"pong":7.0,"t":"#), "{pong}");
            h.stop();
        });
    }

    /// A screenshot's position reaches a connected phone on its own frame, at
    /// once; a phone that connects later gets the map state instead.
    #[test]
    fn a_position_goes_straight_to_the_phones() {
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            h.publish(r#"{"points":[]}"#.into());
            h.publish_pos(r#"{"pos":{"x":0}}"#.into());
            let mut ws = ws(h.port, "/ws?k=abcdef0123456789").await.unwrap();
            assert_eq!(next_state(&mut ws).await, r#"{"points":[]}"#);
            let t0 = std::time::Instant::now();
            h.publish_pos(r#"{"pos":{"x":1}}"#.into());
            assert_eq!(next_state(&mut ws).await, r#"{"pos":{"x":1}}"#);
            assert!(t0.elapsed() < Duration::from_millis(100), "{:?}", t0.elapsed());
            h.stop();
        });
    }

    /// A phone over Tailscale gets in only while this PC is on Tailscale; the home network always.
    #[test]
    fn a_phone_away_from_home_comes_in_over_tailscale_only() {
        let nets = [LocalNet { ip: Ipv4Addr::new(192, 168, 1, 20), prefix: 24, kind: NetKind::Lan, public: false }];
        let phone_home: IpAddr = "192.168.1.33".parse().unwrap();
        let phone_ts: IpAddr = "100.90.1.2".parse().unwrap();
        let stranger: IpAddr = "8.8.8.8".parse().unwrap();
        let ts = Some(Ipv4Addr::new(100, 70, 0, 1));
        assert!(phone_peer(&phone_home, &nets, None));
        assert!(phone_peer(&phone_ts, &nets, ts));
        assert!(!phone_peer(&phone_ts, &nets, None));
        assert!(!phone_peer(&stranger, &nets, ts));
    }

    /// Stopped and started again at once (a new key): the port is free again by
    /// the time the new server asks, instead of "another program is using it".
    #[test]
    fn a_restart_gets_its_port_back() {
        tauri::async_runtime::block_on(async {
            let a = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            let port = a.port;
            a.stop();
            let b = start(Ipv4Addr::LOCALHOST, port, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await;
            assert!(b.is_ok(), "{:?}", b.err());
            b.unwrap().stop();
        });
    }

    /// The map's layers reach a phone that connects later (after its state) and every phone when they change.
    #[test]
    fn the_layers_go_to_new_phones_and_on_change() {
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            h.publish(r#"{"points":[]}"#.into());
            h.publish_layers(r#"{"layers":{"mapId":"a"}}"#.into());
            let mut ws = ws(h.port, "/ws?k=abcdef0123456789").await.unwrap();
            assert_eq!(next_state(&mut ws).await, r#"{"points":[]}"#);
            assert_eq!(next_state(&mut ws).await, r#"{"layers":{"mapId":"a"}}"#);
            h.publish_layers(r#"{"layers":{"mapId":"b"}}"#.into());
            assert_eq!(next_state(&mut ws).await, r#"{"layers":{"mapId":"b"}}"#);
            h.stop();
        });
    }

    /// A phone whose page froze and stopped reading does not hold its place
    /// forever: once a frame cannot go out for SEND_WAIT, it is let go.
    #[test]
    fn a_phone_that_stops_reading_is_let_go() {
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            let _frozen = ws(h.port, "/ws?k=abcdef0123456789").await.unwrap();
            let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
            let mut seen = false;
            let mut i = 0u32;
            while tokio::time::Instant::now() < deadline {
                if h.clients() == 1 {
                    seen = true;
                }
                if seen && h.clients() == 0 {
                    break;
                }
                // Big states, never read: the socket fills up and a send stalls.
                i += 1;
                h.publish(format!(r#"{{"points":[],"n":{i},"pad":"{}"}}"#, "x".repeat(4 * 1024 * 1024)));
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(seen, "the phone connected");
            assert_eq!(h.clients(), 0, "a phone that stopped reading is let go");
            h.stop();
        });
    }

    /// A big file asked for the way a browser does (many header lines), read to
    /// the end: the whole file must arrive, not a connection reset half way.
    #[test]
    fn a_big_file_arrives_whole_to_a_browser() {
        tauri::async_runtime::block_on(async {
            const SIZE: usize = 2 * 1024 * 1024;
            let big: AssetsFn = Arc::new(|p: &str| (p == "assets/big.js").then(|| (vec![b'x'; SIZE], "text/javascript".into())));
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), big, Arc::new(|_: &IpAddr| true)).await.unwrap();
            for _ in 0..5 {
                let mut s = TcpStream::connect(("127.0.0.1", h.port)).await.unwrap();
                let mut req = String::from("GET /assets/big.js HTTP/1.1\r\nHost: 192.168.100.11:8791\r\nConnection: keep-alive\r\n");
                for i in 0..20 {
                    req.push_str(&format!("X-Browser-Header-{i}: {}\r\n", "v".repeat(60)));
                }
                req.push_str("\r\n");
                s.write_all(req.as_bytes()).await.unwrap();
                let mut out = Vec::new();
                let read = s.read_to_end(&mut out).await;
                assert!(read.is_ok(), "the connection was reset: {read:?}");
                let body = out.windows(4).position(|w| w == b"\r\n\r\n").map(|i| out.len() - i - 4);
                assert_eq!(body, Some(SIZE), "the whole file must arrive");
            }
            h.stop();
        });
    }

    #[test]
    fn paths_are_kept_inside_the_app() {
        assert_eq!(asset_path("/").as_deref(), Some("index.html"));
        assert_eq!(asset_path("/?view=phone&k=abc").as_deref(), Some("index.html"));
        assert_eq!(asset_path("/assets/index-AbC_1.js").as_deref(), Some("assets/index-AbC_1.js"));
        for bad in ["/../secret", "//etc/passwd", "/a/../../b", "/x y", "/%2e%2e/a", "relative", "/a\\b"] {
            assert_eq!(asset_path(bad), None, "{bad}");
        }
    }

    #[test]
    fn urls_and_qr_only_for_the_home_network() {
        let nets = net::parse_nets("26.243.126.84/8 Radmin\n192.168.100.11/24 Wi-Fi\n");
        let urls = phone_urls(&nets, 8791, "k123", None);
        assert_eq!(urls, vec!["http://192.168.100.11:8791/?view=phone&k=k123".to_string()]);
        let qr = qr_of(&urls[0]).unwrap();
        assert_eq!(qr.cells.len(), qr.size * qr.size);
        assert!(qr.size >= 21);
        assert!(home_peer(&"192.168.100.50".parse().unwrap(), &nets));
        assert!(home_peer(&"127.0.0.1".parse().unwrap(), &nets));
        assert!(!home_peer(&"26.1.2.3".parse().unwrap(), &nets), "Radmin is not the home Wi-Fi");
        assert!(!home_peer(&"8.8.8.8".parse().unwrap(), &nets));
    }

    /// A Hyper-V / WSL virtual adapter listed first must not become the QR code.
    #[test]
    fn the_qr_is_the_network_the_pc_reaches_the_router_through() {
        let nets = net::parse_nets("172.31.0.1/20/
26.243.126.84/8/Public
192.168.100.11/24/Public
");
        let router = Some(Ipv4Addr::new(192, 168, 100, 11));
        let urls = phone_urls(&nets, 8791, "k", router);
        assert_eq!(urls[0], "http://192.168.100.11:8791/?view=phone&k=k");
        assert_eq!(urls.len(), 2, "the other one stays listed, after");
        assert_eq!(phone_urls(&nets, 8791, "k", None)[0], "http://172.31.0.1:8791/?view=phone&k=k");
    }

    #[test]
    fn serves_the_page_and_streams_the_map_only_with_the_key() {
        tauri::async_runtime::block_on(async {
            let h = start(Ipv4Addr::LOCALHOST, 0, "abcdef0123456789".into(), assets(), Arc::new(|_: &IpAddr| true)).await.unwrap();
            let port = h.port;
            // The page and its files.
            let page = get(port, "/?view=phone&k=abcdef0123456789").await;
            assert!(page.starts_with("HTTP/1.1 200"), "{page}");
            assert!(page.contains("Cache-Control: no-cache") && page.ends_with("<html>MoA</html>"));
            assert!(get(port, "/assets/app.js").await.contains("max-age"));
            assert!(get(port, "/nope.js").await.starts_with("HTTP/1.1 404"));
            assert!(get(port, "/../x").await.starts_with("HTTP/1.1 404"));

            // Live data: wrong key → refused.
            let bad = ws(port, "/ws?k=wrongwrongwrong1").await;
            assert!(bad.is_err(), "a phone without the key gets nothing");
            assert!(ws(port, "/ws").await.is_err());

            // Right key: the latest state at once, then every change.
            h.publish(r#"{"mapId":"a"}"#.into());
            let mut ws = ws(port, "/ws?k=abcdef0123456789").await.unwrap();
            assert_eq!(next_state(&mut ws).await, r#"{"mapId":"a"}"#);
            for _ in 0..50 {
                if h.clients() == 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(h.clients(), 1);
            h.publish(r#"{"mapId":"b"}"#.into());
            assert_eq!(next_state(&mut ws).await, r#"{"mapId":"b"}"#);
            // Stopping closes it.
            h.stop();
            let end = tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    match ws.next().await {
                        Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                        _ => {}
                    }
                }
            })
            .await;
            assert!(end.is_ok());
        });
    }
}
