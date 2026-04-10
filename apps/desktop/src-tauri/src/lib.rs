mod daemon_client;
mod agent_watcher;
mod editor;
mod git;
mod github;
mod menu;
mod pty;

use std::sync::Mutex;
use daemon_client::DaemonClient;
use tauri::{Emitter, Manager};
use tauri::window::Color;

/// PID of the daemon process this app spawned. `None` if we attached to an
/// already-running daemon (e.g. after a crash). Used to SIGTERM on clean exit.
struct DaemonPid(Mutex<Option<u32>>);

/// Returns the directory that holds the SQLite DB.
/// - dev  → ~/Library/Application Support/com.superagent.dev/
/// - prod → ~/Library/Application Support/com.superagent.app/
/// The identifier is set per-environment: fixed in dev.ts, tauri.conf.json for prod.
fn db_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = db_data_dir(&app)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("superagent.db").to_string_lossy().into_owned())
}

/// Deletes the SQLite DB file so the app can start fresh on next boot.
/// Called by the frontend when DB init or migrations fail.
#[tauri::command]
fn delete_db(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = db_data_dir(&app)?;
    let db_path = data_dir.join("superagent.db");
    if db_path.exists() {
        std::fs::remove_file(&db_path).map_err(|e| e.to_string())?;
        eprintln!("Deleted corrupt/invalid DB at {}", db_path.display());
    }
    Ok(())
}

#[tauri::command]
fn log_info(message: String) {
    eprintln!("[ui] {message}");
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
            let data_dir = app.path().app_data_dir()?;
            if let Err(e) = std::fs::create_dir_all(&data_dir) {
                eprintln!("Warning: could not create data dir {}: {e}", data_dir.display());
            }
            let socket = data_dir.join("pty-daemon.sock");
            let bin = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("superagent-pty-daemon")))
                .unwrap_or_else(|| std::path::PathBuf::from("superagent-pty-daemon"));

            // Start or connect to the daemon (synchronous)
            let daemon_pid = match DaemonClient::ensure_daemon_sync(&socket, &bin) {
                Ok(pid) => pid,
                Err(e) => { eprintln!("Warning: could not start PTY daemon: {e}"); None }
            };

            app.manage(DaemonPid(Mutex::new(daemon_pid)));
            app.manage(DaemonClient::new(socket));
            app.manage(Mutex::new(pty::PtyState::new()));
            app.manage(Mutex::new(agent_watcher::AgentWatcherState::new()));
            app.manage(github::PollCancelFlag(std::sync::atomic::AtomicBool::new(false)));
            app.manage(github::HttpClient(github::build_http_client()));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_db_path,
            delete_db,
            log_info,
            pty::spawn_terminal,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
            pty::close_ptys_for_panes,
            pty::get_pty_cwd,
            pty::list_pty_sessions,
            pty::init_terminal_pool,
            git::import_repo,
            git::clone_repo,
            git::check_remote,
            git::list_remote_branches,
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
            git::check_project_paths,
            agent_watcher::start_agent_watching,
            agent_watcher::stop_agent_watching,
            agent_watcher::toggle_agent_manual,
            github::github_start_device_flow,
            github::github_poll_token,
            github::github_get_connection,
            github::github_cancel_poll,
            github::github_disconnect,
            github::github_get_pr_statuses,
            editor::detect_editors,
            editor::open_in_editor,
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
            // Clean quit (Cmd+Q): kill the daemon we spawned so it doesn't linger.
            // Not reached on force-kill (kill -9) — that's acceptable.
            tauri::RunEvent::Exit => {
                if let Some(state) = app.try_state::<DaemonPid>() {
                    if let Ok(guard) = state.0.lock() {
                        if let Some(pid) = *guard {
                            let _ = std::process::Command::new("kill")
                                .args(["-TERM", &pid.to_string()])
                                .output();
                        }
                    }
                }
            }
            _ => {}
        });
}
