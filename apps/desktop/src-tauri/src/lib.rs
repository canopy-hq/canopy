mod daemon_client;
mod agent_watcher;
mod editor;
mod git;
mod github;
mod hook_installer;
mod hook_server;
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
/// - dev  → ~/Library/Application Support/com.canopy.dev/
/// - prod → ~/Library/Application Support/com.canopy.app/
/// The identifier is set per-environment: fixed in dev.ts, tauri.conf.json for prod.
fn db_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_path(app: tauri::AppHandle) -> Result<String, String> {
    let data_dir = db_data_dir(&app)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("canopy.db").to_string_lossy().into_owned())
}

/// Deletes the SQLite DB file so the app can start fresh on next boot.
/// Called by the frontend when DB init or migrations fail.
#[tauri::command]
fn delete_db(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = db_data_dir(&app)?;
    let db_path = data_dir.join("canopy.db");
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

/// Write `projects[path].hasTrustDialogAccepted = true` into `~/.claude/settings.json`.
///
/// Claude Code checks this key before showing the "do you trust this folder?" prompt.
/// Canopy calls this just before launching a Claude Code session so the prompt is
/// skipped for directories the user already opened in Canopy.
///
/// The write is atomic (temp file + rename). Errors are silently swallowed —
/// trust pre-seeding is cosmetic only and must never block a Claude launch.
#[tauri::command]
fn pre_trust_claude_dir(path: String) {
    let Ok(home) = std::env::var("HOME") else { return };
    // Claude Code stores per-project config (including hasTrustDialogAccepted) in
    // ~/.claude.json — NOT ~/.claude/settings.json (which is the app-level hooks config).
    let settings_path = format!("{home}/.claude.json");

    // Normalize: strip trailing slashes so the key matches `process.cwd()` in Node.
    // git2's Worktree::path() always appends a '/'; Node's process.cwd() does not.
    let path = path.trim_end_matches('/').to_string();

    let content = std::fs::read_to_string(&settings_path).unwrap_or_else(|_| "{}".to_string());
    let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) else { return };

    if !json.get("projects").map(|v| v.is_object()).unwrap_or(false) {
        json["projects"] = serde_json::json!({});
    }
    let projects = json["projects"].as_object_mut().expect("just ensured object");
    let entry = projects.entry(path).or_insert_with(|| serde_json::json!({}));
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("hasTrustDialogAccepted".to_string(), serde_json::json!(true));
    }

    let Ok(pretty) = serde_json::to_string_pretty(&json) else { return };
    let tmp = format!("{settings_path}.canopy-tmp");
    if std::fs::write(&tmp, pretty).is_ok() {
        let _ = std::fs::rename(&tmp, &settings_path);
    }
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
                .and_then(|p| p.parent().map(|d| d.join("canopy-pty-daemon")))
                .unwrap_or_else(|| std::path::PathBuf::from("canopy-pty-daemon"));

            // Start or connect to the daemon (synchronous)
            let daemon_pid = match DaemonClient::ensure_daemon_sync(&socket, &bin) {
                Ok(pid) => pid,
                Err(e) => { eprintln!("Warning: could not start PTY daemon: {e}"); None }
            };

            app.manage(DaemonPid(Mutex::new(daemon_pid)));
            app.manage(DaemonClient::new(socket, bin));
            app.manage(Mutex::new(pty::PtyState::new()));
            app.manage(Mutex::new(agent_watcher::AgentWatcherState::new()));
            app.manage(github::PollCancelFlag(std::sync::atomic::AtomicBool::new(false)));
            app.manage(github::HttpClient(github::build_http_client()));

            // Start the hook HTTP server for agent state callbacks.
            // Binds synchronously, spawns the async server on the tokio runtime.
            let handle = app.handle().clone();
            match hook_server::start_hook_server(handle) {
                Ok((port, token)) => {
                    app.manage(hook_server::HookServerState { port, token });
                }
                Err(e) => {
                    eprintln!("Warning: could not start hook server: {e}");
                    // Fallback: manage a dummy state so spawn_terminal doesn't panic
                    app.manage(hook_server::HookServerState {
                        port: 0,
                        token: String::new(),
                    });
                }
            }

            // Clean stale pane_id sidecar files from previous runs.
            if let Some(home) = dirs::home_dir() {
                let run_dir = home.join(".canopy").join("run");
                if run_dir.is_dir() {
                    let _ = std::fs::remove_dir_all(&run_dir);
                }
                let _ = std::fs::create_dir_all(&run_dir);
            }

            // Install notify script + agent hooks (non-blocking background task).
            // Uses the bundled canopy-notify script resource.
            let notify_content = include_bytes!("../resources/canopy-notify").to_vec();
            tauri::async_runtime::spawn_blocking(move || {
                match hook_installer::ensure_notify_script(&notify_content) {
                    Ok(path) => {
                        let results = hook_installer::install_all_hooks(&path);
                        for (name, result) in &results {
                            if let Err(e) = result {
                                eprintln!("[hook] failed to install hooks for {name}: {e}");
                            }
                        }
                    }
                    Err(e) => eprintln!("[hook] failed to install notify script: {e}"),
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_db_path,
            delete_db,
            log_info,
            pre_trust_claude_dir,
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
