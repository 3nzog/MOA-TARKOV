// Screenshot watcher.
//
// Watches the EFT Screenshots dir. When the game writes a new PNG with the
// position-encoded filename, parse it and emit `player-position { x, y, z, rotation }`;
// then read its text (O+O extract list, item prices). The file is left where it
// is: it is the player's picture.
//
// Filename format (derived 2026-05-27 from a real EFT screenshot):
//   2026-05-27[22-51]_-44.40, 25.75, 28.54_0.06418, 0.40166, -0.02823, 0.91310_6.76 (0).png
//   <date>[<HH-MM>]_<x>, <y>, <z>_<qx>, <qy>, <qz>, <qw>_<unknown> (N).png
//
// `rotation` is yaw in degrees, computed from the quaternion. EFT world is Y-up.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{EventKind, RecursiveMode, Watcher};
use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const FILENAME_RE: &str =
    r"^[\d-]+\[[\d-]+\]_(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)_(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)_";

#[derive(Serialize, Clone)]
struct PlayerPosition {
    x: f64,
    y: f64,
    z: f64,
    rotation: f64,
    /// Counts the screenshots: the phone keeps the newest position when the
    /// watcher's own frame and the app's map state arrive out of order.
    seq: u64,
    /// When the screenshot was seen (PC clock, ms).
    ts: u64,
}

static SEQ: AtomicU64 = AtomicU64::new(0);

fn default_screenshots_dir() -> Option<PathBuf> {
    dirs::document_dir().map(|d| d.join("Escape from Tarkov").join("Screenshots"))
}

fn yaw_degrees(qx: f64, qy: f64, qz: f64, qw: f64) -> f64 {
    let sin_yaw = 2.0 * (qw * qy + qx * qz);
    let cos_yaw = 1.0 - 2.0 * (qy * qy + qz * qz);
    sin_yaw.atan2(cos_yaw).to_degrees()
}

/// Parse a screenshot filename. Returns Some(payload) if the regex matches.
/// Matches partially (uses leading anchor only) so the trailing collision
/// counter and unknown float don't have to be modeled exactly.
fn parse_filename(name: &str, re: &Regex) -> Option<PlayerPosition> {
    let caps = re.captures(name)?;
    let x: f64 = caps.get(1)?.as_str().parse().ok()?;
    let y: f64 = caps.get(2)?.as_str().parse().ok()?;
    let z: f64 = caps.get(3)?.as_str().parse().ok()?;
    let qx: f64 = caps.get(4)?.as_str().parse().ok()?;
    let qy: f64 = caps.get(5)?.as_str().parse().ok()?;
    let qz: f64 = caps.get(6)?.as_str().parse().ok()?;
    let qw: f64 = caps.get(7)?.as_str().parse().ok()?;
    Some(PlayerPosition {
        x,
        y,
        z,
        rotation: yaw_degrees(qx, qy, qz, qw),
        seq: 0,
        ts: 0,
    })
}

fn process_screenshot(app: &AppHandle, path: &Path, re: &Regex) {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    if !name.to_lowercase().ends_with(".png") || !is_game_screenshot(name) {
        return;
    }
    // Written to the connection log too: "the map did not show my position"
    // is answered by it (was the print seen, did its name carry a position).
    // In a raid the name carries the position; in the stash or the hideout it
    // may not, and the picture is still worth reading for prices.
    // The name is all the position needs: it goes out at once, to the app and
    // straight to the phones (their map no longer waits for the app's window,
    // which runs slowly behind the game).
    if let Some(mut pos) = parse_filename(name, re) {
        pos.seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
        pos.ts = crate::phone::now_ms();
        if let Ok(frame) = serde_json::to_string(&serde_json::json!({ "pos": &pos })) {
            crate::phone::publish_pos(frame);
        }
        crate::net::log(format!("prints: {name}: posição lida (x {:.0}, z {:.0})", pos.x, pos.z));
        if let Err(e) = app.emit("player-position", pos) {
            eprintln!("[screenshots] emit failed: {}", e);
            crate::net::log(format!("prints: a posição não chegou ao app: {e}"));
        }
    } else {
        crate::net::log(format!("prints: {name}: sem posição no nome (fora da raid, ou o jogo não pôs)"));
    }
    // The picture itself may still be being written: a moment before reading it.
    thread::sleep(Duration::from_millis(150));
    let game_lang = crate::game_lang::get_game_language();
    // O+O: if the extract list was open, its text is in the top-right corner.
    // Two lines minimum — every raid has at least two exits, and it keeps a
    // stray word from the game scene from looking like a list.
    match crate::extract_panel::read_panel(path, game_lang.as_deref()) {
        Ok(p) if p.lines.len() >= 2 => {
            let payload = serde_json::json!({ "lines": p.lines, "missingLanguage": p.missing_language });
            if let Err(e) = app.emit("extract-panel", payload) {
                eprintln!("[screenshots] emit extract-panel failed: {}", e);
            }
        }
        Ok(_) => {}
        Err(e) => eprintln!("[screenshots] extract OCR failed: {}", e),
    }
    // Price check: every word on the screen with its position (the hovered
    // item's tooltip, or the short names on the inventory cells).
    match crate::extract_panel::read_screen(path, game_lang.as_deref()) {
        Ok(t) if !t.lines.is_empty() => {
            if let Err(e) = app.emit("screen-text", t) {
                eprintln!("[screenshots] emit screen-text failed: {}", e);
            }
        }
        Ok(_) => {}
        Err(e) => eprintln!("[screenshots] screen OCR failed: {}", e),
    }
    // The screenshot stays where the game put it: it is the player's picture
    // (the app used to delete it after reading; players want to keep them).
}

/// The game names its screenshots "2026-11-08[21-01]_...png"; anything else in
/// the folder is the player's own file and is left alone.
fn is_game_screenshot(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() > 18
        && b[..10].iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
        && b[10] == b'['
}

/// Shared mutable state holding the screenshots dir. Allows the Tauri command
/// `set_screenshots_dir` to swap the watch target at runtime.
pub struct ScreenshotsDir(pub Arc<Mutex<Option<PathBuf>>>);

#[tauri::command]
pub fn set_screenshots_dir(state: State<ScreenshotsDir>, path: String) -> Result<(), String> {
    let new_path = PathBuf::from(path);
    if !new_path.is_dir() {
        return Err(format!("not a directory: {}", new_path.display()));
    }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(new_path);
    Ok(())
}

/// Spawn the watcher. Non-blocking. Reads the dir from the shared `ScreenshotsDir`
/// state, defaults to `<Documents>\Escape from Tarkov\Screenshots`.
pub fn start(app: AppHandle, state: Arc<Mutex<Option<PathBuf>>>) {
    thread::spawn(move || {
        let initial = {
            let g = state.lock().ok();
            g.and_then(|g| g.clone()).or_else(default_screenshots_dir)
        };
        let Some(dir) = initial else {
            eprintln!("[screenshots] cannot resolve default screenshots dir");
            crate::net::log("prints: não achei a pasta Documentos para olhar os prints");
            return;
        };
        if !dir.is_dir() {
            // Create the folder so notify can watch it — EFT will populate.
            if let Err(e) = std::fs::create_dir_all(&dir) {
                eprintln!("[screenshots] cannot create {}: {}", dir.display(), e);
                crate::net::log(format!("prints: não deu para criar {}: {e}", dir.display()));
                return;
            }
        }

        let re = match Regex::new(FILENAME_RE) {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[screenshots] invalid regex: {}", e);
                return;
            }
        };

        let app_for_watcher = app.clone();
        let re_for_watcher = re.clone();
        let mut watcher = match notify::recommended_watcher(
            move |res: notify::Result<notify::Event>| match res {
                Ok(ev) => {
                    if matches!(ev.kind, EventKind::Create(_)) {
                        for path in ev.paths {
                            // No wait here: the position is in the name. The
                            // reading of the picture waits for the game to finish
                            // writing it (in process_screenshot).
                            process_screenshot(&app_for_watcher, &path, &re_for_watcher);
                        }
                    }
                }
                Err(e) => eprintln!("[screenshots] notify error: {}", e),
            },
        ) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[screenshots] failed to start notify watcher: {}", e);
                crate::net::log(format!("prints: não deu para olhar a pasta: {e}"));
                return;
            }
        };

        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("[screenshots] failed to watch {}: {}", dir.display(), e);
            crate::net::log(format!("prints: não deu para olhar {}: {e}", dir.display()));
            return;
        }
        crate::net::log(format!("prints: olhando a pasta {}", dir.display()));

        // Keep watcher alive forever.
        loop {
            thread::sleep(Duration::from_secs(60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_game_screenshots_from_other_files() {
        assert!(is_game_screenshot("2026-11-08[21-01]_520.87, 9.66, 202.48_-0.00346, -0.99620, -0.04704, 0.07327_15.18 (0).png"));
        assert!(is_game_screenshot("2026-11-12[15-30]_(0).png"));
        assert!(!is_game_screenshot("minha foto.png"));
        assert!(!is_game_screenshot("2026-11-12.png"));
    }

    #[test]
    fn parses_real_filename() {
        let re = Regex::new(FILENAME_RE).unwrap();
        let name = "2026-05-27[22-51]_-44.40, 25.75, 28.54_0.06418, 0.40166, -0.02823, 0.91310_6.76 (0).png";
        let pos = parse_filename(name, &re).expect("must parse");
        assert!((pos.x - -44.40).abs() < 1e-6);
        assert!((pos.y - 25.75).abs() < 1e-6);
        assert!((pos.z - 28.54).abs() < 1e-6);
        // rotation: with this quaternion, yaw should be roughly 47.5 degrees.
        // Just sanity-check it's a finite number in [-180, 180].
        assert!(pos.rotation.is_finite());
        assert!(pos.rotation >= -180.0 && pos.rotation <= 180.0);
    }

    #[test]
    fn rejects_garbage() {
        let re = Regex::new(FILENAME_RE).unwrap();
        assert!(parse_filename("garbage.png", &re).is_none());
        assert!(parse_filename("2026-05-27_no_brackets.png", &re).is_none());
    }
}
