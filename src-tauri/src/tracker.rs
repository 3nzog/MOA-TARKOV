// TarkovTracker (api.tarkovtracker.org) client.
//
// The API token lives in the Windows Credential Manager. It is written there by
// scripts/tarkovtracker-key.ps1, which runs in its own console window so the
// token is typed into a hidden prompt and never passes through the webview.
// This module reads it back on each call and attaches it to the request. No
// command returns the token, and it is never logged. The /token endpoint echoes
// the token back, so that response is reduced to its non-secret fields here.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;
use tauri_plugin_http::reqwest;

const BASE: &str = "https://api.tarkovtracker.org";
const CRED_TARGET: &str = "TarkovMoA:TarkovTracker";
const CRED_SERVICE: &str = "TarkovMoA";
const CRED_USER: &str = "api-token";
const USER_AGENT: &str = concat!(
    "TarkovMoA/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/mopocop/Tarkov-moa)"
);
const KEY_SCRIPT: &str = include_str!("../../scripts/tarkovtracker-key.ps1");

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackerError {
    /// not_configured | bad_key | unauthorized | forbidden | rate_limited |
    /// unavailable | bad_request | network | storage | unexpected
    code: &'static str,
    message: String,
    /// Seconds to wait, from Retry-After (429 / 503).
    retry_after: Option<u64>,
}

impl TrackerError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), retry_after: None }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    permissions: Vec<String>,
    game_mode: String,
    note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressResult {
    not_modified: bool,
    etag: Option<String>,
    data: Option<Value>,
    game_mode: Option<String>,
}

#[derive(Deserialize)]
pub struct TaskUpdate {
    id: String,
    state: String,
}

/// Shape check only: the server is the real judge.
fn token_shape_ok(t: &str) -> bool {
    (8..=200).contains(&t.len())
        && t.chars().all(|c| c.is_ascii_graphic())
        && ["PVP_", "PVE_", "SZN_"].iter().any(|p| t.starts_with(p))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn entry() -> Result<keyring::Entry, TrackerError> {
    keyring::Entry::new_with_target(CRED_TARGET, CRED_SERVICE, CRED_USER)
        .map_err(|e| TrackerError::new("storage", e.to_string()))
}

fn load_token() -> Result<String, TrackerError> {
    match entry()?.get_password() {
        Ok(t) if token_shape_ok(&t) => Ok(t),
        Ok(_) => Err(TrackerError::new("bad_key", "stored key has an unexpected format")),
        Err(keyring::Error::NoEntry) => Err(TrackerError::new("not_configured", "no key stored")),
        Err(e) => Err(TrackerError::new("storage", e.to_string())),
    }
}

fn client() -> Result<&'static reqwest::Client, TrackerError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| TrackerError::new("unexpected", e.to_string()))?;
    Ok(CLIENT.get_or_init(|| c))
}

fn error_text(body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
        .unwrap_or_default();
    msg.chars().take(300).collect()
}

fn map_status(status: u16, retry_after: Option<u64>, body: &str) -> TrackerError {
    let code = match status {
        401 => "unauthorized",
        403 => "forbidden",
        429 => "rate_limited",
        503 => "unavailable",
        400 | 413 => "bad_request",
        _ => "unexpected",
    };
    let text = error_text(body);
    TrackerError {
        code,
        message: if text.is_empty() { format!("HTTP {status}") } else { text },
        retry_after,
    }
}

struct Reply {
    status: u16,
    etag: Option<String>,
    body: String,
}

async fn call(method: reqwest::Method, path: &str, body: Option<Value>, etag: Option<&str>) -> Result<Reply, TrackerError> {
    let token = load_token()?;
    let mut req = client()?
        .request(method, format!("{BASE}{path}"))
        .bearer_auth(&token)
        .header("Accept", "application/json");
    drop(token);
    if let Some(tag) = etag {
        req = req.header("If-None-Match", tag);
    }
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b.to_string());
    }
    let res = req
        .send()
        .await
        // without_url: keep error text free of anything request-specific.
        .map_err(|e| TrackerError::new("network", e.without_url().to_string()))?;
    let status = res.status().as_u16();
    let header = |name: &str| res.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let etag = header("etag");
    let retry_after = header("retry-after").and_then(|v| v.trim().parse::<u64>().ok());
    let body = res.text().await.map_err(|e| TrackerError::new("network", e.without_url().to_string()))?;
    if status == 200 || status == 304 {
        Ok(Reply { status, etag, body })
    } else {
        Err(map_status(status, retry_after, &body))
    }
}

fn parse_json(body: &str) -> Result<Value, TrackerError> {
    serde_json::from_str(body).map_err(|_| TrackerError::new("unexpected", "response was not JSON"))
}

/// Token info with the secret fields removed. Pure, for tests.
fn reduce_token_info(v: &Value) -> TokenInfo {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_owned();
    TokenInfo {
        permissions: v
            .get("permissions")
            .and_then(|p| p.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str()).filter(|x| ["GP", "TP", "WP"].contains(x)).map(str::to_owned).collect())
            .unwrap_or_default(),
        game_mode: s("gameMode"),
        note: s("note").chars().take(80).collect(),
    }
}

/// Is a key stored? Does not call the network.
#[tauri::command]
pub fn tracker_has_key() -> Result<bool, TrackerError> {
    match load_token() {
        Ok(_) => Ok(true),
        Err(e) if e.code == "not_configured" => Ok(false),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn tracker_token_info() -> Result<TokenInfo, TrackerError> {
    let r = call(reqwest::Method::GET, "/token", None, None).await?;
    Ok(reduce_token_info(&parse_json(&r.body)?))
}

#[tauri::command]
pub async fn tracker_get_progress(etag: Option<String>) -> Result<ProgressResult, TrackerError> {
    let r = call(reqwest::Method::GET, "/progress", None, etag.as_deref()).await?;
    if r.status == 304 {
        return Ok(ProgressResult { not_modified: true, etag: r.etag.or(etag), data: None, game_mode: None });
    }
    let v = parse_json(&r.body)?;
    let mut data = v.get("data").cloned().ok_or_else(|| TrackerError::new("unexpected", "no data"))?;
    // The account id is not needed by anything in the app.
    if let Some(o) = data.as_object_mut() {
        o.remove("userId");
    }
    let game_mode = v.pointer("/meta/gameMode").and_then(|g| g.as_str()).map(str::to_owned);
    Ok(ProgressResult { not_modified: false, etag: r.etag, data: Some(data), game_mode })
}

#[tauri::command]
pub async fn tracker_update_tasks(updates: Vec<TaskUpdate>) -> Result<Vec<String>, TrackerError> {
    if updates.is_empty() || updates.len() > 1000 {
        return Err(TrackerError::new("bad_request", "1 to 1000 updates per batch"));
    }
    let mut list = Vec::with_capacity(updates.len());
    for u in &updates {
        if !valid_id(&u.id) || !["completed", "uncompleted", "failed"].contains(&u.state.as_str()) {
            return Err(TrackerError::new("bad_request", format!("invalid update for {}", u.id.chars().take(64).collect::<String>())));
        }
        list.push(json!({ "id": u.id, "state": u.state }));
    }
    let r = call(reqwest::Method::POST, "/progress/tasks", Some(Value::Array(list)), None).await?;
    let v = parse_json(&r.body)?;
    Ok(v.pointer("/data/updatedTasks")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_owned)).collect())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn tracker_set_level(level: u32) -> Result<(), TrackerError> {
    if !(1..=79).contains(&level) {
        return Err(TrackerError::new("bad_request", "level must be 1-79"));
    }
    call(reqwest::Method::POST, &format!("/progress/level/{level}"), None, None).await.map(|_| ())
}

#[tauri::command]
pub async fn tracker_update_objective(id: String, state: String) -> Result<(), TrackerError> {
    if !valid_id(&id) || !["completed", "uncompleted"].contains(&state.as_str()) {
        return Err(TrackerError::new("bad_request", "invalid objective update"));
    }
    call(reqwest::Method::POST, &format!("/progress/task/objective/{id}"), Some(json!({ "state": state })), None)
        .await
        .map(|_| ())
}

/// Deletes the stored key from Credential Manager.
#[tauri::command]
pub fn tracker_remove_key() -> Result<(), TrackerError> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(TrackerError::new("storage", e.to_string())),
    }
}

/// Opens the key-entry console (or, with `remove`, the removal one). The script
/// is compiled into the app and written to the temp folder, so this also works
/// in an installed build.
#[tauri::command]
pub fn tracker_open_key_window(remove: bool) -> Result<(), TrackerError> {
    let path = std::env::temp_dir().join("tarkov-moa-tarkovtracker-key.ps1");
    // UTF-8 with BOM so Windows PowerShell 5.1 reads it as UTF-8.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(KEY_SCRIPT.as_bytes());
    std::fs::write(&path, bytes).map_err(|e| TrackerError::new("storage", e.to_string()))?;
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(&path);
    if remove {
        cmd.arg("-Remove");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        cmd.creation_flags(CREATE_NEW_CONSOLE);
    }
    cmd.spawn().map(|_| ()).map_err(|e| TrackerError::new("unexpected", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_shape() {
        assert!(token_shape_ok("PVP_deadbeefcafefeed01"));
        assert!(token_shape_ok("SZN_abcdefgh"));
        assert!(!token_shape_ok("tt_deadbeefcafefeed01"));
        assert!(!token_shape_ok("PVP_ dead beef"));
        assert!(!token_shape_ok("PVP_"));
    }

    #[test]
    fn token_info_drops_secret_fields() {
        let v = json!({ "success": true, "permissions": ["GP", "WP", "XX"], "token": "PVP_secret_value_1",
                        "owner": "user-uuid", "note": "MoA", "calls": 3, "gameMode": "pvp" });
        let info = reduce_token_info(&v);
        let out = serde_json::to_string(&info).unwrap();
        assert!(!out.contains("PVP_secret_value_1"));
        assert!(!out.contains("user-uuid"));
        assert_eq!(info.permissions, vec!["GP", "WP"]);
        assert_eq!(info.game_mode, "pvp");
    }

    #[test]
    fn status_mapping() {
        let e = map_status(429, Some(60), r#"{"success":false,"error":"Rate limit exceeded"}"#);
        assert_eq!(e.code, "rate_limited");
        assert_eq!(e.retry_after, Some(60));
        assert_eq!(e.message, "Rate limit exceeded");
        assert_eq!(map_status(401, None, "").code, "unauthorized");
        assert_eq!(map_status(500, None, "<html>").message, "HTTP 500");
    }

    #[test]
    fn ids() {
        assert!(valid_id("5936d90786f7742b1420ba5b"));
        assert!(!valid_id("../token"));
        assert!(!valid_id(""));
    }

    // Live check against the real API with the stored key. Prints only
    // non-secret facts. Run with: cargo test live_ -- --ignored --nocapture
    #[test]
    #[ignore]
    fn live_token_and_progress() {
        tauri::async_runtime::block_on(async {
            let info = tracker_token_info().await.expect("token info");
            println!("mode={} permissions={:?}", info.game_mode, info.permissions);
            let p = tracker_get_progress(None).await.expect("progress");
            let d = p.data.expect("data");
            let count = |k: &str, f: &str| {
                d.get(k).and_then(|a| a.as_array()).map(|a| a.iter().filter(|x| x.get(f) == Some(&Value::Bool(true))).count()).unwrap_or(0)
            };
            println!(
                "etag={} level={} tasksComplete={} tasksFailed={} objectivesComplete={} hideoutModules={} userIdStripped={}",
                p.etag.is_some(), d.get("playerLevel").unwrap_or(&Value::Null), count("tasksProgress", "complete"),
                count("tasksProgress", "failed"), count("taskObjectivesProgress", "complete"),
                count("hideoutModulesProgress", "complete"), d.get("userId").is_none()
            );
            // Catalog ids only (game data, not account data), to check they match tarkov.dev.
            let ids = |k: &str| d.get(k).and_then(|a| a.as_array()).map(|a| a.iter().filter(|x| x.get("complete") == Some(&Value::Bool(true))).filter_map(|x| x.get("id").and_then(|i| i.as_str()).map(str::to_owned)).collect::<Vec<_>>()).unwrap_or_default();
            println!("moduleIds={:?}", ids("hideoutModulesProgress"));
            println!("taskIds={:?}", ids("tasksProgress"));
            println!("objectiveIds={:?}", ids("taskObjectivesProgress"));
            let again = tracker_get_progress(p.etag.clone()).await.expect("conditional");
            println!("second call notModified={}", again.not_modified);
        });
    }
}
