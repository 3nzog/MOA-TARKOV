#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod eft_config;
mod eft_logs;
mod extract_panel;
mod game_lang;
mod log_watcher;
mod diag;
mod link;
mod net;
mod party;
mod screenshots;
mod tracker;
mod weblinks;

use std::sync::{Arc, Mutex};
use tauri::{Listener, Manager};

fn main() {
    let screenshots_dir = Arc::new(Mutex::new(None));
    let screenshots_state = screenshots::ScreenshotsDir(screenshots_dir.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .manage(screenshots_state)
        // The minimap overlay is click-through and has no taskbar entry. If it
        // outlived the main window the app would keep running with no visible
        // way to close it — so closing the main window ends the app.
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .setup(move |app| {
            let handle = app.handle().clone();

            // Connection log (conexao.log), for "it doesn't connect" reports.
            if let Ok(dir) = app.path().app_log_dir() {
                net::set_log_dir(dir);
            }
            // Whatever the log and screenshot readers tell this window also
            // goes to a linked second PC (link.rs), when there is one.
            for event in link::FORWARDED {
                app.listen_any(event, move |e| link::on_local_event(event, e.payload()));
            }

            // EFT config: load persisted user choice, fall back to defaults.
            let cfg = eft_config::load(&handle);
            let cfg_state = eft_config::EftConfigState(std::sync::Arc::new(std::sync::Mutex::new(cfg)));
            let cfg_arc = cfg_state.0.clone();
            app.manage(cfg_state);

            // Resolve logs dir using current config; start watcher.
            let logs_dir_result = {
                let guard = cfg_arc.lock().map_err(|e| e.to_string())?;
                eft_config::resolve_logs_dir(&guard)
            };
            log_watcher::start_with_resolver(handle.clone(), logs_dir_result);

            // Screenshots watcher: target dir is independent of install root.
            screenshots::start(handle, screenshots_dir.clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            weblinks::open_external,
            eft_config::get_eft_config,
            eft_config::get_resolved_logs_dir,
            eft_config::set_eft_install_root,
            eft_logs::get_eft_logs_dir,
            game_lang::get_game_language,
            log_watcher::replay_past_logs_cmd,
            log_watcher::scan_raid_sides,
            screenshots::set_screenshots_dir,
            tracker::tracker_has_key,
            tracker::tracker_token_info,
            tracker::tracker_get_progress,
            tracker::tracker_update_tasks,
            tracker::tracker_set_level,
            tracker::tracker_update_objective,
            tracker::tracker_open_key_window,
            tracker::tracker_set_key,
            tracker::tracker_remove_key,
            party::party_host_start,
            party::party_host_stop,
            party::party_find,
            party::party_radmin_ips,
            party::party_firewall_request,
            net::net_local_ips,
            net::net_log_write,
            net::net_log_open,
            diag::net_diagnose,
            link::link_host_start,
            link::link_host_stop,
            link::link_host_status,
            link::link_answer,
            link::link_publish,
            link::link_set_auto_accept,
            link::link_forget,
            link::link_find,
            link::link_connect,
            link::link_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
