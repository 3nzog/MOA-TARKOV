// A second PC of the same player, used as an extra screen.
//
// The PC that runs the game ("main PC") reads the logs and screenshots as
// usual. Everything those readers tell its own window (raid start / end, map,
// side, position, O+O exits, quests, screenshot text) is also sent, as is, to
// the linked PC, which hands it to its own window as if it had read it. The
// linked PC then behaves like another monitor of the main one.
//
// Pairing: the linked PC finds the main one on the home network (or Radmin),
// connects and shows a 4-digit code; the main PC asks "PC X wants to link,
// code 1234 — allow?". Once allowed, that PC (a random id it keeps) is
// remembered and reconnects on its own. The main PC can forget it at any time.
//
// Nothing here reads the game's memory or files beyond what the log and
// screenshot readers already read; no account data crosses the link.
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::protocol::{Message, WebSocketConfig};

use crate::net::{self, LocalNet};

pub const LINK_PORT: u16 = 8789;
pub const LINK_DISCOVERY_PORT: u16 = 8790;
const QUERY: &[u8] = b"MOA-LINK?1";
const VERSION: u64 = 1;
/// Events the main PC's readers emit that the linked PC replays.
pub const FORWARDED: [&str; 8] = [
    // The game started on the main PC: the linked PC shows its window too.
    "game-launched",
    "raid-started",
    "raid-ended",
    "group-raid-side",
    "quest-event",
    "player-position",
    "extract-panel",
    "screen-text",
];
/// Sent once on linking: which profile is PMC / Scav, learned from every log.
pub const SIDE_SCAN_EVENT: &str = "link-side-scan";
/// The main PC's app state (quest progress, raid history, party, markers…),
/// published by its window (link_publish) and replayed on the linked PC.
pub const STATE_EVENT: &str = "link-state";
/// What the main PC's window may publish. The latest value of each is kept
/// and sent to a PC as soon as it links, then again on every change.
pub const STATE_KEYS: [&str; 9] = ["progress", "history", "squad", "markers", "planner", "profile", "raid", "traders", "presets"];
const STATE_MAX: usize = 4 * 1024 * 1024;
const TO_SERVER_MAX: usize = 4 * 1024;
/// A whole-screen OCR result can be a few hundred kilobytes.
const TO_CLIENT_MAX: usize = 8 * 1024 * 1024;
const HELLO_WAIT: Duration = Duration::from_secs(10);
const ANSWER_WAIT: Duration = Duration::from_secs(120);
const PING_EVERY: Duration = Duration::from_secs(15);
const IDLE_LIMIT: Duration = Duration::from_secs(50);
const MAX_CONNS: usize = 6;
const MAX_PENDING: usize = 3;

pub type Notify = Arc<dyn Fn(&str, Value) + Send + Sync>;
pub type ScanFn = Arc<dyn Fn() -> Option<Value> + Send + Sync>;
pub type NetsFn = Arc<dyn Fn() -> Vec<LocalNet> + Send + Sync>;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub device: String,
    pub name: String,
}

/// A PC on this PC's own home network (same router): the player's other PC,
/// which links without a question while "accept my PCs" is on (first_contact).
/// Radmin is not home: other people's PCs are there too.
fn on_home_network(peer: &std::net::IpAddr, nets: &[LocalNet]) -> bool {
    let std::net::IpAddr::V4(v4) = peer else { return false };
    nets.iter().any(|n| n.kind == net::NetKind::Lan && n.contains(*v4))
}

/// What the main PC does with a link request from a PC it does not know yet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FirstContact {
    /// Linked at once, no question.
    Accept,
    /// The "Link a PC?" window: the player here says yes or no.
    Ask,
    /// Refused without a window.
    Ignore,
}

/// - Home network (same router) with "accept my PCs" on: linked at once.
/// - Asked for by hand (someone clicked this PC on the other one): asked.
/// - Automatic (the other PC's search found this one) from outside the home
///   network (Radmin, internet): ignored. Nobody clicked, so nobody gets a
///   window: a friend's MoA looking for a game PC of its own must never pop
///   up on yours.
/// - Automatic on the home network with "accept my PCs" off: asked, unless
///   this PC was refused before.
fn first_contact(home: bool, auto_accept: bool, manual: bool, refused_before: bool) -> FirstContact {
    if home && auto_accept {
        FirstContact::Accept
    } else if manual {
        FirstContact::Ask
    } else if !home || refused_before {
        FirstContact::Ignore
    } else {
        FirstContact::Ask
    }
}

/// "Accept my PCs on the home network on their own" (Settings; on by default).
static AUTO_ACCEPT_LAN: AtomicBool = AtomicBool::new(true);

fn valid_device(s: &str) -> bool {
    (16..=64).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

fn valid_code(s: &str) -> bool {
    s.len() == 4 && s.bytes().all(|b| b.is_ascii_digit())
}

fn text(v: Value) -> Message {
    Message::text(v.to_string())
}

// ---- main PC (server) -----------------------------------------------------------

struct Conn {
    device: String,
    name: String,
    tx: mpsc::UnboundedSender<Message>,
}

#[derive(Default)]
struct ServerState {
    conns: HashMap<u64, Conn>,
    pending: HashMap<String, oneshot::Sender<bool>>,
    devices: Vec<Device>,
    /// PCs whose request was not allowed: their automatic requests are refused
    /// without asking again (only a request made by hand on that PC asks).
    blocked: Vec<String>,
    next: u64,
    /// Latest published state frame per key.
    states: HashMap<String, String>,
}

pub struct ServerCfg {
    pub name: String,
    pub notify: Notify,
    pub scan: ScanFn,
    /// Where allowed PCs are remembered (None in tests).
    pub store: Option<PathBuf>,
    pub nets: NetsFn,
}

pub struct Server {
    state: Arc<Mutex<ServerState>>,
    stop: watch::Sender<bool>,
    cfg: Arc<ServerCfg>,
    /// The ports actually bound (the app uses the fixed ones; tests pick free ones).
    #[cfg_attr(not(test), allow(dead_code))]
    pub tcp_port: u16,
    #[cfg_attr(not(test), allow(dead_code))]
    pub udp_port: u16,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostStatus {
    pub hosting: bool,
    pub name: String,
    /// Linked PCs connected right now.
    pub connected: Vec<Device>,
    /// Every PC allowed to link.
    pub devices: Vec<Device>,
    pub firewall: bool,
}

fn load_devices(path: &Option<PathBuf>) -> Vec<Device> {
    let Some(p) = path else { return Vec::new() };
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Device>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|d| valid_device(&d.device))
        .collect()
}

fn blocked_path(path: &Option<PathBuf>) -> Option<PathBuf> {
    path.as_ref().map(|p| p.with_file_name("link-blocked.json"))
}

fn load_blocked(path: &Option<PathBuf>) -> Vec<String> {
    let Some(p) = blocked_path(path) else { return Vec::new() };
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(|d| valid_device(d))
        .collect()
}

fn save_blocked(path: &Option<PathBuf>, blocked: &[String]) {
    if let Some(p) = blocked_path(path) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string(blocked).unwrap_or_else(|_| "[]".into()));
    }
}

fn save_devices(path: &Option<PathBuf>, devices: &[Device]) {
    if let Some(p) = path {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, serde_json::to_string_pretty(devices).unwrap_or_else(|_| "[]".into()));
    }
}

impl Server {
    pub async fn start(cfg: ServerCfg, bind: Ipv4Addr, tcp_port: u16, udp_port: u16) -> Result<Server, String> {
        let busy = |e: std::io::Error| if e.kind() == std::io::ErrorKind::AddrInUse { "port_busy".to_string() } else { e.to_string() };
        let listener = TcpListener::bind(SocketAddr::from((bind, tcp_port))).await.map_err(busy)?;
        net::no_inherit(&listener);
        let tcp_port = listener.local_addr().map(|a| a.port()).unwrap_or(tcp_port);
        let udp = UdpSocket::bind(SocketAddr::from((bind, udp_port))).await.map_err(busy)?;
        net::no_inherit(&udp);
        let udp_port = udp.local_addr().map(|a| a.port()).unwrap_or(udp_port);
        let state = Arc::new(Mutex::new(ServerState { devices: load_devices(&cfg.store), blocked: load_blocked(&cfg.store), ..Default::default() }));
        let (stop, stop_rx) = watch::channel(false);
        let cfg = Arc::new(cfg);
        tauri::async_runtime::spawn(accept_loop(listener, state.clone(), cfg.clone(), stop_rx.clone()));
        tauri::async_runtime::spawn(discovery_responder(udp, cfg.clone(), tcp_port, stop_rx));
        Ok(Server { state, stop, cfg, tcp_port, udp_port })
    }

    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }

    /// Sends one reader event to every linked PC. `payload` is already JSON.
    pub fn forward(&self, event: &str, payload: &str) {
        if !FORWARDED.contains(&event) || payload.len() > TO_CLIENT_MAX - 256 {
            return;
        }
        // `event` is one of the constants above and `payload` came out of a
        // serializer, so this is valid JSON without re-parsing a large payload.
        let frame = format!(r#"{{"t":"event","event":"{event}","payload":{payload}}}"#);
        let mut st = self.state.lock().unwrap();
        for c in st.conns.values() {
            let _ = c.tx.send(Message::text(frame.clone()));
        }
        // The last position and O+O list are state too: a PC that links in
        // the middle of a raid gets them at once.
        if event == "player-position" || event == "extract-panel" {
            st.states.insert(format!("@{event}"), frame);
        }
    }

    /// Publishes one piece of the main PC's app state (`value` is JSON). It is
    /// kept, so a PC that links later gets it at once. False if refused.
    pub fn publish(&self, key: &str, value: &str) -> bool {
        if !STATE_KEYS.contains(&key) || value.len() > STATE_MAX || serde_json::from_str::<serde::de::IgnoredAny>(value).is_err() {
            return false;
        }
        let frame = format!(r#"{{"t":"event","event":"{STATE_EVENT}","payload":{{"key":"{key}","value":{value}}}}}"#);
        let mut st = self.state.lock().unwrap();
        for c in st.conns.values() {
            let _ = c.tx.send(Message::text(frame.clone()));
        }
        st.states.insert(key.to_owned(), frame);
        true
    }

    pub fn answer(&self, id: &str, accept: bool) -> bool {
        match self.state.lock().unwrap().pending.remove(id) {
            Some(tx) => tx.send(accept).is_ok(),
            None => false,
        }
    }

    pub fn status(&self) -> HostStatus {
        status_of(&self.state, &self.cfg)
    }

    /// Stops allowing a PC; if it is connected, it is cut off now.
    pub fn forget(&self, device: &str) {
        {
            let mut st = self.state.lock().unwrap();
            st.devices.retain(|d| d.device != device);
            save_devices(&self.cfg.store, &st.devices);
            for c in st.conns.values().filter(|c| c.device == device) {
                let _ = c.tx.send(text(json!({ "t": "forgotten" })));
                let _ = c.tx.send(Message::Close(None));
            }
        }
        (self.cfg.notify)("link-changed", serde_json::to_value(self.status()).unwrap_or(Value::Null));
    }
}

fn status_of(state: &Mutex<ServerState>, cfg: &ServerCfg) -> HostStatus {
    let st = state.lock().unwrap();
    let mut connected: Vec<Device> = st.conns.values().map(|c| Device { device: c.device.clone(), name: c.name.clone() }).collect();
    connected.sort_by(|a, b| a.name.cmp(&b.name));
    connected.dedup_by(|a, b| a.device == b.device);
    HostStatus { hosting: true, name: cfg.name.clone(), connected, devices: st.devices.clone(), firewall: true }
}

async fn accept_loop(listener: TcpListener, state: Arc<Mutex<ServerState>>, cfg: Arc<ServerCfg>, mut stop: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = listener.accept() => {
                let Ok((stream, peer)) = r else { continue };
                net::no_inherit(&stream);
                // A linked PC confirms on screen, so a Public home network is fine.
                if !net::peer_allowed(&peer.ip(), &(cfg.nets)(), true) {
                    net::log(format!("anexar: recusado {} (fora das redes deste PC)", peer.ip()));
                    continue;
                }
                if state.lock().unwrap().conns.len() >= MAX_CONNS {
                    continue;
                }
                tauri::async_runtime::spawn(serve(stream, peer, state.clone(), cfg.clone(), stop.clone()));
            }
        }
    }
}

async fn discovery_responder(sock: UdpSocket, cfg: Arc<ServerCfg>, port: u16, mut stop: watch::Receiver<bool>) {
    let mut buf = [0u8; 64];
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = sock.recv_from(&mut buf) => {
                let Ok((n, from)) = r else { continue };
                if &buf[..n] != QUERY || !net::peer_allowed(&from.ip(), &(cfg.nets)(), true) {
                    continue;
                }
                let reply = json!({ "moa": "link", "v": VERSION, "port": port, "name": cfg.name }).to_string();
                let _ = sock.send_to(reply.as_bytes(), from).await;
            }
        }
    }
}

struct Hello {
    device: String,
    name: String,
    code: String,
    /// Asked by hand on that PC (Settings → Anexar), not by its automatic search.
    manual: bool,
}

fn parse_hello(v: &Value) -> Option<Hello> {
    if v.get("t")?.as_str()? != "hello" || v.get("v")?.as_u64()? != VERSION {
        return None;
    }
    let device = v.get("device")?.as_str()?.to_owned();
    let name = crate::party::sanitize_name(v.get("name")?.as_str()?);
    let code = v.get("code")?.as_str()?.to_owned();
    let manual = v.get("manual").and_then(|m| m.as_bool()).unwrap_or(false);
    (valid_device(&device) && !name.is_empty() && valid_code(&code)).then_some(Hello { device, name, code, manual })
}

fn is_ping(v: &Value) -> Option<Value> {
    (v.get("t").and_then(|t| t.as_str()) == Some("ping")).then(|| json!({ "t": "pong", "n": v.get("n").cloned().unwrap_or(Value::Null) }))
}

async fn serve(stream: TcpStream, peer: SocketAddr, state: Arc<Mutex<ServerState>>, cfg: Arc<ServerCfg>, mut stop: watch::Receiver<bool>) {
    let wscfg = WebSocketConfig::default().max_message_size(Some(TO_SERVER_MAX)).max_frame_size(Some(TO_SERVER_MAX));
    let Ok(ws) = tokio_tungstenite::accept_async_with_config(stream, Some(wscfg)).await else { return };
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let writer = tauri::async_runtime::spawn(async move {
        while let Some(m) = rx.recv().await {
            let close = matches!(m, Message::Close(_));
            if sink.send(m).await.is_err() || close {
                break;
            }
        }
        let _ = sink.close().await;
    });

    // 1. hello (pings are answered meanwhile: the connection test uses them).
    let deadline = Instant::now() + HELLO_WAIT;
    let hello = loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(Some(Ok(Message::Text(t)))) = tokio::time::timeout(left, source.next()).await else { break None };
        let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { break None };
        if let Some(pong) = is_ping(&v) {
            let _ = tx.send(text(pong));
            continue;
        }
        break parse_hello(&v);
    };
    let Some(hello) = hello else {
        let _ = tx.send(text(json!({ "t": "error", "code": "bad_hello" })));
        let _ = tx.send(Message::Close(None));
        let _ = writer.await;
        return;
    };

    // 2. allowed already, on the home network (accepted on its own), asked
    //    for by hand (ask the player on this PC), or neither: refused quietly
    //    (see first_contact).
    let known = state.lock().unwrap().devices.iter().any(|d| d.device == hello.device);
    let first = (!known).then(|| {
        let home = on_home_network(&peer.ip(), &(cfg.nets)());
        let refused_before = state.lock().unwrap().blocked.iter().any(|d| d == &hello.device);
        first_contact(home, AUTO_ACCEPT_LAN.load(Ordering::Relaxed), hello.manual, refused_before)
    });
    if first == Some(FirstContact::Accept) {
        net::log(format!("anexar: {} ({}) anexado sozinho (rede de casa)", hello.name, peer.ip()));
        (cfg.notify)("link-auto", json!({ "name": hello.name, "ip": peer.ip().to_string() }));
        let mut st = state.lock().unwrap();
        st.devices.retain(|d| d.device != hello.device);
        st.devices.push(Device { device: hello.device.clone(), name: hello.name.clone() });
        save_devices(&cfg.store, &st.devices);
    } else if first == Some(FirstContact::Ignore) {
        net::log(format!("anexar: {} ({}) pediu sozinho, sem ninguém clicar; ignorado sem perguntar", hello.name, peer.ip()));
        let _ = tx.send(text(json!({ "t": "refused" })));
        let _ = tx.send(Message::Close(None));
        let _ = writer.await;
        return;
    } else if first == Some(FirstContact::Ask) {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let (otx, mut orx) = oneshot::channel::<bool>();
        let full = {
            let mut st = state.lock().unwrap();
            let full = st.pending.len() >= MAX_PENDING;
            if !full {
                st.pending.insert(id.clone(), otx);
            }
            full
        };
        if full {
            let _ = tx.send(text(json!({ "t": "error", "code": "busy" })));
            let _ = tx.send(Message::Close(None));
            let _ = writer.await;
            return;
        }
        let _ = tx.send(text(json!({ "t": "pending" })));
        net::log(format!("anexar: {} ({}) pediu para se anexar", hello.name, peer.ip()));
        (cfg.notify)("link-request", json!({ "id": id, "name": hello.name, "code": hello.code, "ip": peer.ip().to_string() }));
        let wait_until = Instant::now() + ANSWER_WAIT;
        let accepted = loop {
            let left = wait_until.saturating_duration_since(Instant::now());
            tokio::select! {
                r = &mut orx => break r.unwrap_or(false),
                _ = tokio::time::sleep(left) => break false,
                m = source.next() => match m {
                    Some(Ok(Message::Text(t))) => {
                        if let Some(pong) = serde_json::from_str::<Value>(t.as_str()).ok().as_ref().and_then(is_ping) {
                            let _ = tx.send(text(pong));
                        }
                    }
                    Some(Ok(_)) => {}
                    _ => break false,
                },
            }
        };
        state.lock().unwrap().pending.remove(&id);
        (cfg.notify)("link-request-done", json!({ "id": id }));
        if !accepted {
            net::log(format!("anexar: {} não foi permitido", hello.name));
            {
                let mut st = state.lock().unwrap();
                if !st.blocked.contains(&hello.device) {
                    st.blocked.push(hello.device.clone());
                    save_blocked(&cfg.store, &st.blocked);
                }
            }
            let _ = tx.send(text(json!({ "t": "refused" })));
            let _ = tx.send(Message::Close(None));
            let _ = writer.await;
            return;
        }
        let mut st = state.lock().unwrap();
        st.devices.retain(|d| d.device != hello.device);
        st.devices.push(Device { device: hello.device.clone(), name: hello.name.clone() });
        save_devices(&cfg.store, &st.devices);
        if st.blocked.contains(&hello.device) {
            st.blocked.retain(|d| d != &hello.device);
            save_blocked(&cfg.store, &st.blocked);
        }
    }

    // 3. linked: say so, send what the logs say about PMC / Scav, then stream.
    let _ = tx.send(text(json!({ "t": "accepted", "name": cfg.name })));
    let scan_fn = cfg.scan.clone();
    if let Ok(Some(scan)) = tauri::async_runtime::spawn_blocking(move || scan_fn()).await {
        let _ = tx.send(text(json!({ "t": "event", "event": SIDE_SCAN_EVENT, "payload": scan })));
    }
    let conn_id = {
        let mut st = state.lock().unwrap();
        // The same PC reconnecting replaces its old socket.
        for c in st.conns.values().filter(|c| c.device == hello.device) {
            let _ = c.tx.send(Message::Close(None));
        }
        st.next += 1;
        let id = st.next;
        st.conns.insert(id, Conn { device: hello.device.clone(), name: hello.name.clone(), tx: tx.clone() });
        // Everything the main PC's window has published so far, under the
        // same lock as publish(): no update can slip between the two.
        for frame in st.states.values() {
            let _ = tx.send(Message::text(frame.clone()));
        }
        id
    };
    net::log(format!("anexar: {} ({}) anexado", hello.name, peer.ip()));
    (cfg.notify)("link-changed", serde_json::to_value(status_of(&state, &cfg)).unwrap_or(Value::Null));

    loop {
        let next = tokio::select! {
            _ = stop.changed() => break,
            r = tokio::time::timeout(IDLE_LIMIT, source.next()) => r,
        };
        match next {
            Ok(Some(Ok(Message::Text(t)))) => {
                if let Some(pong) = serde_json::from_str::<Value>(t.as_str()).ok().as_ref().and_then(is_ping) {
                    let _ = tx.send(text(pong));
                }
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
            Ok(Some(Ok(_))) => {}
        }
    }
    state.lock().unwrap().conns.remove(&conn_id);
    net::log(format!("anexar: {} desconectou", hello.name));
    (cfg.notify)("link-changed", serde_json::to_value(status_of(&state, &cfg)).unwrap_or(Value::Null));
    let _ = tx.send(Message::Close(None));
    drop(tx);
    let _ = writer.await;
}

// ---- linked PC (client) -----------------------------------------------------------

pub struct ClientCfg {
    pub device: String,
    pub name: String,
    pub emit: Notify,
    /// Asked by hand (not the automatic search).
    pub manual: bool,
}

pub struct ClientHandle {
    stop: watch::Sender<bool>,
    pub code: String,
}

impl ClientHandle {
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

fn new_code() -> String {
    let b = uuid::Uuid::new_v4().into_bytes();
    format!("{:04}", u32::from_le_bytes([b[0], b[1], b[2], b[3]]) % 10_000)
}

pub fn start_client(host: String, port: u16, cfg: ClientCfg) -> ClientHandle {
    let (stop, stop_rx) = watch::channel(false);
    let code = new_code();
    tauri::async_runtime::spawn(client_loop(host.clone(), port, Arc::new(cfg), code.clone(), stop_rx));
    ClientHandle { stop, code }
}

enum End {
    Refused,
    Stopped,
    Lost { reason: String, was_linked: bool },
}

async fn client_loop(host: String, port: u16, cfg: Arc<ClientCfg>, code: String, mut stop: watch::Receiver<bool>) {
    let status = |state: &str, extra: Value| {
        let mut v = json!({ "state": state, "host": host, "port": port, "code": code });
        if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
            for (k, val) in e {
                o.insert(k.clone(), val.clone());
            }
        }
        (cfg.emit)("link-client", v);
    };
    let mut backoff = Duration::from_secs(1);
    loop {
        if *stop.borrow() {
            break;
        }
        status("connecting", json!({}));
        match session(&host, port, &cfg, &code, &mut stop, &status).await {
            End::Stopped => break,
            End::Refused => {
                net::log(format!("anexar: o PC {host} não permitiu"));
                status("refused", json!({}));
                break;
            }
            End::Lost { reason, was_linked } => {
                net::log(format!("anexar: conexão com {host} caiu ({reason})"));
                status("lost", json!({ "reason": reason }));
                if was_linked {
                    backoff = Duration::from_secs(1);
                }
                tokio::select! {
                    _ = stop.changed() => break,
                    _ = tokio::time::sleep(backoff) => {}
                }
                backoff = (backoff * 2).min(Duration::from_secs(15));
            }
        }
    }
    status("off", json!({}));
}

async fn session(
    host: &str,
    port: u16,
    cfg: &ClientCfg,
    code: &str,
    stop: &mut watch::Receiver<bool>,
    status: &impl Fn(&str, Value),
) -> End {
    let lost = |reason: &str, was_linked: bool| End::Lost { reason: reason.to_owned(), was_linked };
    let stream = match tokio::time::timeout(Duration::from_secs(4), TcpStream::connect((host, port))).await {
        Ok(Ok(s)) => {
            net::no_inherit(&s);
            s
        }
        Ok(Err(_)) => return lost("refused", false),
        Err(_) => return lost("timeout", false),
    };
    let _ = stream.set_nodelay(true);
    let wscfg = WebSocketConfig::default().max_message_size(Some(TO_CLIENT_MAX)).max_frame_size(Some(TO_CLIENT_MAX));
    let Ok((ws, _)) = tokio_tungstenite::client_async_with_config(format!("ws://{host}:{port}/"), stream, Some(wscfg)).await else {
        return lost("handshake", false);
    };
    let (mut sink, mut source) = ws.split();
    let hello = json!({ "t": "hello", "v": VERSION, "device": cfg.device, "name": cfg.name, "code": code, "manual": cfg.manual });
    if sink.send(text(hello)).await.is_err() {
        return lost("send", false);
    }
    let mut linked = false;
    let mut ping = tokio::time::interval(PING_EVERY);
    ping.tick().await;
    loop {
        let next = tokio::select! {
            _ = stop.changed() => {
                let _ = sink.close().await;
                return End::Stopped;
            }
            _ = ping.tick() => {
                if sink.send(text(json!({ "t": "ping" }))).await.is_err() {
                    return lost("send", linked);
                }
                continue;
            }
            r = tokio::time::timeout(IDLE_LIMIT, source.next()) => r,
        };
        let t = match next {
            Ok(Some(Ok(Message::Text(t)))) => t,
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => return lost("closed", linked),
            Ok(Some(Err(_))) => return lost("error", linked),
            Err(_) => return lost("silent", linked),
            Ok(Some(Ok(_))) => continue,
        };
        let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
        match v.get("t").and_then(|x| x.as_str()) {
            Some("pending") => status("pending", json!({})),
            Some("accepted") => {
                linked = true;
                let name = crate::party::sanitize_name(v.get("name").and_then(|n| n.as_str()).unwrap_or(""));
                net::log(format!("anexar: anexado a {name} ({host})"));
                status("linked", json!({ "name": name }));
            }
            Some("refused") => return End::Refused,
            Some("forgotten") => return End::Refused,
            Some("error") => {
                let code = v.get("code").and_then(|c| c.as_str()).unwrap_or("error");
                return lost(code, linked);
            }
            Some("event") if linked => {
                let Some(event) = v.get("event").and_then(|e| e.as_str()) else { continue };
                if FORWARDED.contains(&event) || event == SIDE_SCAN_EVENT || event == STATE_EVENT {
                    (cfg.emit)(event, v.get("payload").cloned().unwrap_or(Value::Null));
                }
            }
            _ => {}
        }
    }
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundLink {
    pub host: String,
    pub port: u16,
    pub name: String,
}

fn parse_found(bytes: &[u8], from: SocketAddr, nets: &[LocalNet]) -> Option<FoundLink> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    if v.get("moa")?.as_str()? != "link" || v.get("v")?.as_u64()? != VERSION {
        return None;
    }
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    let name = crate::party::sanitize_name(v.get("name")?.as_str()?);
    if name.is_empty() || !net::peer_allowed(&from.ip(), nets, true) {
        return None;
    }
    Some(FoundLink { host: from.ip().to_string(), port, name })
}

/// Every main PC that answers within `wait`, one per address.
async fn ask(binds: Vec<(Ipv4Addr, Vec<SocketAddr>)>, wait: Duration, nets: Vec<LocalNet>, include_self: bool) -> Vec<FoundLink> {
    let own: Vec<std::net::IpAddr> = binds.iter().map(|(ip, _)| (*ip).into()).collect();
    let nets = Arc::new(nets);
    let found = Arc::new(Mutex::new(Vec::<FoundLink>::new()));
    let mut tasks = Vec::new();
    for (ip, targets) in binds {
        let Ok(sock) = UdpSocket::bind(SocketAddr::from((ip, 0))).await else { continue };
        let _ = sock.set_broadcast(true);
        for t in &targets {
            let _ = sock.send_to(QUERY, t).await;
        }
        let (own, nets, found) = (own.clone(), nets.clone(), found.clone());
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut buf = [0u8; 256];
            while let Ok((n, from)) = sock.recv_from(&mut buf).await {
                if !include_self && own.contains(&from.ip()) {
                    continue;
                }
                if let Some(f) = parse_found(&buf[..n], from, &nets) {
                    let mut list = found.lock().unwrap();
                    if !list.iter().any(|x| x.host == f.host) {
                        list.push(f);
                    }
                }
            }
        }));
    }
    tokio::time::sleep(wait).await;
    for t in tasks {
        t.abort();
    }
    let mut list = found.lock().unwrap().clone();
    // The same PC can answer on Radmin and the home network: prefer home.
    list.sort_by_key(|f| (f.name.clone(), f.host.starts_with("26.")));
    list.dedup_by(|a, b| a.name == b.name);
    list
}

// ---- commands ---------------------------------------------------------------------

fn server_cell() -> &'static Mutex<Option<Arc<Server>>> {
    static CELL: OnceLock<Mutex<Option<Arc<Server>>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

fn client_cell() -> &'static Mutex<Option<ClientHandle>> {
    static CELL: OnceLock<Mutex<Option<ClientHandle>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

/// True while this PC shows another PC's game: then its own link server must
/// not pass those replayed events on again.
static CLIENT_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_hosting() -> bool {
    server_cell().lock().unwrap().is_some()
}

/// Called for every reader event on this PC (main.rs listens for them).
pub fn on_local_event(event: &str, payload: &str) {
    if CLIENT_ACTIVE.load(Ordering::Relaxed) {
        return;
    }
    if let Some(s) = server_cell().lock().unwrap().as_ref() {
        s.forward(event, payload);
    }
}

fn data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok()
}

fn emitter(app: &tauri::AppHandle) -> Notify {
    use tauri::Emitter;
    let app = app.clone();
    Arc::new(move |event: &str, payload: Value| {
        let _ = app.emit(event, payload);
    })
}

/// Lets PCs of this player link to this one (idempotent). Asks Windows for
/// the firewall rules the first time.
#[tauri::command]
pub async fn link_host_start(app: tauri::AppHandle) -> Result<HostStatus, String> {
    if let Some(s) = server_cell().lock().unwrap().as_ref() {
        return Ok(s.status());
    }
    let scan_app = app.clone();
    let cfg = ServerCfg {
        name: net::computer_name(),
        notify: emitter(&app),
        scan: Arc::new(move || crate::log_watcher::scan_sides_for(&scan_app).and_then(|s| serde_json::to_value(s).ok())),
        store: data_dir(&app).map(|d| d.join("link-devices.json")),
        nets: Arc::new(net::local_nets),
    };
    let server = match Server::start(cfg, Ipv4Addr::UNSPECIFIED, LINK_PORT, LINK_DISCOVERY_PORT).await {
        Ok(s) => s,
        Err(e) => {
            net::log(format!("anexar: não deu para abrir este PC para anexar: {e}"));
            return Err(e);
        }
    };
    let firewall = tauri::async_runtime::spawn_blocking(|| crate::party::firewall_rules_present() || crate::party::request_firewall_rules())
        .await
        .unwrap_or(false);
    let mut status = server.status();
    status.firewall = firewall;
    *server_cell().lock().unwrap() = Some(Arc::new(server));
    net::log(format!("anexar: este PC aceita PCs anexados (firewall {})", if firewall { "ok" } else { "NÃO liberado" }));
    Ok(status)
}

#[tauri::command]
pub fn link_host_stop() {
    if let Some(s) = server_cell().lock().unwrap().take() {
        s.stop();
        net::log("anexar: este PC deixou de aceitar PCs anexados");
    }
}

#[tauri::command]
pub fn link_host_status(app: tauri::AppHandle) -> HostStatus {
    match server_cell().lock().unwrap().as_ref() {
        Some(s) => s.status(),
        None => HostStatus {
            hosting: false,
            name: net::computer_name(),
            devices: load_devices(&data_dir(&app).map(|d| d.join("link-devices.json"))),
            ..Default::default()
        },
    }
}

/// Turns "accept my PCs on the home network on their own" on or off.
#[tauri::command]
pub fn link_set_auto_accept(on: bool) {
    AUTO_ACCEPT_LAN.store(on, Ordering::Relaxed);
}

/// The main PC's window publishes a piece of its state for linked PCs.
#[tauri::command]
pub fn link_publish(key: String, value: Value) -> bool {
    if CLIENT_ACTIVE.load(Ordering::Relaxed) {
        return false;
    }
    let Some(s) = server_cell().lock().unwrap().as_ref().cloned() else { return false };
    s.publish(&key, &value.to_string())
}

#[tauri::command]
pub fn link_answer(id: String, accept: bool) -> bool {
    server_cell().lock().unwrap().as_ref().map(|s| s.answer(&id, accept)).unwrap_or(false)
}

#[tauri::command]
pub fn link_forget(app: tauri::AppHandle, device: String) {
    match server_cell().lock().unwrap().as_ref() {
        Some(s) => s.forget(&device),
        None => {
            let store = data_dir(&app).map(|d| d.join("link-devices.json"));
            let mut devices = load_devices(&store);
            devices.retain(|d| d.device != device);
            save_devices(&store, &devices);
        }
    }
}

/// Main PCs on the home network and Radmin.
#[tauri::command]
pub async fn link_find(timeout_ms: Option<u64>) -> Vec<FoundLink> {
    let nets = tauri::async_runtime::spawn_blocking(net::local_nets).await.unwrap_or_default();
    let wait = Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(300, 5000));
    let binds = nets.iter().map(|n| (n.ip, vec![SocketAddr::from((n.broadcast(), LINK_DISCOVERY_PORT))])).collect();
    let found = ask(binds, wait, nets, false).await;
    net::log(format!("anexar: busca achou {} PC(s)", found.len()));
    found
}

/// This PC's own id for linking (random, kept in the app's data folder).
fn device_id(app: &tauri::AppHandle) -> String {
    let path = data_dir(app).map(|d| d.join("link-device.json"));
    if let Some(p) = &path {
        if let Some(id) = std::fs::read_to_string(p).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).and_then(|v| v.get("device").and_then(|d| d.as_str()).map(str::to_owned)) {
            if valid_device(&id) {
                return id;
            }
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(p) = &path {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, json!({ "device": id }).to_string());
    }
    id
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connecting {
    code: String,
}

/// Link this PC to the main PC at host:port (and keep reconnecting).
#[tauri::command]
pub fn link_connect(app: tauri::AppHandle, host: String, port: Option<u16>, manual: Option<bool>) -> Result<Connecting, String> {
    let ip: Ipv4Addr = host.trim().parse().map_err(|_| "bad_ip".to_string())?;
    if net::kind_of(ip).is_none() && !ip.is_loopback() {
        return Err("bad_ip".into());
    }
    if let Some(old) = client_cell().lock().unwrap().take() {
        old.stop();
    }
    let emit = emitter(&app);
    let cfg = ClientCfg {
        device: device_id(&app),
        name: net::computer_name(),
        manual: manual.unwrap_or(false),
        emit: Arc::new(move |event: &str, payload: Value| {
            // Linked: this PC's own link server stays quiet about replayed events.
            if event == "link-client" {
                let state = payload.get("state").and_then(|s| s.as_str()).unwrap_or("");
                CLIENT_ACTIVE.store(state == "linked", Ordering::Relaxed);
            }
            emit(event, payload);
        }),
    };
    net::log(format!("anexar: tentando anexar a {ip}"));
    let handle = start_client(ip.to_string(), port.unwrap_or(LINK_PORT), cfg);
    let code = handle.code.clone();
    *client_cell().lock().unwrap() = Some(handle);
    Ok(Connecting { code })
}

#[tauri::command]
pub fn link_disconnect() {
    if let Some(c) = client_cell().lock().unwrap().take() {
        c.stop();
        net::log("anexar: desanexado");
    }
    CLIENT_ACTIVE.store(false, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nets_none() -> NetsFn {
        Arc::new(Vec::new)
    }

    struct Rec {
        events: Mutex<Vec<(String, Value)>>,
    }

    impl Rec {
        fn new() -> Arc<Rec> {
            Arc::new(Rec { events: Mutex::new(Vec::new()) })
        }
        fn notify(self: &Arc<Self>) -> Notify {
            let me = self.clone();
            Arc::new(move |e: &str, v: Value| me.events.lock().unwrap().push((e.to_owned(), v)))
        }
        fn all(&self, name: &str) -> Vec<Value> {
            self.events.lock().unwrap().iter().filter(|(e, _)| e == name).map(|(_, v)| v.clone()).collect()
        }
        async fn wait_for(&self, name: &str, pred: impl Fn(&Value) -> bool) -> Value {
            for _ in 0..100 {
                if let Some(v) = self.all(name).into_iter().find(|v| pred(v)) {
                    return v;
                }
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            panic!("no {name} event in time; got {:?}", self.events.lock().unwrap());
        }
    }

    async fn main_pc(rec: &Arc<Rec>, store: Option<PathBuf>) -> Server {
        let cfg = ServerCfg {
            name: "PC-DO-JOGO".into(),
            notify: rec.notify(),
            scan: Arc::new(|| Some(json!({ "raids": [], "groups": [], "ends": [] }))),
            store,
            nets: nets_none(),
        };
        Server::start(cfg, Ipv4Addr::LOCALHOST, 0, 0).await.expect("server")
    }

    /// A PC that asks to link because someone clicked the main PC on it (the
    /// tests' main PC has no home network, like a link over Radmin).
    fn screen_pc(rec: &Arc<Rec>, port: u16, device: &str) -> ClientHandle {
        start_client("127.0.0.1".into(), port, ClientCfg { device: device.into(), name: "PC-DO-MAPA".into(), emit: rec.notify(), manual: true })
    }

    /// The same PC asking on its own (its search found the main PC; nobody clicked).
    fn auto_screen_pc(rec: &Arc<Rec>, port: u16, device: &str) -> ClientHandle {
        start_client("127.0.0.1".into(), port, ClientCfg { device: device.into(), name: "PC-DO-MAPA".into(), emit: rec.notify(), manual: false })
    }

    const DEV: &str = "0b5c3c7e-6f0e-4c55-9a43-7b2a1d5e9f10";

    #[test]
    fn pairs_after_confirmation_then_mirrors_reader_events() {
        tauri::async_runtime::block_on(async {
            let main_rec = Rec::new();
            let screen_rec = Rec::new();
            let server = main_pc(&main_rec, None).await;
            let client = screen_pc(&screen_rec, server.tcp_port, DEV);

            // The main PC is asked, with the code the linked PC shows.
            let req = main_rec.wait_for("link-request", |_| true).await;
            assert_eq!(req["name"], "PC-DO-MAPA");
            assert_eq!(req["code"], client.code.as_str());
            screen_rec.wait_for("link-client", |v| v["state"] == "pending").await;

            // Nothing flows before the player says yes.
            server.forward("player-position", r#"{"x":1,"y":2,"z":3,"rotation":4}"#);
            tokio::time::sleep(Duration::from_millis(150)).await;
            assert!(screen_rec.all("player-position").is_empty());

            assert!(server.answer(req["id"].as_str().unwrap(), true));
            // Once allowed, the position read while it waited arrives (it is state).
            screen_rec.wait_for("player-position", |v| v["x"] == 1).await;
            let linked = screen_rec.wait_for("link-client", |v| v["state"] == "linked").await;
            assert_eq!(linked["name"], "PC-DO-JOGO");
            // The side scan arrives on linking.
            screen_rec.wait_for(SIDE_SCAN_EVENT, |v| v.get("raids").is_some()).await;
            main_rec.wait_for("link-changed", |v| v["connected"].as_array().map(|a| a.len()) == Some(1)).await;

            // Every reader event arrives unchanged.
            let samples: [(&str, Value); 7] = [
                ("raid-started", json!({ "location": "bigmap", "logTime": "2026-11-13 21:00:00.000", "profileKey": "k1" })),
                ("group-raid-side", json!({ "side": "scav", "logTime": null })),
                ("player-position", json!({ "x": 10.5, "y": 1.0, "z": -3.25, "rotation": 180.0 })),
                ("extract-panel", json!({ "lines": ["ZB-1011", "Old Gas Station"], "missingLanguage": null })),
                ("screen-text", json!({ "width": 1920, "height": 1080, "lines": [{ "text": "Água", "words": [] }] })),
                ("quest-event", json!({ "status": "Finished", "templateId": "5936d90786f7742b1420ba5b", "logTime": null })),
                ("raid-ended", json!({ "location": "bigmap", "shortId": "ABC", "logTime": null })),
            ];
            for (e, p) in &samples {
                server.forward(e, &p.to_string());
            }
            for (e, p) in &samples {
                screen_rec.wait_for(e, |v| v == p).await;
            }
            // Anything else is not passed on.
            server.forward("tracker-token", r#"{"secret":"x"}"#);
            tokio::time::sleep(Duration::from_millis(150)).await;
            assert!(screen_rec.all("tracker-token").is_empty());

            client.stop();
            screen_rec.wait_for("link-client", |v| v["state"] == "off").await;
            main_rec.wait_for("link-changed", |v| v["connected"].as_array().map(|a| a.is_empty()) == Some(true)).await;
            server.stop();
        });
    }

    #[test]
    fn app_state_reaches_a_pc_that_links_later_and_every_change_after() {
        tauri::async_runtime::block_on(async {
            let main_rec = Rec::new();
            let screen_rec = Rec::new();
            let server = main_pc(&main_rec, None).await;
            // Published before anyone links: kept.
            assert!(server.publish("progress", r#"{"completed":["q1"]}"#));
            assert!(server.publish("progress", r#"{"completed":["q1","q2"]}"#), "the latest replaces the older");
            assert!(!server.publish("tracker-token", r#"{"secret":1}"#), "unknown keys are refused");
            assert!(!server.publish("squad", "not json"), "invalid JSON is refused");
            server.forward("player-position", r#"{"x":5,"y":0,"z":6,"rotation":0}"#);
            let _client = screen_pc(&screen_rec, server.tcp_port, DEV);
            let req = main_rec.wait_for("link-request", |_| true).await;
            server.answer(req["id"].as_str().unwrap(), true);
            let got = screen_rec.wait_for(STATE_EVENT, |v| v["key"] == "progress").await;
            assert_eq!(got["value"], json!({ "completed": ["q1", "q2"] }));
            assert_eq!(screen_rec.all(STATE_EVENT).len(), 1, "only the latest value per key");
            // The last position, read before linking, is replayed on linking.
            screen_rec.wait_for("player-position", |v| v["x"] == 5).await;
            // A change after linking arrives too.
            server.publish("squad", r#"{"members":[{"id":"a","name":"Amigo"}]}"#);
            let sq = screen_rec.wait_for(STATE_EVENT, |v| v["key"] == "squad").await;
            assert_eq!(sq["value"]["members"][0]["name"], "Amigo");
            assert!(screen_rec.all("tracker-token").is_empty());
            server.stop();
        });
    }

    #[test]
    fn a_refused_pc_stops_trying_and_gets_nothing() {
        tauri::async_runtime::block_on(async {
            let main_rec = Rec::new();
            let screen_rec = Rec::new();
            let server = main_pc(&main_rec, None).await;
            let _client = screen_pc(&screen_rec, server.tcp_port, DEV);
            let req = main_rec.wait_for("link-request", |_| true).await;
            assert!(server.answer(req["id"].as_str().unwrap(), false));
            screen_rec.wait_for("link-client", |v| v["state"] == "refused").await;
            screen_rec.wait_for("link-client", |v| v["state"] == "off").await;
            assert!(server.status().devices.is_empty());
            assert_eq!(main_rec.all("link-request").len(), 1, "no retry after a refusal");
            server.stop();
        });
    }

    #[test]
    fn a_pc_nobody_clicked_never_pops_up_from_outside_the_home_network() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("moa-link-test-{}", uuid::Uuid::new_v4().simple()));
            let store = Some(dir.join("link-devices.json"));
            let main_rec = Rec::new();
            let server = main_pc(&main_rec, store.clone()).await;
            // A friend's MoA finds this PC on its own (over Radmin): refused at
            // once, and nobody here is asked.
            let rec1 = Rec::new();
            let c1 = auto_screen_pc(&rec1, server.tcp_port, DEV);
            rec1.wait_for("link-client", |v| v["state"] == "refused").await;
            c1.stop();
            assert!(main_rec.all("link-request").is_empty(), "no window for a request nobody clicked");
            assert!(server.status().devices.is_empty());
            // Asked by hand: the window comes; refused, it is remembered.
            let rec2 = Rec::new();
            let c2 = screen_pc(&rec2, server.tcp_port, DEV);
            let req = main_rec.wait_for("link-request", |_| true).await;
            server.answer(req["id"].as_str().unwrap(), false);
            rec2.wait_for("link-client", |v| v["state"] == "refused").await;
            c2.stop();
            assert!(dir.join("link-blocked.json").exists(), "the refusal is remembered");
            // By hand again: asked again; allowed, it is known and no longer refused.
            let rec3 = Rec::new();
            let c3 = screen_pc(&rec3, server.tcp_port, DEV);
            let req3 = main_rec.wait_for("link-request", |v| v["id"] != req["id"]).await;
            server.answer(req3["id"].as_str().unwrap(), true);
            rec3.wait_for("link-client", |v| v["state"] == "linked").await;
            c3.stop();
            rec3.wait_for("link-client", |v| v["state"] == "off").await;
            assert!(load_blocked(&store).is_empty());
            // Known now: its own search links again without a window.
            let rec4 = Rec::new();
            let _c4 = auto_screen_pc(&rec4, server.tcp_port, DEV);
            rec4.wait_for("link-client", |v| v["state"] == "linked").await;
            assert_eq!(main_rec.all("link-request").len(), 2, "only the two requests made by hand asked");
            server.stop();
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn only_a_click_or_the_home_network_brings_the_window() {
        use FirstContact::*;
        // (home network, "accept my PCs" on, asked by hand, refused before) → what happens
        let cases = [
            ((true, true, false, false), Accept),
            ((true, true, true, true), Accept),
            ((false, true, false, false), Ignore), // Radmin / internet, nobody clicked
            ((false, false, false, false), Ignore),
            ((false, true, true, false), Ask), // Radmin, clicked
            ((false, true, true, true), Ask), // clicked again after a refusal
            ((true, false, false, false), Ask), // home network, accepting by hand
            ((true, false, false, true), Ignore), // ... refused before, nobody clicked
            ((true, false, true, true), Ask),
        ];
        for ((home, auto, manual, refused), want) in cases {
            assert_eq!(first_contact(home, auto, manual, refused), want, "home={home} auto={auto} manual={manual} refused={refused}");
        }
    }

    #[test]
    fn an_allowed_pc_reconnects_alone_even_after_the_main_pc_restarts() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("moa-link-test-{}", uuid::Uuid::new_v4().simple()));
            let store = Some(dir.join("link-devices.json"));
            let main_rec = Rec::new();
            let screen_rec = Rec::new();
            let server = main_pc(&main_rec, store.clone()).await;
            let port = server.tcp_port;
            let client = screen_pc(&screen_rec, port, DEV);
            let req = main_rec.wait_for("link-request", |_| true).await;
            server.answer(req["id"].as_str().unwrap(), true);
            screen_rec.wait_for("link-client", |v| v["state"] == "linked").await;

            // The main PC closes MoA: the linked one notices and keeps trying.
            server.stop();
            screen_rec.wait_for("link-client", |v| v["state"] == "lost").await;

            // It opens again on the same port, remembering the PC: no question this time.
            let rec2 = Rec::new();
            let cfg = ServerCfg {
                name: "PC-DO-JOGO".into(),
                notify: rec2.notify(),
                scan: Arc::new(|| None),
                store: store.clone(),
                nets: nets_none(),
            };
            let mut again = None;
            for _ in 0..40 {
                match Server::start(cfg_clone(&cfg), Ipv4Addr::LOCALHOST, port, 0).await {
                    Ok(s) => {
                        again = Some(s);
                        break;
                    }
                    Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
                }
            }
            let again = again.expect("same port free again");
            assert_eq!(again.status().devices.len(), 1);
            let before = screen_rec.all("link-client").iter().filter(|v| v["state"] == "linked").count();
            for _ in 0..200 {
                if screen_rec.all("link-client").iter().filter(|v| v["state"] == "linked").count() > before {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            assert!(screen_rec.all("link-client").iter().filter(|v| v["state"] == "linked").count() > before, "relinked");
            assert!(rec2.all("link-request").is_empty(), "a known PC is not asked about again");
            again.forward("player-position", r#"{"x":7,"y":0,"z":7,"rotation":0}"#);
            screen_rec.wait_for("player-position", |v| v["x"] == 7).await;

            // Forgetting it cuts it off; it does not come back on its own.
            again.forget(DEV);
            screen_rec.wait_for("link-client", |v| v["state"] == "refused").await;
            assert!(again.status().devices.is_empty());
            client.stop();
            again.stop();
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    fn cfg_clone(c: &ServerCfg) -> ServerCfg {
        ServerCfg { name: c.name.clone(), notify: c.notify.clone(), scan: c.scan.clone(), store: c.store.clone(), nets: c.nets.clone() }
    }

    #[test]
    fn bad_hellos_are_dropped_and_pings_answered() {
        tauri::async_runtime::block_on(async {
            let rec = Rec::new();
            let server = main_pc(&rec, None).await;
            let connect = || async {
                let s = TcpStream::connect(("127.0.0.1", server.tcp_port)).await.unwrap();
                tokio_tungstenite::client_async(format!("ws://127.0.0.1:{}/", server.tcp_port), s).await.unwrap().0
            };
            // Ping before hello (the connection test does this).
            let mut ws = connect().await;
            ws.send(text(json!({ "t": "ping", "n": 7 }))).await.unwrap();
            let pong = tokio::time::timeout(Duration::from_secs(2), ws.next()).await.unwrap().unwrap().unwrap();
            assert_eq!(serde_json::from_str::<Value>(pong.to_text().unwrap()).unwrap(), json!({ "t": "pong", "n": 7 }));
            // Bad ids, names, codes or versions are refused without asking anyone.
            for bad in [
                json!({ "t": "hello", "v": 1, "device": "short", "name": "X", "code": "1234" }),
                json!({ "t": "hello", "v": 1, "device": DEV, "name": "\u{1}", "code": "1234" }),
                json!({ "t": "hello", "v": 1, "device": DEV, "name": "X", "code": "12a4" }),
                json!({ "t": "hello", "v": 9, "device": DEV, "name": "X", "code": "1234" }),
            ] {
                let mut ws = connect().await;
                ws.send(text(bad)).await.unwrap();
                let m = tokio::time::timeout(Duration::from_secs(2), ws.next()).await.unwrap().unwrap().unwrap();
                assert_eq!(serde_json::from_str::<Value>(m.to_text().unwrap()).unwrap()["code"], "bad_hello");
            }
            assert!(rec.all("link-request").is_empty());
            // A frame bigger than a hello closes the socket.
            let mut ws = connect().await;
            let _ = ws.send(Message::text("x".repeat(TO_SERVER_MAX * 2))).await;
            let closed = tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    match ws.next().await {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return true,
                        _ => {}
                    }
                }
            })
            .await;
            assert_eq!(closed, Ok(true));
            server.stop();
        });
    }

    #[test]
    fn discovery_finds_the_main_pc_by_name() {
        tauri::async_runtime::block_on(async {
            let rec = Rec::new();
            let server = main_pc(&rec, None).await;
            let target = SocketAddr::from((Ipv4Addr::LOCALHOST, server.udp_port));
            let found = ask(vec![(Ipv4Addr::LOCALHOST, vec![target])], Duration::from_millis(500), Vec::new(), true).await;
            assert_eq!(found, vec![FoundLink { host: "127.0.0.1".into(), port: server.tcp_port, name: "PC-DO-JOGO".into() }]);
            // Own replies are skipped in real use.
            assert!(ask(vec![(Ipv4Addr::LOCALHOST, vec![target])], Duration::from_millis(400), Vec::new(), false).await.is_empty());
            server.stop();
        });
    }

    #[test]
    fn found_replies_are_checked() {
        let nets = net::parse_nets("192.168.1.5/24/Public\n");
        let ok = parse_found(br#"{"moa":"link","v":1,"port":8789,"name":"PC-JOGO"}"#, "192.168.1.9:8790".parse().unwrap(), &nets);
        assert_eq!(ok.map(|f| f.name), Some("PC-JOGO".into()), "a Public home network still links");
        assert!(parse_found(br#"{"moa":"link","v":1,"port":8789,"name":"PC"}"#, "8.8.8.8:8790".parse().unwrap(), &nets).is_none());
        assert!(parse_found(br#"{"moa":"party","v":1,"port":8789,"name":"PC"}"#, "192.168.1.9:8790".parse().unwrap(), &nets).is_none());
        assert!(parse_found(br#"{"moa":"link","v":1,"port":8789,"name":""}"#, "192.168.1.9:8790".parse().unwrap(), &nets).is_none());
    }

    /// Links over this PC's real home / Radmin addresses (what a second PC
    /// would use): discovery by broadcast, pairing, and an event both ways.
    /// cargo test link_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn link_live() {
        tauri::async_runtime::block_on(async {
            let nets = net::local_nets();
            println!("nets: {:?}", nets.iter().map(|n| (n.ip.to_string(), n.kind, n.public)).collect::<Vec<_>>());
            for n in &nets {
                let main_rec = Rec::new();
                let screen_rec = Rec::new();
                let all = nets.clone();
                let cfg = ServerCfg {
                    name: "PC-DO-JOGO".into(),
                    notify: main_rec.notify(),
                    scan: Arc::new(|| None),
                    store: None,
                    nets: Arc::new(move || all.clone()),
                };
                let server = Server::start(cfg, n.ip, 0, 0).await.expect("server on network address");
                // Found by asking the subnet's broadcast address, like the real search.
                let found = ask(vec![(n.ip, vec![SocketAddr::from((n.broadcast(), server.udp_port)), SocketAddr::from((n.ip, server.udp_port))])], Duration::from_millis(800), nets.clone(), true).await;
                println!("{}: found {:?}", n.ip, found);
                assert!(found.iter().any(|f| f.host == n.ip.to_string()), "found on {}", n.ip);
                // Outside the home network a link starts with a click.
                let manual = n.kind != net::NetKind::Lan;
                let client = start_client(n.ip.to_string(), server.tcp_port, ClientCfg { device: DEV.into(), name: "PC-DO-MAPA".into(), emit: screen_rec.notify(), manual });
                if n.kind == net::NetKind::Lan {
                    // Same router: links on its own, no question.
                    main_rec.wait_for("link-auto", |_| true).await;
                    println!("{}: linked on its own (home network)", n.ip);
                } else {
                    let req = main_rec.wait_for("link-request", |_| true).await;
                    server.answer(req["id"].as_str().unwrap(), true);
                }
                screen_rec.wait_for("link-client", |v| v["state"] == "linked").await;
                let t = Instant::now();
                server.forward("player-position", r#"{"x":1,"y":2,"z":3,"rotation":4}"#);
                screen_rec.wait_for("player-position", |v| v["x"] == 1).await;
                println!("{}: linked, event arrived in {} ms", n.ip, t.elapsed().as_millis());
                client.stop();
                server.stop();
            }
            println!("LINK OK on {} network(s)", nets.len());
        });
    }

    #[test]
    fn home_network_pcs_link_on_their_own_radmin_ones_ask() {
        let nets = net::parse_nets("192.168.1.5/24/Public\n26.1.1.1/8/Public\n");
        let home = |s: &str| on_home_network(&s.parse::<std::net::IpAddr>().unwrap(), &nets);
        assert!(home("192.168.1.20"), "same router");
        assert!(!home("26.5.5.5"), "Radmin is not home");
        assert!(!home("192.168.7.20"), "another network");
        assert!(!home("127.0.0.1"));
        assert_eq!(first_contact(home("192.168.1.20"), true, false, false), FirstContact::Accept, "same router: on its own");
        assert_eq!(first_contact(home("26.5.5.5"), true, true, false), FirstContact::Ask, "Radmin, clicked: asks");
        assert_eq!(first_contact(home("192.168.1.20"), false, false, false), FirstContact::Ask, "turned off: asks");
    }

    #[test]
    fn codes_are_four_digits() {
        for _ in 0..50 {
            assert!(valid_code(&new_code()));
        }
    }
}
