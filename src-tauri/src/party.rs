// Party over a VPN LAN (Radmin VPN): no server to run, no code to type.
//
// "Join party" first asks the Radmin network whether anyone is already hosting
// (a UDP broadcast, the way LAN games find each other). If someone answers,
// the app connects to that player's relay. If nobody does, this app becomes the
// host: it starts the same squad relay the Node server runs (server/src),
// ported here so it needs nothing installed, and answers the next player's
// question.
//
// Exposure: the relay listens on 127.0.0.1 and on the Radmin addresses only —
// never on the home LAN or the internet — and the firewall rule this module
// asks for is limited to the Radmin range (26.0.0.0/8).
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::tungstenite::protocol::{Message, WebSocketConfig};

pub const RELAY_PORT: u16 = 8787;
pub const DISCOVERY_PORT: u16 = 8788;
/// Must match shared/squadProtocol.ts PROTOCOL_VERSION.
const PROTOCOL_VERSION: f64 = 2.0;
const MAX_FRAME: usize = 64 * 1024;
const RATE_PER_SEC: f64 = 15.0;
const RATE_BURST: f64 = 40.0;
const NAME_MAX: usize = 24;
const MAX_CONNECTIONS: usize = 32;
const MAX_ROOMS: usize = 8;
/// Clients send a heartbeat every 20 s; three missed ones drop the socket.
const IDLE_LIMIT: Duration = Duration::from_secs(70);
/// shared/squadProtocol.ts SQUAD_COLORS, in order.
const COLORS: [&str; 8] = ["cyan", "orange", "violet", "pink", "green", "blue", "red", "white"];
const RELAYED: [&str; 6] = ["position", "quests", "marker-add", "marker-remove", "draw-add", "draw-remove"];
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const QUERY: &[u8] = b"MOA-PARTY?1";
const FIREWALL_SCRIPT: &str = include_str!("../../scripts/party-firewall.ps1");

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Same rule as the Node relay: drop C0 controls and DEL, trim, cap length.
pub fn sanitize_name(raw: &str) -> String {
    let kept: String = raw.chars().filter(|c| (*c as u32) >= 32 && *c as u32 != 127).collect();
    kept.trim().chars().take(NAME_MAX).collect()
}

fn first_free_color(taken: &[String], prefer: Option<&str>) -> Option<&'static str> {
    if let Some(p) = prefer {
        if let Some(c) = COLORS.iter().find(|c| **c == p) {
            if !taken.iter().any(|t| t == c) {
                return Some(c);
            }
        }
    }
    COLORS.iter().copied().find(|c| !taken.iter().any(|t| t == c))
}

fn envelope(kind: &str, payload: Value) -> String {
    json!({ "v": 2, "kind": kind, "from": "server", "ts": now_ms(), "payload": payload }).to_string()
}

fn error_frame(code: &str, message: &str) -> String {
    envelope("error", json!({ "code": code, "message": message }))
}

struct Member {
    name: String,
    color_id: String,
    last_seen: i64,
    tx: mpsc::UnboundedSender<Message>,
}

impl Member {
    fn to_json(&self, id: &str) -> Value {
        json!({ "id": id, "name": self.name, "colorId": self.color_id, "lastSeenTs": self.last_seen })
    }
}

#[derive(Default)]
struct Relay {
    rooms: HashMap<String, HashMap<String, Member>>,
    connections: usize,
}

impl Relay {
    fn new_code(&self) -> String {
        loop {
            // uuid v4 is CSPRNG-backed; codes gate a room, so they must not be guessable.
            let bytes = uuid::Uuid::new_v4().into_bytes();
            let code: String = bytes[..8].iter().map(|b| CODE_ALPHABET[(*b as usize) % CODE_ALPHABET.len()] as char).collect();
            if !self.rooms.contains_key(&code) {
                return code;
            }
        }
    }

    fn broadcast(&self, room: &str, except: &str, frame: &str) {
        if let Some(members) = self.rooms.get(room) {
            for (id, m) in members {
                if id != except {
                    let _ = m.tx.send(Message::text(frame.to_owned()));
                }
            }
        }
    }

    /// The JOIN handshake. Returns (room code, member id) on success; on
    /// failure the error frame has already been queued.
    fn join(&mut self, payload: &Value, tx: &mpsc::UnboundedSender<Message>) -> Option<(String, String)> {
        let reply = |frame: String| {
            let _ = tx.send(Message::text(frame));
        };
        let name = sanitize_name(payload.get("name").and_then(|v| v.as_str()).unwrap_or(""));
        if name.is_empty() {
            reply(error_frame("name_required", "A display name is required"));
            return None;
        }
        let wanted = payload
            .get("code")
            .and_then(|v| v.as_str())
            .map(|c| c.trim().to_uppercase())
            .filter(|c| !c.is_empty());
        let code = match wanted {
            Some(c) if self.rooms.contains_key(&c) => c,
            Some(_) => {
                reply(error_frame("bad_code", "No squad with that code"));
                return None;
            }
            None => {
                if self.rooms.len() >= MAX_ROOMS {
                    reply(error_frame("squad_full", "Server is at capacity — try again later"));
                    return None;
                }
                let c = self.new_code();
                self.rooms.insert(c.clone(), HashMap::new());
                c
            }
        };
        let room = self.rooms.get_mut(&code)?;
        let taken: Vec<String> = room.values().map(|m| m.color_id.clone()).collect();
        let prefer = payload.get("colorPref").and_then(|v| v.as_str());
        let Some(color) = (if room.len() >= COLORS.len() { None } else { first_free_color(&taken, prefer) }) else {
            reply(error_frame("squad_full", "That squad is full"));
            return None;
        };
        let id = uuid::Uuid::new_v4().to_string();
        let member = Member { name, color_id: color.to_owned(), last_seen: now_ms(), tx: tx.clone() };
        let member_json = member.to_json(&id);
        room.insert(id.clone(), member);
        let roster: Vec<Value> = room.iter().map(|(mid, m)| m.to_json(mid)).collect();
        reply(envelope("joined", json!({ "code": code, "selfId": id, "colorId": color, "members": roster })));
        self.broadcast(&code, &id, &envelope("peer-join", json!({ "member": member_json })));
        Some((code, id))
    }

    fn leave(&mut self, room: &str, id: &str) {
        let empty = match self.rooms.get_mut(room) {
            Some(members) => {
                members.remove(id);
                members.is_empty()
            }
            None => return,
        };
        if empty {
            self.rooms.remove(room);
        } else {
            self.broadcast(room, id, &envelope("peer-leave", json!({ "id": id })));
        }
    }

    /// Code of the party's room (the oldest one), for discovery replies.
    fn party_room(&self) -> Option<String> {
        self.rooms.keys().min().cloned()
    }
}

/// What one text frame asks the relay to do (pure, for tests).
#[derive(Debug, PartialEq)]
enum Frame {
    Ignore,
    VersionMismatch,
    Join(Value),
    Heartbeat,
    Relay { kind: String, envelope: Value },
}

fn classify(text: &str) -> Frame {
    let Ok(v) = serde_json::from_str::<Value>(text) else { return Frame::Ignore };
    let Some(obj) = v.as_object() else { return Frame::Ignore };
    let Some(ver) = obj.get("v").and_then(|x| x.as_f64()) else { return Frame::Ignore };
    if ver != PROTOCOL_VERSION {
        return Frame::VersionMismatch;
    }
    let (Some(kind), true, true, true) = (
        obj.get("kind").and_then(|k| k.as_str()),
        obj.get("from").map(|f| f.is_string()).unwrap_or(false),
        obj.get("ts").map(|t| t.is_number()).unwrap_or(false),
        obj.contains_key("payload"),
    ) else {
        return Frame::Ignore;
    };
    match kind {
        "join" => Frame::Join(obj["payload"].clone()),
        "heartbeat" => Frame::Heartbeat,
        k if RELAYED.contains(&k) => Frame::Relay { kind: k.to_owned(), envelope: v.clone() },
        _ => Frame::Ignore,
    }
}

async fn handle_socket(stream: TcpStream, relay: Arc<Mutex<Relay>>, mut stop: watch::Receiver<bool>) {
    let cfg = WebSocketConfig::default().max_message_size(Some(MAX_FRAME)).max_frame_size(Some(MAX_FRAME));
    let Ok(ws) = tokio_tungstenite::accept_async_with_config(stream, Some(cfg)).await else { return };
    {
        let mut r = relay.lock().unwrap();
        if r.connections >= MAX_CONNECTIONS {
            return;
        }
        r.connections += 1;
    }
    let (mut sink, mut source) = ws.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let mut joined: Option<(String, String)> = None;
    let mut tokens = RATE_BURST;
    let mut last = Instant::now();
    let mut last_rate_err: Option<Instant> = None;
    loop {
        let next = tokio::select! {
            _ = stop.changed() => break,
            r = tokio::time::timeout(IDLE_LIMIT, source.next()) => r,
        };
        let text = match next {
            Ok(Some(Ok(Message::Text(t)))) => t.as_str().to_owned(),
            Ok(Some(Ok(Message::Close(_)))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
            Ok(Some(Ok(_))) => continue,
        };
        // Token bucket, before any parsing.
        let now = Instant::now();
        tokens = (tokens + now.duration_since(last).as_secs_f64() * RATE_PER_SEC).min(RATE_BURST);
        last = now;
        if tokens < 1.0 {
            if last_rate_err.map(|t| now.duration_since(t) > Duration::from_secs(2)).unwrap_or(true) {
                last_rate_err = Some(now);
                let _ = tx.send(Message::text(error_frame("rate_limited", "Slow down")));
            }
            continue;
        }
        tokens -= 1.0;

        match classify(&text) {
            Frame::Ignore => {}
            Frame::VersionMismatch => {
                let _ = tx.send(Message::text(error_frame("protocol_mismatch", "Please update the app to the latest version")));
            }
            Frame::Join(payload) => {
                if joined.is_none() {
                    joined = relay.lock().unwrap().join(&payload, &tx);
                }
            }
            Frame::Heartbeat | Frame::Relay { .. } => {
                let Some((room, id)) = &joined else { continue };
                let mut r = relay.lock().unwrap();
                if let Some(m) = r.rooms.get_mut(room).and_then(|members| members.get_mut(id)) {
                    m.last_seen = now_ms();
                }
                if let Frame::Relay { envelope: mut env, .. } = classify(&text) {
                    // Never trust a client-supplied origin: re-stamp it.
                    env["from"] = json!(id);
                    env["ts"] = json!(now_ms());
                    r.broadcast(room, id, &env.to_string());
                }
            }
        }
    }

    {
        let mut r = relay.lock().unwrap();
        if let Some((room, id)) = &joined {
            r.leave(room, id);
        }
        r.connections = r.connections.saturating_sub(1);
    }
    drop(tx);
    let _ = writer.await;
}

// ---- network addresses -------------------------------------------------------

/// This PC's Radmin VPN addresses (26.0.0.0/8).
pub fn radmin_ips() -> Vec<Ipv4Addr> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let out = std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let mut ips = out.map(|o| parse_radmin_ips(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default();
        // PowerShell can be missing, slow or blocked on some PCs. The route to
        // the Radmin network tells the same thing: ask the OS which local
        // address it would use to reach 26.0.0.1 (nothing is sent).
        if ips.is_empty() {
            if let Some(ip) = radmin_route_ip() {
                ips.push(ip);
            }
        }
        ips
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// The local address the OS picks to reach the Radmin network, if it is one.
fn radmin_route_ip() -> Option<Ipv4Addr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("26.0.0.1:9").ok()?;
    match sock.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v4) if v4.octets()[0] == 26 => Some(v4),
        _ => None,
    }
}

fn parse_radmin_ips(text: &str) -> Vec<Ipv4Addr> {
    text.lines().filter_map(|l| l.trim().parse::<Ipv4Addr>().ok()).filter(|ip| ip.octets()[0] == 26).collect()
}

fn is_radmin(ip: &std::net::IpAddr) -> bool {
    matches!(ip, std::net::IpAddr::V4(v4) if v4.octets()[0] == 26)
}

// ---- hosting ------------------------------------------------------------------

struct Running {
    stop: watch::Sender<bool>,
    ips: Vec<Ipv4Addr>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static CELL: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    port: u16,
    ips: Vec<String>,
    /// Whether the Radmin-only firewall rule is in place (false if the player
    /// declined the Windows prompt: the party still runs, others may not reach it).
    firewall: bool,
}

async fn accept_loop(listener: TcpListener, relay: Arc<Mutex<Relay>>, mut stop: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = listener.accept() => {
                if let Ok((stream, peer)) = r {
                    // Loopback (this PC) or the Radmin network only.
                    if peer.ip().is_loopback() || is_radmin(&peer.ip()) {
                        tauri::async_runtime::spawn(handle_socket(stream, relay.clone(), stop.clone()));
                    }
                }
            }
        }
    }
}

async fn discovery_responder(sock: UdpSocket, relay: Arc<Mutex<Relay>>, mut stop: watch::Receiver<bool>) {
    let mut buf = [0u8; 64];
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = sock.recv_from(&mut buf) => {
                let Ok((n, from)) = r else { continue };
                if &buf[..n] != QUERY || !is_radmin(&from.ip()) {
                    continue;
                }
                let room = relay.lock().unwrap().party_room();
                if let Some(room) = room {
                    let reply = json!({ "moa": "party", "v": 1, "port": RELAY_PORT, "room": room }).to_string();
                    let _ = sock.send_to(reply.as_bytes(), from).await;
                }
            }
        }
    }
}

fn firewall_rules_present() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-Command",
                "if ((Get-NetFirewallRule -DisplayName 'Tarkov MoA party' -ErrorAction SilentlyContinue) -and (Get-NetFirewallRule -DisplayName 'Tarkov MoA party (busca)' -ErrorAction SilentlyContinue)) { exit 0 } else { exit 1 }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        true
    }
}

/// Asks Windows (UAC prompt) to let the Radmin network reach the party ports.
fn request_firewall_rules() -> bool {
    let path = std::env::temp_dir().join("tarkov-moa-party-firewall.ps1");
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(FIREWALL_SCRIPT.as_bytes());
    if std::fs::write(&path, bytes).is_err() {
        return false;
    }
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"])
        .arg(&path)
        .status();
    status.map(|s| s.success()).unwrap_or(false) && firewall_rules_present()
}

/// Start hosting (idempotent). Errors: "no_radmin" when Radmin VPN is off,
/// "port_busy" when another program holds the relay port.
#[tauri::command]
pub async fn party_host_start() -> Result<HostInfo, String> {
    start_hosting(true).await
}

async fn start_hosting(check_firewall: bool) -> Result<HostInfo, String> {
    if let Some(r) = running().lock().unwrap().as_ref() {
        return Ok(HostInfo { port: RELAY_PORT, ips: r.ips.iter().map(|i| i.to_string()).collect(), firewall: true });
    }
    let ips = tauri::async_runtime::spawn_blocking(radmin_ips).await.map_err(|e| e.to_string())?;
    if ips.is_empty() {
        return Err("no_radmin".into());
    }
    let mut listeners = Vec::new();
    for addr in std::iter::once(Ipv4Addr::LOCALHOST).chain(ips.iter().copied()) {
        match TcpListener::bind(SocketAddr::from((addr, RELAY_PORT))).await {
            Ok(l) => listeners.push(l),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return Err("port_busy".into()),
            Err(e) => return Err(e.to_string()),
        }
    }
    let udp = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)))
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::AddrInUse { "port_busy".to_string() } else { e.to_string() })?;

    let firewall = if check_firewall {
        tauri::async_runtime::spawn_blocking(|| firewall_rules_present() || request_firewall_rules())
            .await
            .unwrap_or(false)
    } else {
        false
    };

    let relay = Arc::new(Mutex::new(Relay::default()));
    let (stop_tx, stop_rx) = watch::channel(false);
    for l in listeners {
        tauri::async_runtime::spawn(accept_loop(l, relay.clone(), stop_rx.clone()));
    }
    tauri::async_runtime::spawn(discovery_responder(udp, relay.clone(), stop_rx));
    let info = HostInfo { port: RELAY_PORT, ips: ips.iter().map(|i| i.to_string()).collect(), firewall };
    *running().lock().unwrap() = Some(Running { stop: stop_tx, ips });
    Ok(info)
}

/// Stop hosting: every socket is closed, which tells the others to look again.
#[tauri::command]
pub fn party_host_stop() {
    if let Some(r) = running().lock().unwrap().take() {
        let _ = r.stop.send(true);
    }
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundParty {
    host: String,
    port: u16,
    room: String,
}

fn parse_reply(bytes: &[u8], from: SocketAddr) -> Option<FoundParty> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    if v.get("moa")?.as_str()? != "party" {
        return None;
    }
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    let room = v.get("room")?.as_str()?.to_owned();
    if room.is_empty() || room.len() > 16 || !room.bytes().all(|b| CODE_ALPHABET.contains(&b)) {
        return None;
    }
    if !is_radmin(&from.ip()) {
        return None;
    }
    Some(FoundParty { host: from.ip().to_string(), port, room })
}

/// Ask the Radmin network for a party already running. `hints` are addresses
/// to ask directly as well (the last host), in case broadcast does not reach.
#[tauri::command]
pub async fn party_find(hints: Vec<String>, timeout_ms: Option<u64>) -> Result<Option<FoundParty>, String> {
    find(hints, timeout_ms, false).await
}

/// `include_self` lets a test on one PC find its own party.
async fn find(hints: Vec<String>, timeout_ms: Option<u64>, include_self: bool) -> Result<Option<FoundParty>, String> {
    let ips = tauri::async_runtime::spawn_blocking(radmin_ips).await.map_err(|e| e.to_string())?;
    if ips.is_empty() {
        return Err("no_radmin".into());
    }
    let wait = Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(300, 5000));
    let own: Vec<std::net::IpAddr> = ips.iter().map(|i| (*i).into()).collect();
    let mut socks = Vec::new();
    for ip in &ips {
        let Ok(sock) = UdpSocket::bind(SocketAddr::from((*ip, 0))).await else { continue };
        let _ = sock.set_broadcast(true);
        let _ = sock.send_to(QUERY, SocketAddr::from((Ipv4Addr::new(26, 255, 255, 255), DISCOVERY_PORT))).await;
        for h in &hints {
            if let Ok(hip) = h.parse::<Ipv4Addr>() {
                if hip.octets()[0] == 26 && !ips.contains(&hip) {
                    let _ = sock.send_to(QUERY, SocketAddr::from((hip, DISCOVERY_PORT))).await;
                }
            }
        }
        socks.push(sock);
    }
    if socks.is_empty() {
        return Ok(None);
    }
    // One listener per Radmin address; the first valid answer from another PC wins.
    let (found_tx, mut found_rx) = mpsc::unbounded_channel::<FoundParty>();
    let mut tasks = Vec::new();
    for sock in socks {
        let found_tx = found_tx.clone();
        let own = own.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut buf = [0u8; 256];
            while let Ok((n, from)) = sock.recv_from(&mut buf).await {
                if !include_self && own.contains(&from.ip()) {
                    continue;
                }
                if let Some(found) = parse_reply(&buf[..n], from) {
                    let _ = found_tx.send(found);
                    return;
                }
            }
        }));
    }
    drop(found_tx);
    let result = tokio::time::timeout(wait, found_rx.recv()).await.ok().flatten();
    for t in tasks {
        t.abort();
    }
    Ok(result)
}

/// Radmin addresses of this PC, for the UI ("Radmin VPN is off" otherwise).
#[tauri::command]
pub async fn party_radmin_ips() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(radmin_ips)
        .await
        .map(|ips| ips.iter().map(|i| i.to_string()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_sanitized_like_the_node_relay() {
        assert_eq!(sanitize_name("  Pestily\u{7}  "), "Pestily");
        assert_eq!(sanitize_name(&"x".repeat(40)).len(), NAME_MAX);
        assert_eq!(sanitize_name("\u{1}\u{2}"), "");
    }

    #[test]
    fn seats_the_preferred_color_or_the_next_free_one() {
        assert_eq!(first_free_color(&[], Some("red")), Some("red"));
        assert_eq!(first_free_color(&["red".into()], Some("red")), Some("cyan"));
        assert_eq!(first_free_color(&COLORS.iter().map(|c| c.to_string()).collect::<Vec<_>>(), None), None);
    }

    #[test]
    fn classifies_frames() {
        assert_eq!(classify("not json"), Frame::Ignore);
        assert_eq!(classify(r#"{"v":1,"kind":"join","from":"","ts":1,"payload":{}}"#), Frame::VersionMismatch);
        assert!(matches!(classify(r#"{"v":2,"kind":"join","from":"","ts":1,"payload":{"name":"A"}}"#), Frame::Join(_)));
        assert_eq!(classify(r#"{"v":2,"kind":"heartbeat","from":"","ts":1,"payload":{}}"#), Frame::Heartbeat);
        assert!(matches!(classify(r#"{"v":2,"kind":"position","from":"x","ts":1,"payload":{}}"#), Frame::Relay { .. }));
        assert_eq!(classify(r#"{"v":2,"kind":"joined","from":"","ts":1,"payload":{}}"#), Frame::Ignore);
        assert_eq!(classify(r#"{"v":2,"kind":"position","ts":1,"payload":{}}"#), Frame::Ignore);
    }

    #[test]
    fn join_create_then_join_by_code_then_leave() {
        let mut relay = Relay::default();
        let (tx_a, mut rx_a) = mpsc::unbounded_channel();
        let (room, a) = relay.join(&json!({ "code": null, "name": "A", "colorPref": "red" }), &tx_a).unwrap();
        let joined: Value = serde_json::from_str(rx_a.try_recv().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(joined["kind"], "joined");
        assert_eq!(joined["payload"]["colorId"], "red");
        let (tx_b, _rx_b) = mpsc::unbounded_channel();
        let (room_b, b) = relay.join(&json!({ "code": room.to_lowercase(), "name": "B", "colorPref": "red" }), &tx_b).unwrap();
        assert_eq!(room_b, room);
        let peer: Value = serde_json::from_str(rx_a.try_recv().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(peer["kind"], "peer-join");
        assert_eq!(peer["payload"]["member"]["colorId"], "cyan");
        assert_eq!(relay.party_room(), Some(room.clone()));
        relay.leave(&room, &b);
        let left: Value = serde_json::from_str(rx_a.try_recv().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(left["kind"], "peer-leave");
        relay.leave(&room, &a);
        assert!(relay.rooms.is_empty());
        // A wrong code is refused.
        let (tx_c, mut rx_c) = mpsc::unbounded_channel();
        assert!(relay.join(&json!({ "code": "NOPE1234", "name": "C" }), &tx_c).is_none());
        let err: Value = serde_json::from_str(rx_c.try_recv().unwrap().to_text().unwrap()).unwrap();
        assert_eq!(err["payload"]["code"], "bad_code");
    }

    #[test]
    fn only_radmin_addresses_and_valid_replies_count() {
        assert_eq!(parse_radmin_ips("192.168.0.5\n26.1.2.3\r\n127.0.0.1\n"), vec![Ipv4Addr::new(26, 1, 2, 3)]);
        let from: SocketAddr = "26.9.9.9:8788".parse().unwrap();
        let ok = parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345"}"#, from).unwrap();
        assert_eq!(ok, FoundParty { host: "26.9.9.9".into(), port: 8787, room: "ABCD2345".into() });
        assert!(parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345"}"#, "192.168.1.9:8788".parse().unwrap()).is_none());
        assert!(parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"bad code!"}"#, from).is_none());
    }

    /// Hosts on this PC's Radmin address, finds it by broadcast, then keeps
    /// running for MOA_PARTY_SECS so external clients can be pointed at it.
    /// cargo test party_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn party_live() {
        tauri::async_runtime::block_on(async {
            let info = start_hosting(false).await.expect("host");
            println!("hosting on {} address(es), port {}", info.ips.len(), info.port);
            // Nobody has joined yet: discovery stays quiet until a room exists.
            assert!(find(vec![], Some(800), true).await.unwrap().is_none());
            println!("READY");
            let secs: u64 = std::env::var("MOA_PARTY_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(5);
            let deadline = tokio::time::Instant::now() + Duration::from_secs(secs);
            let mut seen = false;
            while tokio::time::Instant::now() < deadline {
                if let Ok(Some(f)) = find(vec![], Some(800), true).await {
                    if !seen {
                        println!("FOUND port={} room_len={}", f.port, f.room.len());
                        seen = true;
                    }
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            party_host_stop();
            println!("STOPPED found={seen}");
        });
    }
}
