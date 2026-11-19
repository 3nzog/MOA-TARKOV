// One Tarkov MoA at a time. Closing the window leaves the app in the tray,
// waiting for the game; opening it again (the shortcut, the .bat) must bring
// that one back, not start a second app fighting it for the party, link and
// phone ports. The first app holds a port on this PC only (loopback: nothing
// from the network, no firewall question); a second one finds it taken, tells
// the first to show its window and ends.
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

/// Next to the app's other ports (party 8787-8788, link 8789-8790, phone 8791).
pub const INSTANCE_PORT: u16 = 8786;
const SHOW: &[u8] = b"show\n";

/// What starting found.
pub enum Start {
    /// This is the only one: keep the lock and listen on it.
    First(TcpListener),
    /// Another one runs and was asked to show itself: end.
    Second,
    /// The port belongs to some other program: run without the lock.
    Unknown,
}

pub fn claim(port: u16) -> Start {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    match TcpListener::bind(addr) {
        Ok(l) => Start::First(l),
        Err(_) => match TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            Ok(mut s) => {
                let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
                let _ = s.write_all(SHOW);
                // A MoA answers "ok"; some other program on the port does not.
                let mut buf = [0u8; 8];
                match s.read(&mut buf) {
                    Ok(n) if buf[..n].starts_with(b"ok") => Start::Second,
                    _ => Start::Unknown,
                }
            }
            Err(_) => Start::Unknown,
        },
    }
}

/// Answers the later copies: each one that asks makes `show` run.
pub fn serve(listener: TcpListener, show: impl Fn() + Send + 'static) {
    std::thread::spawn(move || {
        for conn in listener.incoming() {
            let Ok(mut s) = conn else { continue };
            let _ = s.set_read_timeout(Some(Duration::from_millis(800)));
            let mut buf = [0u8; 8];
            if let Ok(n) = s.read(&mut buf) {
                if buf[..n].starts_with(b"show") {
                    let _ = s.write_all(b"ok\n");
                    show();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn free_port() -> u16 {
        TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap().port()
    }

    #[test]
    fn a_second_copy_shows_the_first_and_ends() {
        let port = free_port();
        let Start::First(l) = claim(port) else { panic!("the first copy holds the lock") };
        let shown = Arc::new(AtomicUsize::new(0));
        let s = shown.clone();
        serve(l, move || {
            s.fetch_add(1, Ordering::SeqCst);
        });
        assert!(matches!(claim(port), Start::Second));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(shown.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn another_program_on_the_port_does_not_stop_the_app() {
        let port = free_port();
        let other = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
        std::thread::spawn(move || {
            for c in other.incoming() {
                drop(c);
            }
        });
        assert!(matches!(claim(port), Start::Unknown));
    }
}
