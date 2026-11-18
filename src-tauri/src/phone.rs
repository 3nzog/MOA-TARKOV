// The map on a phone on the same Wi-Fi: this PC serves the app's own page over
// plain HTTP on the home network (port 8791) and streams the map state (map,
// position, floor, exits, quests, squadmates, raid clock) over a WebSocket.
//
// - Only from this PC or its home network (same router). Not Radmin, not the
//   internet.
// - The page itself is the app's bundle (public anyway); the live data needs
//   the key carried by the QR code. A new key cuts off every phone.
// - Read-only: a phone only receives; whatever it sends is ignored.

use futures_util::{SinkExt, StreamExt};
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
const MAX_CLIENTS: usize = 8;
const HEAD_MAX: usize = 8 * 1024;
const HEAD_WAIT: Duration = Duration::from_secs(5);
/// How long a finished reply waits for the browser to close its side.
const CLOSE_WAIT: Duration = Duration::from_secs(3);

/// An app file by path ("index.html", "assets/x.js") → (bytes, mime type).
pub type AssetsFn = Arc<dyn Fn(&str) -> Option<(Vec<u8>, String)> + Send + Sync>;
/// Whether a peer may connect.
pub type AllowFn = Arc<dyn Fn(&IpAddr) -> bool + Send + Sync>;

pub struct Handle {
    stop: watch::Sender<bool>,
    state: watch::Sender<Arc<String>>,
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
    pub fn clients(&self) -> usize {
        self.clients.load(Ordering::Relaxed)
    }
}

/// This PC or a PC/phone on its home network (Wi-Fi, same router).
pub fn home_peer(peer: &IpAddr, nets: &[LocalNet]) -> bool {
    let lan: Vec<LocalNet> = nets.iter().filter(|n| n.kind == NetKind::Lan).copied().collect();
    net::peer_allowed(peer, &lan, true)
}

/// The phone page's address on each home network of this PC.
pub fn phone_urls(nets: &[LocalNet], port: u16, key: &str) -> Vec<String> {
    let mut ips: Vec<Ipv4Addr> = nets.iter().filter(|n| n.kind == NetKind::Lan).map(|n| n.ip).collect();
    ips.dedup();
    ips.into_iter().map(|ip| format!("http://{ip}:{port}/?view=phone&k={key}")).collect()
}

pub async fn start(bind: Ipv4Addr, port: u16, key: String, assets: AssetsFn, allow: AllowFn) -> Result<Handle, String> {
    let listener = TcpListener::bind(SocketAddr::from((bind, port)))
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::AddrInUse { "port_busy".to_string() } else { e.to_string() })?;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let (stop, stop_rx) = watch::channel(false);
    let (state, state_rx) = watch::channel(Arc::new(String::new()));
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
                    if !allow(&peer.ip()) {
                        continue;
                    }
                    let (assets, key, state_rx, stop_rx, clients) = (assets.clone(), key.clone(), state_rx.clone(), stop_rx.clone(), c2.clone());
                    tauri::async_runtime::spawn(serve(stream, assets, key, state_rx, stop_rx, clients));
                }
            }
        }
    });
    Ok(Handle { stop, state, clients, port })
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
    state_rx: watch::Receiver<Arc<String>>,
    stop_rx: watch::Receiver<bool>,
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
        serve_ws(stream, key, state_rx, stop_rx, clients).await;
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
    mut state_rx: watch::Receiver<Arc<String>>,
    mut stop_rx: watch::Receiver<bool>,
    clients: Arc<AtomicUsize>,
) {
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
    let mut ok = first.is_empty() || sink.send(Message::text(first.as_str())).await.is_ok();
    while ok {
        tokio::select! {
            _ = stop_rx.changed() => break,
            r = state_rx.changed() => {
                if r.is_err() {
                    break;
                }
                let s = state_rx.borrow_and_update().clone();
                ok = sink.send(Message::text(s.as_str())).await.is_ok();
            }
            m = source.next() => match m {
                // Read-only: text/binary from the phone is ignored; pings are answered by the library.
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
            // Keeps phones' Wi-Fi from dropping an idle socket.
            _ = tokio::time::sleep(Duration::from_secs(20)) => {
                ok = sink.send(Message::Ping(Vec::new().into())).await.is_ok();
            }
        }
    }
    let _ = sink.send(Message::Close(None)).await;
    clients.fetch_sub(1, Ordering::Relaxed);
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
    let urls = phone_urls(&nets, PHONE_PORT, &key);
    let qr = urls.first().and_then(|u| qr_of(u));
    PhoneStatus { running: true, urls, qr, clients, firewall }
}

async fn start_for(app: tauri::AppHandle, fresh_key: bool) -> Result<PhoneStatus, String> {
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
        let allow: AllowFn = Arc::new(|peer: &IpAddr| home_peer(peer, &net::local_nets()));
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
        let urls = phone_urls(&nets, 8791, "k123");
        assert_eq!(urls, vec!["http://192.168.100.11:8791/?view=phone&k=k123".to_string()]);
        let qr = qr_of(&urls[0]).unwrap();
        assert_eq!(qr.cells.len(), qr.size * qr.size);
        assert!(qr.size >= 21);
        assert!(home_peer(&"192.168.100.50".parse().unwrap(), &nets));
        assert!(home_peer(&"127.0.0.1".parse().unwrap(), &nets));
        assert!(!home_peer(&"26.1.2.3".parse().unwrap(), &nets), "Radmin is not the home Wi-Fi");
        assert!(!home_peer(&"8.8.8.8".parse().unwrap(), &nets));
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
            let first = ws.next().await.unwrap().unwrap();
            assert_eq!(first.to_text().unwrap(), r#"{"mapId":"a"}"#);
            for _ in 0..50 {
                if h.clients() == 1 {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert_eq!(h.clients(), 1);
            h.publish(r#"{"mapId":"b"}"#.into());
            let next = ws.next().await.unwrap().unwrap();
            assert_eq!(next.to_text().unwrap(), r#"{"mapId":"b"}"#);
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
