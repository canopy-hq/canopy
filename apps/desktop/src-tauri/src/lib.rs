mod daemon_client;
mod agent_watcher;
mod git;
mod github;
mod menu;
mod pty;

use std::sync::Mutex;
use daemon_client::DaemonClient;
use tauri::{Emitter, Manager};
use tauri::window::Color;

/// Returns the absolute path to the SQLite DB.
/// Uses app_data_dir() so dev and prod builds get separate databases:
///   prod  → ~/Library/Application Support/com.superagent.app/superagent.db
///   dev   → ~/Library/Application Support/com.superagent.dev-<hash>/superagent.db
#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("superagent.db").to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .setup(|app| {
            // Disable macOS press-and-hold accent picker — key repeat works instead
            let bundle_id = &app.config().identifier;
            let _ = std::process::Command::new("defaults")
                .args(["write", bundle_id, "ApplePressAndHoldEnabled", "-bool", "false"])
                .output();

            menu::setup_menu(app)?;

            // Match the native window + webview background to the default dark theme
            // (#0a0a14) so macOS resize animations don't show a different-colored gap.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(Color(10, 10, 20, 255)));
            }

            // Locate daemon socket and binary.
            // Always use the canonical app data dir so all dev worktrees (which may
            // override the identifier for single-instance scoping) share one daemon.
            let data_dir = match std::env::var("SUPERAGENT_DATA_DIR") {
                Ok(dir) => std::path::PathBuf::from(dir),
                Err(_) => app.path().app_data_dir()?,
            };
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("Warning: could not create data dir {}: {e}", data_dir.display());
            }
            let socket = data_dir.join("pty-daemon.sock");
            let bin = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("superagent-pty-daemon")))
                .unwrap_or_else(|| std::path::PathBuf::from("superagent-pty-daemon"));

            // Start or connect to the daemon (synchronous)
            if let Err(e) = DaemonClient::ensure_daemon_sync(&socket, &bin) {
                eprintln!("Warning: could not start PTY daemon: {e}");
            }

            app.manage(DaemonClient::new(socket));
            app.manage(Mutex::new(pty::PtyState::new()));
            app.manage(Mutex::new(agent_watcher::AgentWatcherState::new()));
            app.manage(github::PollCancelFlag(std::sync::atomic::AtomicBool::new(false)));
            app.manage(github::HttpClient(github::build_http_client()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_db_path,
            pty::spawn_terminal,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::close_ptys_for_panes,
            pty::get_pty_cwd,
            pty::list_pty_sessions,
            pty::init_terminal_pool,
            git::import_repo,
            git::list_branches,
            git::list_all_branches,
            git::fetch_remote,
            git::list_worktrees,
            git::create_branch,
            git::delete_branch,
            git::create_worktree,
            git::remove_worktree,
            git::get_diff_stats,
            git::get_all_diff_stats,
            git::poll_all_project_states,
            agent_watcher::start_agent_watching,
            agent_watcher::stop_agent_watching,
            agent_watcher::toggle_agent_manual,
            github::github_start_device_flow,
            github::github_poll_token,
            github::github_get_connection,
            github::github_cancel_poll,
            github::github_disconnect,
            github::github_get_pr_statuses,
        ])
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let emit_id = match id {
                "settings" => Some("menu:settings"),
                #[cfg(debug_assertions)]
                "fps-overlay" => Some("menu:fps-overlay"),
                _ => None,
            };
            if let Some(emit_id) = emit_id {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit(emit_id, ());
                }
            }
        })
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
