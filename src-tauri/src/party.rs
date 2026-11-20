// Party over Radmin VPN or the home network: no server to run, no code to type.
//
// "Join party" first asks the networks whether anyone is already hosting
// (a UDP broadcast, the way LAN games find each other). If someone answers,
// the app connects to that player's relay. If nobody does, this app becomes the
// host: it starts the same squad relay the Node server runs (server/src),
// ported here so it needs nothing installed, and answers the next player's
// question.
//
// Exposure: the relay listens on 127.0.0.1, the Radmin addresses and the home
// network addresses Windows calls Private (see net.rs); it refuses peers from
// any other network, and the firewall rules this module asks for are limited
// to the Radmin range and the local subnet. Never the internet.
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

use crate::net::{self, LocalNet, NetKind};

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

// ---- networks -------------------------------------------------------------------

/// The networks the party may use: Radmin, and home networks Windows calls
/// Private. A Public home network (a café's Wi-Fi) is left out: the party has
/// no password.
fn party_nets(all: &[LocalNet]) -> Vec<LocalNet> {
    all.iter().copied().filter(|n| n.kind == NetKind::Radmin || !n.public).collect()
}

/// Why there is no network to use, as an error code for the UI.
fn no_network_code(all: &[LocalNet]) -> String {
    if all.is_empty() {
        "no_network".into()
    } else {
        "lan_public".into()
    }
}

/// This PC's Radmin VPN addresses (26.0.0.0/8).
pub fn radmin_ips() -> Vec<Ipv4Addr> {
    net::local_nets().into_iter().filter(|n| n.kind == NetKind::Radmin).map(|n| n.ip).collect()
}

// ---- hosting ------------------------------------------------------------------

/// A relay and its discovery responder, running until `stop` is sent.
pub(crate) struct HostHandle {
    stop: watch::Sender<bool>,
    pub tcp_port: u16,
    #[cfg_attr(not(test), allow(dead_code))]
    pub udp_port: u16,
    /// Random per hosting session; when two PCs host at once, the one with
    /// the higher id joins the other (addresses differ per network, ids do not).
    pub id: String,
}

impl HostHandle {
    pub fn stop(&self) {
        let _ = self.stop.send(true);
    }
}

/// Binds the relay on `bind` (TCP) and the discovery responder on all
/// addresses (UDP). Port 0 picks free ports (tests). Peers outside `nets` are
/// refused on both.
pub(crate) async fn spawn_host(bind: Vec<Ipv4Addr>, tcp_port: u16, udp_port: u16, nets: Vec<LocalNet>) -> Result<HostHandle, String> {
    let mut listeners = Vec::new();
    let mut port = tcp_port;
    for addr in bind {
        match TcpListener::bind(SocketAddr::from((addr, port))).await {
            Ok(l) => {
                net::no_inherit(&l);
                port = l.local_addr().map(|a| a.port()).unwrap_or(port);
                listeners.push(l);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => return Err("port_busy".into()),
            // An address that went away between asking and binding (Radmin
            // reconnecting): skip it, the others still work.
            Err(e) => net::log(format!("party: não deu para escutar em {addr}: {e}")),
        }
    }
    if listeners.is_empty() {
        return Err("no_network".into());
    }
    let udp = UdpSocket::bind(SocketAddr::from((Ipv4Addr::UNSPECIFIED, udp_port)))
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::AddrInUse { "port_busy".to_string() } else { e.to_string() })?;
    net::no_inherit(&udp);
    let udp_port = udp.local_addr().map(|a| a.port()).unwrap_or(udp_port);
    let id = uuid::Uuid::new_v4().simple().to_string();
    let relay = Arc::new(Mutex::new(Relay::default()));
    let (stop_tx, stop_rx) = watch::channel(false);
    let nets = Arc::new(nets);
    for l in listeners {
        tauri::async_runtime::spawn(accept_loop(l, relay.clone(), stop_rx.clone(), nets.clone()));
    }
    tauri::async_runtime::spawn(discovery_responder(udp, relay, stop_rx, nets, port, id.clone()));
    Ok(HostHandle { stop: stop_tx, tcp_port: port, udp_port, id })
}

struct Running {
    handle: HostHandle,
    ips: Vec<Ipv4Addr>,
}

fn running() -> &'static Mutex<Option<Running>> {
    static CELL: OnceLock<Mutex<Option<Running>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

pub fn is_hosting() -> bool {
    running().lock().unwrap().is_some()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    port: u16,
    ips: Vec<String>,
    /// Whether the firewall rules are in place (false if the player declined
    /// the Windows prompt: the party still runs, others may not reach it).
    firewall: bool,
    id: String,
}

async fn accept_loop(listener: TcpListener, relay: Arc<Mutex<Relay>>, mut stop: watch::Receiver<bool>, nets: Arc<Vec<LocalNet>>) {
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = listener.accept() => {
                if let Ok((stream, peer)) = r {
                    net::no_inherit(&stream);
                    if net::peer_allowed(&peer.ip(), &nets, false) {
                        tauri::async_runtime::spawn(handle_socket(stream, relay.clone(), stop.clone()));
                    } else {
                        net::log(format!("party: recusado {} (fora das redes deste PC)", peer.ip()));
                    }
                }
            }
        }
    }
}

async fn discovery_responder(
    sock: UdpSocket,
    relay: Arc<Mutex<Relay>>,
    mut stop: watch::Receiver<bool>,
    nets: Arc<Vec<LocalNet>>,
    port: u16,
    id: String,
) {
    let mut buf = [0u8; 64];
    loop {
        tokio::select! {
            _ = stop.changed() => return,
            r = sock.recv_from(&mut buf) => {
                let Ok((n, from)) = r else { continue };
                if &buf[..n] != QUERY || !net::peer_allowed(&from.ip(), &nets, false) {
                    continue;
                }
                let room = relay.lock().unwrap().party_room();
                if let Some(room) = room {
                    let reply = json!({ "moa": "party", "v": 1, "port": port, "room": room, "id": id }).to_string();
                    let _ = sock.send_to(reply.as_bytes(), from).await;
                }
            }
        }
    }
}

const FIREWALL_RULES: [&str; 5] = [
    "Tarkov MoA party",
    "Tarkov MoA party (busca)",
    "Tarkov MoA rede de casa",
    "Tarkov MoA rede de casa (busca)",
    "Tarkov MoA celular",
];

pub fn firewall_rules_present() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let checks: Vec<String> = FIREWALL_RULES
            .iter()
            .map(|n| format!("(Get-NetFirewallRule -DisplayName '{n}' -ErrorAction SilentlyContinue)"))
            .collect();
        let script = format!("if ({}) {{ exit 0 }} else {{ exit 1 }}", checks.join(" -and "));
        std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", &script])
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

/// The rule that lets the phone reach the map over Tailscale (TCP 8791 from
/// 100.64.0.0/10 only). Checked apart from the others: it is only needed by
/// whoever uses the map away from home.
pub fn phone_remote_rule_present() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "if (Get-NetFirewallRule -DisplayName 'Tarkov MoA celular (Tailscale)' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"])
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

/// Asks Windows (UAC prompt) to let Radmin and the home network reach MoA's ports.
pub fn request_firewall_rules() -> bool {
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
    let ok = status.map(|s| s.success()).unwrap_or(false) && firewall_rules_present();
    net::log(if ok { "firewall: liberado" } else { "firewall: não liberado (recusado ou falhou)" });
    ok
}

/// Asks for the firewall rules now (the connection test's "fix" button).
#[tauri::command]
pub async fn party_firewall_request() -> bool {
    tauri::async_runtime::spawn_blocking(|| firewall_rules_present() || request_firewall_rules()).await.unwrap_or(false)
}

/// Start hosting (idempotent). Errors: "no_network" when there is neither
/// Radmin nor a home network, "lan_public" when the only one is Public,
/// "port_busy" when another program holds the relay port.
#[tauri::command]
pub async fn party_host_start() -> Result<HostInfo, String> {
    let r = start_hosting(true).await;
    match &r {
        Ok(h) => net::log(format!("party: hospedando em {} (firewall {})", h.ips.join(", "), if h.firewall { "ok" } else { "NÃO liberado" })),
        Err(e) => net::log(format!("party: não deu para hospedar: {e}")),
    }
    r
}

async fn start_hosting(check_firewall: bool) -> Result<HostInfo, String> {
    if let Some(r) = running().lock().unwrap().as_ref() {
        return Ok(HostInfo {
            port: r.handle.tcp_port,
            ips: r.ips.iter().map(|i| i.to_string()).collect(),
            firewall: true,
            id: r.handle.id.clone(),
        });
    }
    let all = tauri::async_runtime::spawn_blocking(net::local_nets).await.map_err(|e| e.to_string())?;
    let nets = party_nets(&all);
    if nets.is_empty() {
        return Err(no_network_code(&all));
    }
    let ips: Vec<Ipv4Addr> = nets.iter().map(|n| n.ip).collect();
    let bind: Vec<Ipv4Addr> = std::iter::once(Ipv4Addr::LOCALHOST).chain(ips.iter().copied()).collect();
    let handle = spawn_host(bind, RELAY_PORT, DISCOVERY_PORT, nets).await?;

    let firewall = if check_firewall {
        tauri::async_runtime::spawn_blocking(|| firewall_rules_present() || request_firewall_rules())
            .await
            .unwrap_or(false)
    } else {
        false
    };
    let info = HostInfo { port: handle.tcp_port, ips: ips.iter().map(|i| i.to_string()).collect(), firewall, id: handle.id.clone() };
    *running().lock().unwrap() = Some(Running { handle, ips });
    Ok(info)
}

/// Stop hosting: every socket is closed, which tells the others to look again.
#[tauri::command]
pub fn party_host_stop() {
    if let Some(r) = running().lock().unwrap().take() {
        r.handle.stop();
        net::log("party: parou de hospedar");
    }
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundParty {
    pub host: String,
    pub port: u16,
    pub room: String,
    pub id: String,
}

fn parse_reply(bytes: &[u8], from: SocketAddr, nets: &[LocalNet]) -> Option<FoundParty> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    if v.get("moa")?.as_str()? != "party" {
        return None;
    }
    let port = u16::try_from(v.get("port")?.as_u64()?).ok()?;
    let room = v.get("room")?.as_str()?.to_owned();
    if room.is_empty() || room.len() > 16 || !room.bytes().all(|b| CODE_ALPHABET.contains(&b)) {
        return None;
    }
    // Older versions sent no id; their address stands in for it.
    let id: String = v.get("id").and_then(|i| i.as_str()).unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric()).take(40).collect();
    if !net::peer_allowed(&from.ip(), nets, false) {
        return None;
    }
    let id = if id.is_empty() { from.ip().to_string() } else { id };
    Some(FoundParty { host: from.ip().to_string(), port, room, id })
}

/// Sends the question from each (local address, targets) pair and returns the
/// first valid answer from another PC (or from this one with `include_self`).
async fn ask(binds: Vec<(Ipv4Addr, Vec<SocketAddr>)>, wait: Duration, nets: Vec<LocalNet>, include_self: bool) -> Option<FoundParty> {
    let own: Vec<std::net::IpAddr> = binds.iter().map(|(ip, _)| (*ip).into()).collect();
    let nets = Arc::new(nets);
    let (found_tx, mut found_rx) = mpsc::unbounded_channel::<FoundParty>();
    let mut tasks = Vec::new();
    for (ip, targets) in binds {
        let Ok(sock) = UdpSocket::bind(SocketAddr::from((ip, 0))).await else { continue };
        let _ = sock.set_broadcast(true);
        for t in &targets {
            let _ = sock.send_to(QUERY, t).await;
        }
        let found_tx = found_tx.clone();
        let own = own.clone();
        let nets = nets.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            let mut buf = [0u8; 256];
            while let Ok((n, from)) = sock.recv_from(&mut buf).await {
                if !include_self && own.contains(&from.ip()) {
                    continue;
                }
                if let Some(found) = parse_reply(&buf[..n], from, &nets) {
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
    result
}

/// Ask the networks for a party already running. `hints` are addresses to ask
/// directly as well (the last host, an IP typed by the player), in case a
/// broadcast does not get through (some routers drop them).
#[tauri::command]
pub async fn party_find(hints: Vec<String>, timeout_ms: Option<u64>) -> Result<Option<FoundParty>, String> {
    let r = find(hints.clone(), timeout_ms, false, DISCOVERY_PORT).await;
    match &r {
        Ok(Some(f)) => net::log(format!("party: achou party em {}", f.host)),
        Ok(None) if !hints.is_empty() => net::log(format!("party: ninguém respondeu (perguntou também a {})", hints.join(", "))),
        Ok(None) => {}
        Err(e) => net::log(format!("party: busca falhou: {e}")),
    }
    r
}

/// `include_self` lets a test on one PC find its own party.
async fn find(hints: Vec<String>, timeout_ms: Option<u64>, include_self: bool, udp_port: u16) -> Result<Option<FoundParty>, String> {
    let all = tauri::async_runtime::spawn_blocking(net::local_nets).await.map_err(|e| e.to_string())?;
    let nets = party_nets(&all);
    if nets.is_empty() {
        return Err(no_network_code(&all));
    }
    let wait = Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(300, 5000));
    let hints: Vec<Ipv4Addr> = hints.iter().filter_map(|h| h.trim().parse::<Ipv4Addr>().ok()).collect();
    let binds = nets
        .iter()
        .map(|n| {
            let mut targets = vec![SocketAddr::from((n.broadcast(), udp_port))];
            for h in &hints {
                if n.contains(*h) && *h != n.ip {
                    targets.push(SocketAddr::from((*h, udp_port)));
                }
            }
            (n.ip, targets)
        })
        .collect();
    Ok(ask(binds, wait, nets, include_self).await)
}

/// Radmin addresses of this PC (older UI; the new one uses net_local_ips).
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
    fn only_network_peers_and_valid_replies_count() {
        let nets = net::parse_nets("26.1.1.1/8/Public\n192.168.1.5/24/Private\n");
        let from: SocketAddr = "26.9.9.9:8788".parse().unwrap();
        let ok = parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345","id":"abc123"}"#, from, &nets).unwrap();
        assert_eq!(ok, FoundParty { host: "26.9.9.9".into(), port: 8787, room: "ABCD2345".into(), id: "abc123".into() });
        // A home-network host is found too.
        let lan = parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345","id":"x"}"#, "192.168.1.9:8788".parse().unwrap(), &nets);
        assert_eq!(lan.map(|f| f.host), Some("192.168.1.9".into()));
        // Older hosts send no id: their address stands in.
        let old = parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345"}"#, from, &nets).unwrap();
        assert_eq!(old.id, "26.9.9.9");
        // Another subnet, the internet, a bad room code: ignored.
        assert!(parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345"}"#, "192.168.7.9:8788".parse().unwrap(), &nets).is_none());
        assert!(parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"ABCD2345"}"#, "8.8.8.8:8788".parse().unwrap(), &nets).is_none());
        assert!(parse_reply(br#"{"moa":"party","v":1,"port":8787,"room":"bad code!"}"#, from, &nets).is_none());
        assert!(parse_reply(br#"{"moa":"link","v":1,"port":8787,"room":"ABCD2345"}"#, from, &nets).is_none());
    }

    #[test]
    fn party_skips_public_home_networks_but_not_radmin() {
        let nets = net::parse_nets("26.1.1.1/8/Public\n192.168.1.5/24/Public\n10.0.0.5/24/Private\n");
        let ips: Vec<String> = party_nets(&nets).iter().map(|n| n.ip.to_string()).collect();
        assert_eq!(ips, vec!["26.1.1.1", "10.0.0.5"]);
        assert_eq!(no_network_code(&[]), "no_network");
        assert_eq!(no_network_code(&net::parse_nets("192.168.1.5/24/Public")), "lan_public");
    }

    // ---- real sockets: a host and players on this PC -----------------------------

    type Ws = tokio_tungstenite::WebSocketStream<TcpStream>;

    async fn player(port: u16) -> Ws {
        let stream = TcpStream::connect(("127.0.0.1", port)).await.expect("tcp connect");
        let (ws, _) = tokio_tungstenite::client_async(format!("ws://127.0.0.1:{port}/"), stream).await.expect("ws handshake");
        ws
    }

    fn frame(kind: &str, payload: Value) -> Message {
        Message::text(json!({ "v": 2, "kind": kind, "from": "forged", "ts": 1, "payload": payload }).to_string())
    }

    async fn next_json(ws: &mut Ws) -> Value {
        loop {
            let m = tokio::time::timeout(Duration::from_secs(3), ws.next()).await.expect("a frame in time").expect("open").expect("ok");
            if let Message::Text(t) = m {
                return serde_json::from_str(t.as_str()).unwrap();
            }
        }
    }

    async fn quiet(ws: &mut Ws, ms: u64) -> bool {
        tokio::time::timeout(Duration::from_millis(ms), ws.next()).await.is_err()
    }

    async fn host() -> HostHandle {
        spawn_host(vec![Ipv4Addr::LOCALHOST], 0, 0, Vec::new()).await.expect("host")
    }

    #[test]
    fn two_players_share_positions_markers_and_leaves() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let mut a = player(h.tcp_port).await;
            a.send(frame("join", json!({ "code": null, "name": "Alfa", "colorPref": "red" }))).await.unwrap();
            let joined = next_json(&mut a).await;
            assert_eq!(joined["kind"], "joined");
            let code = joined["payload"]["code"].as_str().unwrap().to_owned();
            let a_id = joined["payload"]["selfId"].as_str().unwrap().to_owned();

            let mut b = player(h.tcp_port).await;
            b.send(frame("join", json!({ "code": code, "name": "Bravo", "colorPref": "red" }))).await.unwrap();
            let jb = next_json(&mut b).await;
            assert_eq!(jb["kind"], "joined");
            assert_eq!(jb["payload"]["members"].as_array().unwrap().len(), 2);
            assert_eq!(jb["payload"]["colorId"], "cyan", "red was taken");
            let b_id = jb["payload"]["selfId"].as_str().unwrap().to_owned();
            assert_eq!(next_json(&mut a).await["kind"], "peer-join");

            // A position reaches the other player, stamped with the real sender.
            let pos = json!({ "mapId": "56f40101d2720b2a4d8b45d6", "x": 1.5, "y": 0.0, "z": -20.25, "rotation": 90.0, "symbol": "skull" });
            a.send(frame("position", pos.clone())).await.unwrap();
            let got = next_json(&mut b).await;
            assert_eq!(got["kind"], "position");
            assert_eq!(got["from"], a_id.as_str(), "the relay re-stamps the sender");
            assert_eq!(got["payload"], pos, "payload passes through untouched");
            assert!(quiet(&mut a, 200).await, "the sender does not get its own frame back");

            // The other way, and other kinds.
            b.send(frame("marker-add", json!({ "id": "m1", "x": 1, "z": 2 }))).await.unwrap();
            let m = next_json(&mut a).await;
            assert_eq!((m["kind"].as_str(), m["from"].as_str()), (Some("marker-add"), Some(b_id.as_str())));
            b.send(frame("quests", json!({ "activeQuestIds": ["q1"] }))).await.unwrap();
            assert_eq!(next_json(&mut a).await["kind"], "quests");

            // Server-only kinds from a client are dropped.
            b.send(frame("joined", json!({}))).await.unwrap();
            b.send(frame("peer-leave", json!({ "id": a_id }))).await.unwrap();
            assert!(quiet(&mut a, 300).await);

            // B leaves: A hears it.
            b.close(None).await.unwrap();
            let left = next_json(&mut a).await;
            assert_eq!((left["kind"].as_str(), left["payload"]["id"].as_str()), (Some("peer-leave"), Some(b_id.as_str())));

            // The host stops: A's socket closes.
            h.stop();
            let end = tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    match a.next().await {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return true,
                        _ => {}
                    }
                }
            })
            .await;
            assert_eq!(end, Ok(true));
        });
    }

    #[test]
    fn discovery_answers_only_once_a_room_exists() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let target = SocketAddr::from((Ipv4Addr::LOCALHOST, h.udp_port));
            let ask_here = || ask(vec![(Ipv4Addr::LOCALHOST, vec![target])], Duration::from_millis(600), Vec::new(), true);
            assert!(ask_here().await.is_none(), "no room yet");

            let mut a = player(h.tcp_port).await;
            a.send(frame("join", json!({ "code": null, "name": "Alfa" }))).await.unwrap();
            let code = next_json(&mut a).await["payload"]["code"].as_str().unwrap().to_owned();
            let found = ask_here().await.expect("found");
            assert_eq!(found.room, code);
            assert_eq!(found.port, h.tcp_port);
            assert_eq!(found.id, h.id);
            assert_eq!(found.host, "127.0.0.1");

            // A player joining with what discovery said lands in the same room.
            let mut b = player(found.port).await;
            b.send(frame("join", json!({ "code": found.room, "name": "Bravo" }))).await.unwrap();
            assert_eq!(next_json(&mut b).await["payload"]["code"], code.as_str());

            // Anything but the exact question gets no answer.
            let sock = UdpSocket::bind("127.0.0.1:0").await.unwrap();
            sock.send_to(b"MOA-PARTY?2", target).await.unwrap();
            let mut buf = [0u8; 64];
            assert!(tokio::time::timeout(Duration::from_millis(400), sock.recv_from(&mut buf)).await.is_err());

            // Without the self filter, this PC's own reply is skipped.
            assert!(ask(vec![(Ipv4Addr::LOCALHOST, vec![target])], Duration::from_millis(400), Vec::new(), false).await.is_none());
            h.stop();
        });
    }

    #[test]
    fn old_versions_are_told_to_update_and_floods_are_slowed() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let mut a = player(h.tcp_port).await;
            a.send(Message::text(r#"{"v":1,"kind":"join","from":"","ts":1,"payload":{"name":"Old"}}"#)).await.unwrap();
            let e = next_json(&mut a).await;
            assert_eq!(e["payload"]["code"], "protocol_mismatch");

            let mut b = player(h.tcp_port).await;
            b.send(frame("join", json!({ "code": null, "name": "Fast" }))).await.unwrap();
            next_json(&mut b).await;
            for _ in 0..60 {
                b.send(frame("heartbeat", json!({}))).await.unwrap();
            }
            assert_eq!(next_json(&mut b).await["payload"]["code"], "rate_limited");

            // A name made only of control characters is refused.
            let mut c = player(h.tcp_port).await;
            c.send(frame("join", json!({ "code": null, "name": "\u{1}\u{2}" }))).await.unwrap();
            assert_eq!(next_json(&mut c).await["payload"]["code"], "name_required");
            h.stop();
        });
    }

    #[test]
    fn an_oversized_frame_closes_the_socket() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let mut a = player(h.tcp_port).await;
            let _ = a.send(Message::text("x".repeat(MAX_FRAME + 1024))).await;
            let closed = tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    match a.next().await {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return true,
                        _ => {}
                    }
                }
            })
            .await;
            assert_eq!(closed, Ok(true));
            h.stop();
        });
    }

    #[test]
    fn a_stopped_host_no_longer_accepts() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let port = h.tcp_port;
            h.stop();
            tokio::time::sleep(Duration::from_millis(150)).await;
            // Windows takes about 2 s to refuse a closed local port, so a
            // timeout counts as refused too; only a successful connect fails.
            let r = tokio::time::timeout(Duration::from_secs(4), TcpStream::connect(("127.0.0.1", port))).await;
            assert!(!matches!(r, Ok(Ok(_))), "connection refused once stopped");
        });
    }

    #[test]
    fn a_busy_port_is_reported() {
        tauri::async_runtime::block_on(async {
            let h = host().await;
            let again = spawn_host(vec![Ipv4Addr::LOCALHOST], h.tcp_port, 0, Vec::new()).await;
            assert_eq!(again.err().as_deref(), Some("port_busy"));
            h.stop();
        });
    }

    /// Hosts on this PC's real Radmin / home addresses, finds the party by
    /// broadcast and joins it through each address. Then keeps running for
    /// MOA_PARTY_SECS so other PCs can be pointed at it.
    /// cargo test party_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn party_live() {
        tauri::async_runtime::block_on(async {
            let info = start_hosting(false).await.expect("host");
            println!("hosting on {:?}, port {}", info.ips, info.port);
            assert!(find(vec![], Some(800), true, DISCOVERY_PORT).await.unwrap().is_none(), "no room yet");
            // Join through each address, the way another PC would.
            let mut sockets = Vec::new();
            for ip in &info.ips {
                let stream = TcpStream::connect((ip.as_str(), info.port)).await.expect("tcp via network address");
                let (mut ws, _) = tokio_tungstenite::client_async(format!("ws://{ip}:{}/", info.port), stream).await.expect("ws");
                ws.send(frame("join", json!({ "code": null, "name": format!("via {ip}") }))).await.unwrap();
                let j = next_json(&mut ws).await;
                assert_eq!(j["kind"], "joined");
                println!("joined via {ip}");
                sockets.push(ws);
            }
            let found = find(vec![], Some(1500), true, DISCOVERY_PORT).await.unwrap().expect("found by broadcast");
            println!("FOUND via {} port={} id_matches={}", found.host, found.port, found.id == info.id);
            let secs: u64 = std::env::var("MOA_PARTY_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
            tokio::time::sleep(Duration::from_secs(secs)).await;
            party_host_stop();
            println!("STOPPED");
        });
    }
}
