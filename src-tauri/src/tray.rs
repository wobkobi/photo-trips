// System tray icon and menu. The app keeps running here when its window is closed.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::AppState;
use crate::commands;
use crate::commands::lock_db;
use crate::db;
use crate::devices::Device;
use crate::import;
use crate::watch;

const PAUSE_ID: &str = "pause";
const IMPORT_ID: &str = "import";
const UPDATE_ID: &str = "update";
/// Set once the "still running in the tray" notice has been shown, so it never repeats.
const HIDDEN_NOTICE_KEY: &str = "tray_notice_shown";

/// Handle to the "Pause watching" menu item, kept so its label can follow the watcher state.
struct PauseItem(MenuItem<Wry>);

/// Handle to the updates item, whose text names a waiting update.
struct UpdateItem(MenuItem<Wry>);

/// Handle to the import menu item and the card or phone it currently offers, if any.
struct ImportItem {
    item: MenuItem<Wry>,
    device: Mutex<Option<Device>>,
}

/// Create the tray icon. Left click opens the window; right click shows the menu.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Pic Cabinet", true, None::<&str>)?;
    let import = MenuItem::with_id(app, IMPORT_ID, "Import photos...", true, None::<&str>)?;
    // Disabled until there are inbox folders to watch.
    let pause = MenuItem::with_id(app, PAUSE_ID, "Pause watching", false, None::<&str>)?;
    let update = MenuItem::with_id(app, UPDATE_ID, update_text(None), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &import, &pause, &separator, &update, &quit])?;
    app.manage(PauseItem(pause));
    app.manage(UpdateItem(update));
    app.manage(ImportItem {
        item: import,
        device: Mutex::new(None),
    });

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Pic Cabinet")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            IMPORT_ID => open_import(app),
            PAUSE_ID => watch::toggle_pause(app),
            UPDATE_ID => open_updates(app),
            "quit" => commands::quit(app),
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
pub fn open_import(app: &AppHandle) {
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

/// Show Settings > About and check for updates there, where a waiting update can be installed.
pub fn open_updates(app: &AppHandle) {
    show_main(app);
    let _ = app.emit(crate::menu::ACTION_EVENT, "updates");
}

/// Bring the main window back from the tray (or from behind other windows).
pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The first time closing hides the window, say the app is still running in the tray, so the
/// window going doesn't read as a quit. Noted only once shown, so a notice that fails to show is
/// tried again on the next close.
pub fn notify_hidden_once(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(conn) = lock_db(&state) else { return };
    if db::get_bool(&conn, HIDDEN_NOTICE_KEY, false).unwrap_or(false) {
        return;
    }
    let shown = app
        .notification()
        .builder()
        .title("Pic Cabinet is still running")
        .body("Open it again from the tray icon, or choose Quit there to close it.")
        .show();
    match shown {
        Ok(()) => {
            if let Err(err) = db::set_setting(&conn, HIDDEN_NOTICE_KEY, "true") {
                log::warn!("Couldn't note the tray notice: {err}");
            }
        }
        Err(err) => log::warn!("Couldn't show the tray notice: {err}"),
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
    crate::menu::show_import_device(app, device.map(|d| d.name.as_str()));
    if let Ok(mut offered) = import.device.lock() {
        *offered = device.cloned();
    }
}

fn update_text(version: Option<&str>) -> String {
    match version {
        Some(version) => format!("Install update {version}..."),
        None => "Check for updates...".to_owned(),
    }
}

/// Name the update waiting to install, or offer a check when there is none.
pub fn set_update(app: &AppHandle, version: Option<&str>) {
    if let Some(item) = app.try_state::<UpdateItem>() {
        let _ = item.0.set_text(update_text(version));
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
            "Pic Cabinet (watching paused)"
        } else {
            "Pic Cabinet"
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}
