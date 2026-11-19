// Starting with Windows, waiting in the tray, and showing up when the game
// starts.
//
// - "Start with Windows": a value in the user's own Run key (HKCU, no admin),
//   written and removed with Windows' reg.exe. It starts this .exe with
//   `--bandeja`: no window, only the tray icon.
// - The tray icon brings the window back (click, or "Abrir"); "Sair" closes
//   the app.
// - The game started: the log reader sees a new session folder appear in the
//   game's logs (EFT makes one each time it starts) and says "game-launched".
//   That event also goes to a linked second PC (link.rs), so both screens open
//   together. Nothing here looks at the game's process or memory.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::process::Command;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// The argument the Run key starts the app with.
pub const TRAY_ARG: &str = "--bandeja";
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "Tarkov MoA";
/// The event the log reader sends when the game starts.
pub const GAME_LAUNCHED: &str = "game-launched";

static TRAY_UP: AtomicBool = AtomicBool::new(false);

/// The tray icon is there: closing the window hides it in the tray.
pub fn tray_up() -> bool {
    TRAY_UP.load(Ordering::SeqCst)
}

/// The .exe a Run value starts ("\"C:\\…\\tarkov-companion.exe\" --bandeja").
pub fn run_target(value: &str) -> Option<PathBuf> {
    let v = value.trim();
    let path = match v.strip_prefix('"') {
        Some(rest) => &rest[..rest.find('"')?],
        None => v.split_whitespace().next()?,
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// What to do with the Run value on start: the first run turns "start with
/// Windows" on (the app is meant to wait for the game); a value whose .exe is
/// gone (a moved or rebuilt folder) is pointed at this one; one turned off in
/// Settings stays off.
#[derive(Debug, PartialEq, Eq)]
pub enum RunFix {
    Leave,
    Write,
}

pub fn run_fix(current: Option<&str>, first_run: bool, target_exists: impl Fn(&Path) -> bool) -> RunFix {
    match current {
        None if first_run => RunFix::Write,
        None => RunFix::Leave,
        Some(v) => match run_target(v) {
            Some(p) if target_exists(&p) => RunFix::Leave,
            _ => RunFix::Write,
        },
    }
}

/// Applies `run_fix` once per start (marker file in the app's config folder).
pub fn apply_default(config_dir: &Path) {
    let Ok(exe) = std::env::current_exe() else { return };
    let marker = config_dir.join("startup-default-v1");
    let first_run = !marker.exists();
    let current = read_value(RUN_KEY, RUN_VALUE);
    if run_fix(current.as_deref(), first_run, |p| p.exists()) == RunFix::Write {
        if let Err(e) = write_value(RUN_KEY, RUN_VALUE, &run_command(&exe)) {
            eprintln!("[startup] start with Windows: {e}");
            return;
        }
    }
    if first_run {
        let _ = std::fs::create_dir_all(config_dir);
        let _ = std::fs::write(&marker, b"1");
    }
}

/// Started by Windows at log-in: stay in the tray.
pub fn started_in_tray() -> bool {
    std::env::args().any(|a| a == TRAY_ARG)
}

fn reg() -> Command {
    let mut c = Command::new("reg");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// What the Run value holds for this .exe.
pub fn run_command(exe: &Path) -> String {
    format!("\"{}\" {TRAY_ARG}", exe.display())
}

/// The value in `key`, or None.
fn read_value(key: &str, value: &str) -> Option<String> {
    let out = reg().args(["query", key, "/v", value]).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find_map(|l| {
        let l = l.trim();
        let rest = l.strip_prefix(value)?.trim_start();
        let rest = rest.strip_prefix("REG_SZ")?;
        Some(rest.trim().to_string())
    })
}

fn write_value(key: &str, value: &str, data: &str) -> Result<(), String> {
    let out = reg().args(["add", key, "/v", value, "/t", "REG_SZ", "/d", data, "/f"]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn delete_value(key: &str, value: &str) -> Result<(), String> {
    if read_value(key, value).is_none() {
        return Ok(());
    }
    let out = reg().args(["delete", key, "/v", value, "/f"]).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Starts with Windows: the Run value points at THIS .exe (a stale one, from a
/// moved folder, counts as off, and turning it on again fixes it).
#[tauri::command]
pub fn startup_get() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    read_value(RUN_KEY, RUN_VALUE).is_some_and(|v| v.eq_ignore_ascii_case(&run_command(&exe)))
}

#[tauri::command]
pub fn startup_set(on: bool) -> Result<bool, String> {
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        write_value(RUN_KEY, RUN_VALUE, &run_command(&exe))?;
    } else {
        delete_value(RUN_KEY, RUN_VALUE)?;
    }
    Ok(startup_get())
}

/// Brings the main window to the front (from the tray, or when the game starts).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn main_show(app: AppHandle) {
    show_main(&app);
}

/// The tray icon: click or "Abrir" shows the window, "Sair" closes the app.
pub fn add_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir o Tarkov MoA", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("moa")
        .tooltip("Tarkov MoA")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    TRAY_UP.store(true, Ordering::SeqCst);
    Ok(())
}

/// The game's session folder a log path is in (the first folder under the logs root).
pub fn session_dir(root: &Path, path: &Path) -> Option<PathBuf> {
    let rel = path.strip_prefix(root).ok()?;
    let first = rel.components().next()?;
    let dir = root.join(first.as_os_str());
    // A file right in the root is not a session.
    (rel.components().count() > 1 || dir.is_dir()).then_some(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_with_windows_is_on_from_the_first_run_and_stays_off_when_turned_off() {
        let exists = |_: &Path| true;
        assert_eq!(run_fix(None, true, exists), RunFix::Write);
        assert_eq!(run_fix(None, false, exists), RunFix::Leave);
        assert_eq!(run_fix(Some(r#""C:\MoA\tarkov-companion.exe" --bandeja"#), false, exists), RunFix::Leave);
    }

    #[test]
    fn a_run_value_whose_exe_is_gone_points_at_this_one() {
        let gone = |_: &Path| false;
        assert_eq!(run_fix(Some(r#""C:\Old\tarkov-companion.exe" --bandeja"#), false, gone), RunFix::Write);
        assert_eq!(run_target(r#""C:\Program Files\MoA\a b.exe" --bandeja"#), Some(PathBuf::from(r"C:\Program Files\MoA\a b.exe")));
        assert_eq!(run_target(r"C:\MoA\x.exe --bandeja"), Some(PathBuf::from(r"C:\MoA\x.exe")));
    }

    #[test]
    fn a_log_belongs_to_its_session_folder() {
        let root = Path::new(r"C:\Games\EFT\Logs");
        let p = Path::new(r"C:\Games\EFT\Logs\log_2026.11.18_12-00-00_0.16.9\2026.11.18_12-00-00_0.16.9 application_000.log");
        assert_eq!(session_dir(root, p), Some(root.join("log_2026.11.18_12-00-00_0.16.9")));
        assert_eq!(session_dir(root, Path::new(r"C:\Other\x.log")), None);
        assert_eq!(session_dir(root, Path::new(r"C:\Games\EFT\Logs\loose.log")), None);
    }

    #[test]
    fn the_run_value_starts_this_exe_in_the_tray() {
        assert_eq!(run_command(Path::new(r"C:\MoA\tarkov-companion.exe")), r#""C:\MoA\tarkov-companion.exe" --bandeja"#);
    }

    /// Writes, reads and removes a value in a test key of the user's own
    /// registry (never the Run key).
    #[cfg(windows)]
    #[test]
    fn a_value_goes_in_and_out_of_the_registry() {
        let key = r"HKCU\Software\TarkovMoA-test";
        let data = run_command(Path::new(r"C:\Pasta com espaço\tarkov-companion.exe"));
        write_value(key, "teste", &data).unwrap();
        assert_eq!(read_value(key, "teste").as_deref(), Some(data.as_str()));
        delete_value(key, "teste").unwrap();
        assert_eq!(read_value(key, "teste"), None);
        let _ = reg().args(["delete", key, "/f"]).output();
    }
}
