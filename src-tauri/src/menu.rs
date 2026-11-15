// The main window's menu bar: File, View, Options and Help.
//
// The shortcuts beside the items are text only. Keys pressed in the page go to WebView2's own
// window, which doesn't pass them on to the menu, so real menu accelerators would rarely fire.
// The page catches the keys instead (src/lib/menu.ts) and calls `menu_action` with the item's
// id, so a click and a key press run the same code.

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::AppState;
use crate::commands::{self, lock_db};
use crate::db;
use crate::error::{Error, Result};
use crate::tray;
use crate::watch;

// The tray menu's handler sees these clicks too (Tauri sends every menu event to every
// handler), so none of these ids may match a tray item's.
const IMPORT: &str = "menu-import";
const REFRESH: &str = "menu-refresh";
const OPEN_LIBRARY: &str = "menu-open-library";
const CLOSE: &str = "menu-close";
const QUIT: &str = "menu-quit";
const SETTINGS: &str = "menu-settings";
const PAUSE: &str = "menu-pause";
const CLOSE_TO_TRAY: &str = "menu-close-to-tray";
const AUTOSTART: &str = "menu-autostart";
const OPEN_LOGS: &str = "menu-open-logs";
const UPDATES: &str = "menu-updates";
const ABOUT: &str = "menu-about";
const HELP: &str = "menu-help";
/// View items are this prefix plus the page id the frontend uses.
const PAGE_PREFIX: &str = "menu-page-";

/// View menu: page id, label (`&` marks the Alt key letter) and shortcut.
const PAGES: &[(&str, &str, &str)] = &[
    ("library", "&Library", "Ctrl+1"),
    ("sort", "&Sort", "Ctrl+2"),
    ("trips", "&Trips", "Ctrl+3"),
    ("suggestions", "Su&ggestions", "Ctrl+4"),
    ("import", "&Import", "Ctrl+5"),
    ("duplicates", "&Duplicates", "Ctrl+6"),
    ("history", "&History", "Ctrl+7"),
];

/// Asks the page to do something only it can show: `"refresh"`, `"about"` or `"updates"`.
pub const ACTION_EVENT: &str = "menu://action";
/// Sent with a [`SettingChanged`] when the menu changes a stored setting.
pub const SETTING_EVENT: &str = "settings://changed";
/// Sent with the new state when Start with Windows changes.
pub const AUTOSTART_EVENT: &str = "autostart://changed";

/// A setting the menu has just saved, so the page can show the new value.
#[derive(Clone, Serialize)]
struct SettingChanged {
    key: &'static str,
    value: &'static str,
}

/// Items whose text or tick follows state that can also change elsewhere.
struct WindowMenu {
    import: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    close_to_tray: CheckMenuItem<Wry>,
    autostart: CheckMenuItem<Wry>,
}

/// Give the main window its menu bar.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let close_to_tray = {
        let state = app.state::<AppState>();
        lock_db(&state)
            .and_then(|conn| db::get_bool(&conn, "close_to_tray", true))
            .unwrap_or(true)
    };
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);

    let item = |id: &str, text: &str, shortcut: Option<&str>| {
        MenuItem::with_id(app, id, label(text, shortcut), true, None::<&str>)
    };

    let import = MenuItem::with_id(app, IMPORT, import_text(None), true, None::<&str>)?;
    let file = Submenu::with_items(
        app,
        "&File",
        true,
        &[
            &import,
            &item(REFRESH, "&Look for new photos", Some("F5"))?,
            &item(OPEN_LIBRARY, "&Open library folder", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(CLOSE, "&Close window", Some("Ctrl+W"))?,
            &item(QUIT, "&Quit Pic Cabinet", Some("Ctrl+Q"))?,
        ],
    )?;

    let view = Submenu::with_id(app, "menu-view", "&View", true)?;
    for (page, text, shortcut) in PAGES {
        let id = format!("{PAGE_PREFIX}{page}");
        view.append(&item(&id, text, Some(shortcut))?)?;
    }

    // Disabled until the watcher reports inbox folders to watch.
    let pause = MenuItem::with_id(app, PAUSE, pause_text(false), false, None::<&str>)?;
    let tray_item = CheckMenuItem::with_id(
        app,
        CLOSE_TO_TRAY,
        "Keep running in the &tray",
        true,
        close_to_tray,
        None::<&str>,
    )?;
    let autostart_item = CheckMenuItem::with_id(
        app,
        AUTOSTART,
        "Start with &Windows",
        true,
        autostart,
        None::<&str>,
    )?;
    let options = Submenu::with_items(
        app,
        "&Options",
        true,
        &[
            &item(SETTINGS, "&Settings...", Some("Ctrl+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &pause,
            &tray_item,
            &autostart_item,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "&Help",
        true,
        &[
            &item(HELP, "Pic Cabinet &help", Some("F1"))?,
            &PredefinedMenuItem::separator(app)?,
            &item(OPEN_LOGS, "Open &log folder", None)?,
            &item(UPDATES, "Check for &updates...", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(ABOUT, "&About Pic Cabinet", None)?,
        ],
    )?;

    window.set_menu(Menu::with_items(app, &[&file, &view, &options, &help])?)?;
    app.manage(WindowMenu {
        import,
        pause,
        close_to_tray: tray_item,
        autostart: autostart_item,
    });
    app.on_menu_event(|app, event| {
        run(app, event.id.as_ref());
    });
    Ok(())
}

/// Item text with its shortcut, which Windows lines up in a column after the tab.
fn label(text: &str, shortcut: Option<&str>) -> String {
    match shortcut {
        Some(keys) => format!("{text}\t{keys}"),
        None => text.to_owned(),
    }
}

/// The import item's text: like the tray's, it names the card or phone it will check first.
fn import_text(device: Option<&str>) -> String {
    match device {
        // A lone & would underline the next letter as an Alt key, so names show && for one.
        Some(name) => label(
            &format!("&Import from {}...", name.replace('&', "&&")),
            Some("Ctrl+I"),
        ),
        None => label("&Import photos...", Some("Ctrl+I")),
    }
}

fn pause_text(paused: bool) -> &'static str {
    if paused {
        "&Resume watching"
    } else {
        "&Pause watching"
    }
}

/// Carry out a menu item, clicked or picked by its shortcut in the page. Returns false when `id`
/// isn't a window menu item (a tray item, say).
fn run(app: &AppHandle, id: &str) -> bool {
    match id {
        IMPORT => tray::open_import(app),
        REFRESH => ask_page(app, "refresh"),
        OPEN_LIBRARY => {
            let root = {
                let state = app.state::<AppState>();
                lock_db(&state).and_then(|conn| commands::library_root(&conn))
            };
            match root {
                Ok(root) => open_folder(&root),
                Err(err) => log::warn!("Can't open the library folder: {err}"),
            }
        }
        CLOSE => {
            // Goes through CloseRequested, so the window hides to the tray when set to.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        QUIT => app.exit(0),
        SETTINGS => navigate(app, "settings"),
        HELP => navigate(app, "help"),
        PAUSE => watch::toggle_pause(app),
        CLOSE_TO_TRAY => toggle_close_to_tray(app),
        AUTOSTART => toggle_autostart(app),
        OPEN_LOGS => match app.path().app_log_dir() {
            Ok(dir) => {
                let _ = std::fs::create_dir_all(&dir);
                open_folder(&dir);
            }
            Err(err) => log::warn!("Can't find the log folder: {err}"),
        },
        ABOUT => ask_page(app, "about"),
        UPDATES => tray::open_updates(app),
        _ => match id.strip_prefix(PAGE_PREFIX) {
            Some(page) if PAGES.iter().any(|(known, _, _)| *known == page) => navigate(app, page),
            _ => return false,
        },
    }
    true
}

/// Run a menu item from its keyboard shortcut in the page.
#[tauri::command]
pub fn menu_action(app: AppHandle, id: String) -> Result<()> {
    if run(&app, &id) {
        Ok(())
    } else {
        Err(Error::msg(format!("Unknown menu item {id}")))
    }
}

fn navigate(app: &AppHandle, page: &str) {
    let _ = app.emit("navigate", page);
}

fn ask_page(app: &AppHandle, action: &str) {
    let _ = app.emit(ACTION_EVENT, action);
}

fn open_folder(path: &std::path::Path) {
    if let Err(err) = tauri_plugin_opener::open_path(path, None::<&str>) {
        log::warn!("Couldn't open {}: {err}", path.display());
    }
}

/// Save the tick the click just set. The menu flips a tick item before the click arrives.
fn toggle_close_to_tray(app: &AppHandle) {
    let Some(menu) = app.try_state::<WindowMenu>() else {
        return;
    };
    let on = menu.close_to_tray.is_checked().unwrap_or(true);
    let value = if on { "true" } else { "false" };
    let saved = {
        let state = app.state::<AppState>();
        lock_db(&state).and_then(|conn| db::set_setting(&conn, "close_to_tray", value))
    };
    match saved {
        Ok(()) => {
            let change = SettingChanged {
                key: "close_to_tray",
                value,
            };
            let _ = app.emit(SETTING_EVENT, change);
        }
        Err(err) => {
            log::error!("Couldn't save Keep running in the tray: {err}");
            let _ = menu.close_to_tray.set_checked(!on);
        }
    }
}

/// Turn Start with Windows to match the tick the click just set.
fn toggle_autostart(app: &AppHandle) {
    let Some(menu) = app.try_state::<WindowMenu>() else {
        return;
    };
    let on = menu.autostart.is_checked().unwrap_or(false);
    if let Err(err) = set_autostart(app.clone(), on) {
        log::error!("{err}");
    }
}

/// Turn Start with Windows on or off, from Settings or the menu. The menu's tick and the
/// Settings switch both end up showing what Windows has, even when the change fails.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<()> {
    let launcher = app.autolaunch();
    let changed = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    let fallback = if changed.is_ok() { enabled } else { !enabled };
    let actual = launcher.is_enabled().unwrap_or(fallback);
    if let Some(menu) = app.try_state::<WindowMenu>() {
        let _ = menu.autostart.set_checked(actual);
    }
    let _ = app.emit(AUTOSTART_EVENT, actual);
    changed.map_err(|err| Error::msg(format!("Couldn't change Start with Windows: {err}")))
}

/// Match the tick to a Keep running in the tray change made in Settings.
pub fn show_close_to_tray(app: &AppHandle, on: bool) {
    if let Some(menu) = app.try_state::<WindowMenu>() {
        let _ = menu.close_to_tray.set_checked(on);
    }
}

/// Name the card or phone File > Import will check, or none.
pub fn show_import_device(app: &AppHandle, device: Option<&str>) {
    if let Some(menu) = app.try_state::<WindowMenu>() {
        let _ = menu.import.set_text(import_text(device));
    }
}

/// Match the pause item to the watcher: `None` when nothing is being watched.
pub fn show_watch_state(app: &AppHandle, paused: Option<bool>) {
    if let Some(menu) = app.try_state::<WindowMenu>() {
        let _ = menu.pause.set_enabled(paused.is_some());
        let _ = menu.pause.set_text(pause_text(paused == Some(true)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_follow_a_tab() {
        assert_eq!(label("&Sort", Some("Ctrl+2")), "&Sort\tCtrl+2");
        assert_eq!(label("Open &log folder", None), "Open &log folder");
    }

    #[test]
    fn import_item_names_the_device() {
        assert_eq!(import_text(None), "&Import photos...\tCtrl+I");
        assert_eq!(
            import_text(Some("Tom & Ana's phone")),
            "&Import from Tom && Ana's phone...\tCtrl+I"
        );
    }

    #[test]
    fn page_shortcuts_name_real_menu_items() {
        let fixed = [
            IMPORT,
            REFRESH,
            OPEN_LIBRARY,
            CLOSE,
            QUIT,
            SETTINGS,
            PAUSE,
            CLOSE_TO_TRAY,
            AUTOSTART,
            OPEN_LOGS,
            UPDATES,
            ABOUT,
            HELP,
        ];
        let known = |id: &str| {
            fixed.contains(&id)
                || id
                    .strip_prefix(PAGE_PREFIX)
                    .is_some_and(|page| PAGES.iter().any(|(known, _, _)| *known == page))
        };
        // Every quoted "menu-..." string in the page's shortcut table.
        let source = include_str!("../../src/lib/menu.ts");
        let ids: Vec<&str> = source
            .split('"')
            .filter(|part| part.starts_with("menu-") && !part.contains(' '))
            .collect();
        assert!(ids.len() >= 12, "only found {ids:?}");
        for id in ids {
            assert!(known(id), "{id}");
        }
    }
}
