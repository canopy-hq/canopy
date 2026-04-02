mod agent_watcher;
mod git;
mod menu;
mod pty;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            menu::setup_menu(app)?;

            // Disable macOS press-and-hold accent picker so key repeat works in terminals.
            // Without this, holding a key triggers composition mode instead of repeating.
            #[cfg(target_os = "macos")]
            {
                use std::process::Command;
                let _ = Command::new("defaults")
                    .args(["write", "com.superagent.app", "ApplePressAndHoldEnabled", "-bool", "false"])
                    .output();
            }

            Ok(())
        })
        .manage(Mutex::new(pty::PtyManager::new()))
        .manage(Mutex::new(agent_watcher::AgentWatcherState::new()))
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
