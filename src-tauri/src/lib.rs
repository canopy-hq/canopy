mod menu;
mod pty;

use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            menu::setup_menu(app)?;
            Ok(())
        })
        .manage(Mutex::new(pty::PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            pty::spawn_terminal,
            pty::write_to_pty,
            pty::resize_pty,
            pty::close_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
