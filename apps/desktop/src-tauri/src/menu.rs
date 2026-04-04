use tauri::menu::{MenuBuilder, PredefinedMenuItem, SubmenuBuilder};

pub fn setup_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_submenu = SubmenuBuilder::new(app, "Superagent")
        .about(None)
        .separator()
        .text("settings", "Settings...")
        .separator()
        .quit()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .close_window()
        .build()?;

    #[cfg(debug_assertions)]
    let help_submenu = SubmenuBuilder::new(app, "Help")
        .text("fps-overlay", "Toggle FPS Overlay")
        .build()?;

    #[cfg(debug_assertions)]
    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &edit_submenu, &window_submenu, &help_submenu])
        .build()?;

    #[cfg(not(debug_assertions))]
    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &edit_submenu, &window_submenu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
