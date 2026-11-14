// System tray icon and menu. The app keeps running here when its window is closed.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

const PAUSE_ID: &str = "pause";

/// Handle to the "Pause watching" menu item, kept so its label can follow the watcher state.
struct PauseItem(MenuItem<Wry>);

/// Create the tray icon. Left click opens the window; right click shows the menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Photo Trips", true, None::<&str>)?;
    let import = MenuItem::with_id(app, "import", "Import photos...", true, None::<&str>)?;
    // Disabled until there are inbox folders to watch.
    let pause = MenuItem::with_id(app, PAUSE_ID, "Pause watching", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &import, &pause, &separator, &quit])?;
    app.manage(PauseItem(pause));

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Photo Trips")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "import" => {
                show_main(app);
                let _ = app.emit("navigate", "import");
            }
            PAUSE_ID => {
                let _ = app.emit("tray://toggle-pause", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Bring the main window back from the tray (or from behind other windows).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Match the pause item and tooltip to the watcher: `None` when nothing is being watched.
pub fn set_watch_state(app: &AppHandle, paused: Option<bool>) {
    if let Some(item) = app.try_state::<PauseItem>() {
        let _ = item.0.set_enabled(paused.is_some());
        let _ = item.0.set_text(if paused == Some(true) {
            "Resume watching"
        } else {
            "Pause watching"
        });
    }
    if let Some(tray) = app.tray_by_id("main") {
        let tip = if paused == Some(true) {
            "Photo Trips (watching paused)"
        } else {
            "Photo Trips"
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}
