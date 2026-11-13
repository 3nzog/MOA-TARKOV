// "Test connection": checks, one by one, what a connection between two MoA
// PCs needs, and says which step fails. Each step is an id plus a status; the
// UI words it (src/net/ConnectionTest.tsx). Nothing here changes settings: the
// firewall fix is a separate button that shows Windows' own prompt.
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::net::{TcpStream, UdpSocket};
use tokio_tungstenite::tungstenite::protocol::Message;

use crate::net::{self, NetKind};
use crate::{link, party};

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Fail,
    Info,
}

#[derive(Serialize, Debug)]
pub struct Step {
    id: &'static str,
    status: Status,
    args: BTreeMap<&'static str, String>,
}

fn step(id: &'static str, status: Status, args: &[(&'static str, String)]) -> Step {
    Step { id, status, args: args.iter().cloned().collect() }
}

async fn tcp_open(ip: Ipv4Addr, port: u16) -> Result<Duration, &'static str> {
    let t = Instant::now();
    match tokio::time::timeout(Duration::from_secs(2), TcpStream::connect((ip, port))).await {
        Ok(Ok(_)) => Ok(t.elapsed()),
        Ok(Err(_)) => Err("refused"),
        Err(_) => Err("timeout"),
    }
}

/// UDP question straight to one address; true if it answered in time.
async fn udp_answers(ip: Ipv4Addr, port: u16, query: &[u8]) -> bool {
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0").await else { return false };
    if sock.send_to(query, SocketAddr::from((ip, port))).await.is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    matches!(tokio::time::timeout(Duration::from_millis(1500), sock.recv_from(&mut buf)).await, Ok(Ok(_)))
}

/// A ping through the link port and back, in milliseconds.
async fn link_roundtrip(ip: Ipv4Addr) -> Option<u128> {
    let stream = tokio::time::timeout(Duration::from_secs(2), TcpStream::connect((ip, link::LINK_PORT))).await.ok()?.ok()?;
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(3),
        tokio_tungstenite::client_async(format!("ws://{ip}:{}/", link::LINK_PORT), stream),
    )
    .await
    .ok()?
    .ok()?;
    let t = Instant::now();
    ws.send(Message::text(json!({ "t": "ping", "n": 1 }).to_string())).await.ok()?;
    let reply = tokio::time::timeout(Duration::from_secs(3), ws.next()).await.ok()??.ok()?;
    let v: Value = serde_json::from_str(reply.to_text().ok()?).ok()?;
    let _ = ws.close(None).await;
    (v["t"] == "pong").then(|| t.elapsed().as_millis())
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[tauri::command]
pub async fn net_diagnose(target: Option<String>) -> Vec<Step> {
    let mut steps = Vec::new();
    net::log(format!("teste: começou{}", target.as_deref().map(|t| format!(" (alvo {t})")).unwrap_or_default()));

    // 1. Which networks this PC is on.
    let nets = tauri::async_runtime::spawn_blocking(net::local_nets).await.unwrap_or_default();
    let radmin: Vec<String> = nets.iter().filter(|n| n.kind == NetKind::Radmin).map(|n| n.ip.to_string()).collect();
    let lan: Vec<String> = nets.iter().filter(|n| n.kind == NetKind::Lan).map(|n| n.ip.to_string()).collect();
    steps.push(if radmin.is_empty() {
        step("radmin", Status::Info, &[])
    } else {
        step("radmin", Status::Ok, &[("ips", radmin.join(", "))])
    });
    steps.push(if lan.is_empty() { step("lan", Status::Info, &[]) } else { step("lan", Status::Ok, &[("ips", lan.join(", "))]) });
    if nets.is_empty() {
        steps.push(step("noNetwork", Status::Fail, &[]));
    }
    for n in nets.iter().filter(|n| n.kind == NetKind::Lan && n.public) {
        steps.push(step("lanPublic", Status::Warn, &[("ip", n.ip.to_string())]));
    }

    // 2. Firewall.
    let fw = tauri::async_runtime::spawn_blocking(party::firewall_rules_present).await.unwrap_or(false);
    steps.push(step("firewall", if fw { Status::Ok } else { Status::Warn }, &[]));

    // 3. Ports (in use by MoA itself is fine).
    for (id, port, ours) in [("partyPort", party::RELAY_PORT, party::is_hosting()), ("linkPort", link::LINK_PORT, link::is_hosting())] {
        let s = if ours {
            step(id, Status::Ok, &[("port", port.to_string()), ("state", "moa".into())])
        } else if port_free(port) {
            step(id, Status::Ok, &[("port", port.to_string()), ("state", "free".into())])
        } else {
            step(id, Status::Fail, &[("port", port.to_string()), ("state", "busy".into())])
        };
        steps.push(s);
    }

    // 4. What the networks answer.
    let found = party::party_find(Vec::new(), Some(1200)).await.ok().flatten();
    steps.push(match found {
        Some(f) => step("partyFound", Status::Ok, &[("host", f.host)]),
        None => step("partyFound", Status::Info, &[]),
    });
    let pcs = link::link_find(Some(1200)).await;
    steps.push(if pcs.is_empty() {
        step("linkFound", Status::Info, &[])
    } else {
        step("linkFound", Status::Ok, &[("pcs", pcs.iter().map(|p| format!("{} ({})", p.name, p.host)).collect::<Vec<_>>().join(", "))])
    });

    // 5. One PC in particular.
    if let Some(t) = target.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty()) {
        match t.parse::<Ipv4Addr>() {
            Ok(ip) if net::kind_of(ip).is_some() => {
                let same_net = nets.iter().any(|n| n.contains(ip));
                steps.push(step("target", if same_net { Status::Ok } else { Status::Warn }, &[("ip", ip.to_string())]));
                let party_tcp = tcp_open(ip, party::RELAY_PORT).await;
                let party_udp = udp_answers(ip, party::DISCOVERY_PORT, b"MOA-PARTY?1").await;
                steps.push(match (party_tcp, party_udp) {
                    (Ok(d), _) => step("targetParty", Status::Ok, &[("ms", d.as_millis().to_string())]),
                    (Err(_), true) => step("targetParty", Status::Warn, &[]),
                    (Err(why), false) => step("targetParty", Status::Info, &[("why", why.into())]),
                });
                let link_tcp = tcp_open(ip, link::LINK_PORT).await;
                steps.push(match link_tcp {
                    Ok(_) => match link_roundtrip(ip).await {
                        Some(ms) => step("targetLink", Status::Ok, &[("ms", ms.to_string())]),
                        None => step("targetLink", Status::Warn, &[]),
                    },
                    Err(why) => step("targetLink", Status::Info, &[("why", why.into())]),
                });
            }
            _ => steps.push(step("target", Status::Fail, &[("ip", t)])),
        }
    }

    let summary: Vec<String> = steps.iter().map(|s| format!("{}={:?}", s.id, s.status)).collect();
    net::log(format!("teste: {}", summary.join(" ")));
    steps
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real test on this PC (networks, firewall, ports, what answers).
    /// cargo test diagnose_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn diagnose_live() {
        tauri::async_runtime::block_on(async {
            let target = std::env::var("MOA_DIAG_TARGET").ok();
            for s in net_diagnose(target).await {
                println!("{:<11} {:?} {:?}", s.id, s.status, s.args);
            }
        });
    }

    #[test]
    fn steps_serialize_for_the_ui() {
        let s = step("firewall", Status::Warn, &[("ip", "26.1.2.3".into())]);
        assert_eq!(serde_json::to_value(&s).unwrap(), json!({ "id": "firewall", "status": "warn", "args": { "ip": "26.1.2.3" } }));
    }

    #[test]
    fn a_closed_port_is_refused_quickly() {
        tauri::async_runtime::block_on(async {
            // Bind then drop: the port is closed right after.
            let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
            assert!(tcp_open(Ipv4Addr::LOCALHOST, port).await.is_err());
        });
    }

    #[test]
    fn roundtrip_through_a_running_link_server() {
        tauri::async_runtime::block_on(async {
            // The real port must be free for this test; skip quietly otherwise.
            if !port_free(link::LINK_PORT) {
                return;
            }
            let cfg = link::ServerCfg {
                name: "T".into(),
                notify: std::sync::Arc::new(|_: &str, _: Value| {}),
                scan: std::sync::Arc::new(|| None),
                store: None,
                nets: std::sync::Arc::new(Vec::new),
            };
            let s = link::Server::start(cfg, Ipv4Addr::LOCALHOST, link::LINK_PORT, 0).await.unwrap();
            let ms = link_roundtrip(Ipv4Addr::LOCALHOST).await;
            assert!(ms.is_some(), "ping answered");
            s.stop();
        });
    }
}
