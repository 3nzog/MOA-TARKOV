// Which networks other MoA PCs may reach this one on, and a plain-text log of
// what happened on them (for "it doesn't connect" reports).
//
// Two kinds of network count:
//   * Radmin VPN (26.0.0.0/8): friends far away.
//   * The home network (10/8, 172.16/12, 192.168/16): a second PC in the same
//     house. Only addresses in the same subnet as one of this PC's own are
//     accepted, never the internet.
// Windows marks each network Private or Public. The party (which has no
// password) stays off a Public network, such as a café's Wi-Fi; linking a
// second PC asks for confirmation on screen, so it works on either.
use serde::Serialize;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NetKind {
    Radmin,
    Lan,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LocalNet {
    pub ip: Ipv4Addr,
    pub prefix: u8,
    pub kind: NetKind,
    /// Windows calls this network Public (unknown counts as not public).
    pub public: bool,
}

impl LocalNet {
    fn mask(&self) -> u32 {
        if self.prefix == 0 {
            0
        } else {
            u32::MAX << (32 - u32::from(self.prefix.min(32)))
        }
    }
    pub fn contains(&self, ip: Ipv4Addr) -> bool {
        (u32::from(ip) & self.mask()) == (u32::from(self.ip) & self.mask())
    }
    pub fn broadcast(&self) -> Ipv4Addr {
        Ipv4Addr::from(u32::from(self.ip) | !self.mask())
    }
}

/// Radmin, a private (home) range, or neither.
pub fn kind_of(ip: Ipv4Addr) -> Option<NetKind> {
    let o = ip.octets();
    match o {
        [26, ..] => Some(NetKind::Radmin),
        [10, ..] => Some(NetKind::Lan),
        [172, b, ..] if (16..=31).contains(&b) => Some(NetKind::Lan),
        [192, 168, ..] => Some(NetKind::Lan),
        _ => None,
    }
}

fn make_net(ip: Ipv4Addr, prefix: u8, public: bool) -> Option<LocalNet> {
    let kind = kind_of(ip)?;
    // Radmin is one flat /8. A home network narrower than /30 or wider than
    // /8 is a misreading; fall back to the usual /24.
    let prefix = match kind {
        NetKind::Radmin => 8,
        NetKind::Lan if (8..=30).contains(&prefix) => prefix,
        NetKind::Lan => 24,
    };
    Some(LocalNet { ip, prefix, kind, public })
}

/// Lines of "ip/prefix/category" (category: Public, Private, DomainAuthenticated or empty).
pub fn parse_nets(text: &str) -> Vec<LocalNet> {
    let mut out: Vec<LocalNet> = Vec::new();
    for line in text.lines() {
        let mut parts = line.trim().split('/');
        let Some(ip) = parts.next().and_then(|s| s.trim().parse::<Ipv4Addr>().ok()) else { continue };
        let prefix = parts.next().and_then(|s| s.trim().parse::<u8>().ok()).unwrap_or(24);
        let public = parts.next().map(|s| s.trim().eq_ignore_ascii_case("public")).unwrap_or(false);
        if let Some(n) = make_net(ip, prefix, public) {
            if !out.iter().any(|o| o.ip == n.ip) {
                out.push(n);
            }
        }
    }
    out
}

/// Tailscale's address range (100.64.0.0/10): a private network of the
/// player's own devices, across the internet, encrypted.
pub fn is_tailscale(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..=127).contains(&o[1])
}

/// This PC's Tailscale address, when Tailscale is on: the address Windows
/// would use to reach Tailscale's own resolver (100.100.100.100). With
/// Tailscale off that route goes out the normal way, and nothing is returned.
pub fn tailscale_ip() -> Option<Ipv4Addr> {
    route_ip("100.100.100.100:53").filter(|ip| is_tailscale(*ip))
}

/// Keeps a socket out of the programs this app starts. tokio's sockets (mio)
/// are made inheritable on Windows, so every program the app started — the
/// update .bat above all — got a copy of the phone, link and party ports, and
/// the new app the .bat then opened inherited them too: the old ports stayed
/// taken inside it ("another program is using port 8791") with nobody
/// answering. Called on every socket the app listens or connects on.
#[cfg(windows)]
pub fn no_inherit(s: &impl std::os::windows::io::AsRawSocket) {
    use windows::Win32::Foundation::{SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT};
    // SAFETY: a socket handle the caller owns, for the length of the call.
    let _ = unsafe { SetHandleInformation(HANDLE(s.as_raw_socket() as _), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) };
}
#[cfg(not(windows))]
pub fn no_inherit<T>(_: &T) {}

/// The address this PC reaches the internet through: its real network card
/// (the router's network), not a virtual adapter. None when offline.
pub fn internet_ip() -> Option<Ipv4Addr> {
    route_ip("8.8.8.8:53").filter(|ip| kind_of(*ip) == Some(NetKind::Lan))
}

/// The local address the OS would use to reach `target` (no packet is sent).
fn route_ip(target: &str) -> Option<Ipv4Addr> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect(target).ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(v4) => Some(v4),
        _ => None,
    }
}

fn read_nets() -> Vec<LocalNet> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let script = "$p=@{}; Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { $p[[int]$_.InterfaceIndex]=[string]$_.NetworkCategory }; \
            Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.IPAddress)/$($_.PrefixLength)/$($p[[int]$_.InterfaceIndex])\" }";
        let out = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", script])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let mut nets = out.map(|o| parse_nets(&String::from_utf8_lossy(&o.stdout))).unwrap_or_default();
        // PowerShell can be missing, slow or blocked. The routing table tells
        // the same thing for the two networks that matter.
        for target in ["26.0.0.1:9", "192.168.0.1:9", "10.0.0.1:9", "8.8.8.8:9"] {
            if let Some(ip) = route_ip(target) {
                if !nets.iter().any(|n| n.ip == ip) {
                    if let Some(n) = make_net(ip, 24, false) {
                        if target.starts_with("26.") == (n.kind == NetKind::Radmin) {
                            nets.push(n);
                        }
                    }
                }
            }
        }
        nets
    }
    #[cfg(not(windows))]
    {
        ["26.0.0.1:9", "192.168.0.1:9"].iter().filter_map(|t| route_ip(t)).filter_map(|ip| make_net(ip, 24, false)).collect()
    }
}

/// This PC's Radmin and home-network addresses. Asking Windows starts a
/// PowerShell (hundreds of milliseconds of CPU), and it was asked every few
/// seconds (each link attempt, each party check): a PowerShell every 7 s,
/// forever, on the game PC. Now the answer is kept a minute and refreshed in
/// the background: callers get the last one at once and never wait for it,
/// except the very first time.
type NetsCache = Mutex<Option<(Instant, Vec<LocalNet>)>>;
const NETS_FRESH: Duration = Duration::from_secs(60);

fn nets_cache() -> &'static NetsCache {
    static CACHE: OnceLock<NetsCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub fn local_nets() -> Vec<LocalNet> {
    static REFRESHING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let cached = nets_cache().lock().unwrap().clone();
    match cached {
        Some((at, nets)) => {
            if at.elapsed() >= NETS_FRESH && !REFRESHING.swap(true, std::sync::atomic::Ordering::SeqCst) {
                std::thread::spawn(|| {
                    let fresh = read_nets();
                    *nets_cache().lock().unwrap() = Some((Instant::now(), fresh));
                    REFRESHING.store(false, std::sync::atomic::Ordering::SeqCst);
                });
            }
            nets
        }
        None => {
            let nets = read_nets();
            *nets_cache().lock().unwrap() = Some((Instant::now(), nets.clone()));
            nets
        }
    }
}

/// Whether a peer may talk to this PC: itself, or a PC on one of its own
/// networks. With `allow_public` false, a Public home network does not count.
pub fn peer_allowed(peer: &IpAddr, nets: &[LocalNet], allow_public: bool) -> bool {
    if peer.is_loopback() {
        return true;
    }
    let IpAddr::V4(v4) = peer else {
        // An IPv4 peer reaching a dual-stack socket shows up as ::ffff:a.b.c.d.
        if let IpAddr::V6(v6) = peer {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return peer_allowed(&IpAddr::V4(v4), nets, allow_public);
            }
        }
        return false;
    };
    nets.iter().any(|n| n.contains(*v4) && (allow_public || n.kind == NetKind::Radmin || !n.public))
}

/// The computer's name, shown to the other PC ("DESKTOP-ABC123").
pub fn computer_name() -> String {
    let raw = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_default();
    let name = crate::party::sanitize_name(&raw);
    if name.is_empty() {
        "PC".into()
    } else {
        name
    }
}

// ---- connection log -----------------------------------------------------------

const LOG_MAX: u64 = 512 * 1024;

fn log_path_cell() -> &'static Mutex<Option<PathBuf>> {
    static CELL: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

pub fn set_log_dir(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    *log_path_cell().lock().unwrap() = Some(dir.join("conexao.log"));
}

/// One line in conexao.log (and stderr). Never write secrets here: it is
/// meant to be sent to a friend or pasted in a chat.
pub fn log(msg: impl AsRef<str>) {
    let msg: String = msg.as_ref().chars().filter(|c| !c.is_control()).take(500).collect();
    let stamp = chrono_like_now();
    eprintln!("[conexao] {msg}");
    let Some(path) = log_path_cell().lock().unwrap().clone() else { return };
    if std::fs::metadata(&path).map(|m| m.len() > LOG_MAX).unwrap_or(false) {
        let _ = std::fs::rename(&path, path.with_file_name("conexao.old.log"));
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{stamp} {msg}");
    }
}

/// "2026-11-13 21:04:05" in UTC, without a date crate.
fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[tauri::command]
pub fn net_log_write(line: String) {
    log(format!("[app] {line}"));
}

/// Opens Explorer on the log file, so it can be sent to someone.
#[tauri::command]
pub fn net_log_open() -> Result<(), String> {
    let path = log_path_cell().lock().unwrap().clone().ok_or("no_log")?;
    if !path.exists() {
        log("registro aberto");
    }
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    ip: String,
    kind: NetKind,
    public: bool,
}

/// This PC's addresses on the networks MoA uses, for the UI.
#[tauri::command]
pub async fn net_local_ips() -> Vec<NetInfo> {
    tauri::async_runtime::spawn_blocking(local_nets)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|n| NetInfo { ip: n.ip.to_string(), kind: n.kind, public: n.public })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_tailscale_addresses() {
        assert!(is_tailscale(Ipv4Addr::new(100, 64, 0, 1)));
        assert!(is_tailscale(Ipv4Addr::new(100, 101, 2, 3)));
        assert!(is_tailscale(Ipv4Addr::new(100, 127, 255, 254)));
        assert!(!is_tailscale(Ipv4Addr::new(100, 63, 0, 1)));
        assert!(!is_tailscale(Ipv4Addr::new(100, 128, 0, 1)));
        assert!(!is_tailscale(Ipv4Addr::new(192, 168, 1, 2)));
    }

    #[test]
    fn reads_addresses_prefixes_and_profiles() {
        let nets = parse_nets("127.0.0.1/8/\n26.12.34.56/8/Public\r\n192.168.1.20/24/Private\n169.254.1.1/16/\n8.8.8.8/24/\n10.0.5.9/16/Public\n");
        assert_eq!(nets.len(), 3);
        assert_eq!(nets[0], LocalNet { ip: Ipv4Addr::new(26, 12, 34, 56), prefix: 8, kind: NetKind::Radmin, public: true });
        assert_eq!(nets[1].kind, NetKind::Lan);
        assert!(!nets[1].public);
        assert_eq!(nets[1].broadcast(), Ipv4Addr::new(192, 168, 1, 255));
        assert_eq!(nets[2].broadcast(), Ipv4Addr::new(10, 0, 255, 255));
        // Missing prefix or category still parses.
        assert_eq!(parse_nets("192.168.0.7").len(), 1);
        assert_eq!(parse_nets("192.168.0.7/2/").first().map(|n| n.prefix), Some(24));
    }

    #[cfg(windows)]
    #[test]
    fn the_app_s_sockets_stay_out_of_the_programs_it_starts() {
        use std::os::windows::io::AsRawSocket;
        use windows::Win32::Foundation::{GetHandleInformation, HANDLE, HANDLE_FLAG_INHERIT};
        let inherits = |raw: u64| {
            let mut flags = 0u32;
            unsafe { GetHandleInformation(HANDLE(raw as _), &mut flags) }.unwrap();
            flags & HANDLE_FLAG_INHERIT.0 != 0
        };
        tauri::async_runtime::block_on(async {
            let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            assert!(inherits(l.as_raw_socket()), "tokio's own sockets are inheritable (why this exists)");
            no_inherit(&l);
            assert!(!inherits(l.as_raw_socket()));
            let u = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
            no_inherit(&u);
            assert!(!inherits(u.as_raw_socket()));
        });
    }

    #[test]
    fn private_ranges_only() {
        assert_eq!(kind_of(Ipv4Addr::new(172, 16, 0, 1)), Some(NetKind::Lan));
        assert_eq!(kind_of(Ipv4Addr::new(172, 31, 255, 1)), Some(NetKind::Lan));
        assert_eq!(kind_of(Ipv4Addr::new(172, 32, 0, 1)), None);
        assert_eq!(kind_of(Ipv4Addr::new(192, 169, 0, 1)), None);
        assert_eq!(kind_of(Ipv4Addr::new(25, 1, 1, 1)), None);
    }

    #[test]
    fn peers_must_share_a_network_with_this_pc() {
        let nets = parse_nets("26.1.1.1/8/Public\n192.168.1.20/24/Private\n10.9.0.2/24/Public\n");
        let ip = |s: &str| s.parse::<IpAddr>().unwrap();
        assert!(peer_allowed(&ip("127.0.0.1"), &nets, false));
        assert!(peer_allowed(&ip("26.200.3.4"), &nets, false), "Radmin counts even when Windows calls it Public");
        assert!(peer_allowed(&ip("192.168.1.77"), &nets, false));
        assert!(!peer_allowed(&ip("192.168.2.77"), &nets, true), "another subnet");
        assert!(!peer_allowed(&ip("8.8.8.8"), &nets, true), "the internet");
        assert!(!peer_allowed(&ip("10.9.0.3"), &nets, false), "a Public home network keeps the party off");
        assert!(peer_allowed(&ip("10.9.0.3"), &nets, true), "a linked PC (confirmed on screen) may use it");
        assert!(peer_allowed(&ip("::ffff:192.168.1.77"), &nets, false));
        assert!(!peer_allowed(&ip("::1:2"), &nets, true));
    }

    #[test]
    fn utc_stamp_shape() {
        let s = chrono_like_now();
        assert_eq!(s.len(), 20, "{s}");
        assert!(s.starts_with("20"));
    }
}
