// System tray icon and menu. The app keeps running here when its window is closed.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::devices::Device;
use crate::import;

const PAUSE_ID: &str = "pause";
const IMPORT_ID: &str = "import";

/// Handle to the "Pause watching" menu item, kept so its label can follow the watcher state.
struct PauseItem(MenuItem<Wry>);

/// Handle to the import menu item and the card or phone it currently offers, if any.
struct ImportItem {
    item: MenuItem<Wry>,
    device: Mutex<Option<Device>>,
}

/// Create the tray icon. Left click opens the window; right click shows the menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Photo Trips", true, None::<&str>)?;
    let import = MenuItem::with_id(app, IMPORT_ID, "Import photos...", true, None::<&str>)?;
    // Disabled until there are inbox folders to watch.
    let pause = MenuItem::with_id(app, PAUSE_ID, "Pause watching", false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &import, &pause, &separator, &quit])?;
    app.manage(PauseItem(pause));
    app.manage(ImportItem {
        item: import,
        device: Mutex::new(None),
    });

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Photo Trips")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            IMPORT_ID => open_import(app),
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

/// Show the Import page and, when a card or phone is on offer, start checking it for new
/// photos. A job already running means the page lists the device for later instead.
fn open_import(app: &AppHandle) {
    show_main(app);
    let _ = app.emit("navigate", "import");
    let device = app
        .try_state::<ImportItem>()
        .and_then(|item| item.device.lock().ok().and_then(|d| d.clone()));
    if let Some(device) = device
        && let Err(err) = import::start_scan(app, device.source())
    {
        log::info!("Didn't start checking {}: {err}", device.name);
    }
}

/// Bring the main window back from the tray (or from behind other windows).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Offer `device` in the import menu item, or a plain "Import photos..." when there is none.
pub fn set_import_device(app: &AppHandle, device: Option<&Device>) {
    let Some(import) = app.try_state::<ImportItem>() else {
        return;
    };
    let text = match device {
        Some(d) => format!("Import from {}...", d.name),
        None => "Import photos...".to_owned(),
    };
    let _ = import.item.set_text(text);
    if let Ok(mut offered) = import.device.lock() {
        *offered = device.cloned();
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
