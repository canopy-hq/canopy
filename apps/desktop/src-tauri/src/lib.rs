pub mod daemon;
mod daemon_client;
mod agent_watcher;
mod git;
mod menu;
mod pty;

use std::sync::Mutex;
use daemon_client::DaemonClient;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .setup(|app| {
            menu::setup_menu(app)?;

            // Locate daemon socket and binary
            let socket = app.path().app_data_dir()?.join("pty-daemon.sock");
            let bin = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("superagent-pty-daemon")))
                .unwrap_or_else(|| std::path::PathBuf::from("superagent-pty-daemon"));

            // Start or connect to the daemon (synchronous)
            if let Err(e) = DaemonClient::ensure_daemon_sync(&socket, &bin) {
                eprintln!("Warning: could not start PTY daemon: {e}");
            }

            app.manage(DaemonClient::new(socket));
            app.manage(Mutex::new(pty::PtyProxy::new()));
            app.manage(Mutex::new(agent_watcher::AgentWatcherState::new()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::spawn_terminal,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::get_pty_cwd,
            git::import_repo,
            git::list_branches,
            git::create_branch,
            git::delete_branch,
            git::create_worktree,
            git::remove_worktree,
            agent_watcher::start_agent_watching,
            agent_watcher::stop_agent_watching,
            agent_watcher::toggle_agent_manual,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Cmd+W hides the window instead of closing it — PTY sessions stay alive
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if let Some(window) = app.get_webview_window(&label) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Dock icon click (macOS) — show the window again
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            _ => {}
        });
}
