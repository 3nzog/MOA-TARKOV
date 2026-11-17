// Opens a web link in the player's default browser. The app window itself
// never navigates away or opens new windows, so links such as "Open on the
// wiki" go through here.
//
// Only plain http(s) URLs are accepted; the URL is handed to Windows as one
// argument (no shell), so nothing in it can run as a command.

fn is_web_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://"))
        && url.len() <= 2048
        && !url.chars().any(|c| c.is_control() || c == '"' || c == ' ')
}

#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !is_web_url(&url) {
        return Err("not a web link".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::is_web_url;

    #[test]
    fn accepts_only_plain_web_links() {
        assert!(is_web_url("https://escapefromtarkov.fandom.com/wiki/Debut"));
        assert!(is_web_url("http://tarkov.dev"));
        assert!(!is_web_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("https://x.com/\" & calc"));
        assert!(!is_web_url("https://x.com/a b"));
        assert!(!is_web_url("calc.exe"));
    }
}
