// Notice memory cards and phones as they are plugged in, so the Import page can list them and
// the tray can offer to import from them. Checked every few seconds on a background thread.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::AppState;
use crate::commands::lock_db;
use crate::db;
use crate::import::SourceSpec;
use crate::mtp;
use crate::tray;

const POLL_EVERY: Duration = Duration::from_secs(5);
/// Sent with the full list whenever a card or phone comes or goes.
pub const CHANGED_EVENT: &str = "devices://changed";
/// GetDriveTypeW's answer for a memory card, USB stick or card reader slot.
const DRIVE_REMOVABLE: u32 = 2;

/// A card or phone to import from.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// `drive` (a removable drive with a DCIM folder) or `phone` (a phone or camera over USB).
    pub kind: &'static str,
    /// The drive's root folder, or the phone's Windows device id.
    pub id: String,
    pub name: String,
}

impl Device {
    /// This card or phone as something to import from.
    pub fn source(&self) -> SourceSpec {
        match self.kind {
            "phone" => SourceSpec::Phone {
                id: self.id.clone(),
                name: self.name.clone(),
            },
            _ => SourceSpec::Drive {
                path: self.id.clone().into(),
                name: self.name.clone(),
            },
        }
    }
}

/// Managed state: what was connected at the last check.
#[derive(Default)]
pub struct Devices {
    current: Mutex<Vec<Device>>,
}

impl Devices {
    pub fn list(&self) -> Vec<Device> {
        self.current.lock().map(|c| c.clone()).unwrap_or_default()
    }
}

/// Cards and phones connected now.
#[tauri::command]
pub fn import_sources(devices: State<Devices>) -> Vec<Device> {
    devices.list()
}

/// The import notification's device id, so a click checks that device even after another arrives.
pub const DEVICE_KEY: &str = "device";

/// The card or phone with this id, while it is still connected.
pub fn connected(app: &AppHandle, id: Option<&str>) -> Option<Device> {
    let devices = app.try_state::<Devices>()?;
    let current = devices.current.lock().ok()?;
    current.iter().find(|d| Some(d.id.as_str()) == id).cloned()
}

/// Start checking for cards and phones in the background.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("devices".into())
        .spawn(move || watch(&app));
    if let Err(err) = spawned {
        log::error!("Couldn't start watching for cards and phones: {err}");
    }
}

fn watch(app: &AppHandle) {
    // Windows Portable Devices needs COM, set up once for this thread.
    let provider = mtp::provider()
        .inspect_err(|err| log::warn!("{err}; phones won't be noticed"))
        .ok();
    let mut first = true;
    loop {
        let mut found = drives();
        if let Some(provider) = &provider {
            found.extend(mtp::list(provider).into_iter().map(|d| Device {
                kind: "phone",
                id: d.id,
                name: d.name,
            }));
        }
        let previous = match app.state::<Devices>().current.lock() {
            Ok(mut current) => std::mem::replace(&mut *current, found.clone()),
            Err(_) => return,
        };
        if found != previous {
            let arrived: Vec<&Device> = found.iter().filter(|d| !previous.contains(d)).collect();
            // Whatever was plugged in before Pic Cabinet started isn't news.
            if !first {
                for device in &arrived {
                    notify(app, device);
                }
            }
            tray::set_import_device(app, arrived.last().copied().or(found.last()));
            let _ = app.emit(CHANGED_EVENT, &found);
        }
        first = false;
        std::thread::sleep(POLL_EVERY);
    }
}

/// When each device was last announced, one "key<tab>unix seconds" per line. A card or phone
/// plugged in again before the gap in Settings is up (to charge, say) isn't announced again;
/// the tray menu's Import item still offers it.
const NOTIFIED_KEY: &str = "notified_devices";
/// How often a device may be announced: "always", "day", "week" or "never".
pub const NOTIFY_SETTING: &str = "device_notify";
/// The choices for [`NOTIFY_SETTING`]. Must match DEVICE_NOTIFY in settingValues.ts.
pub const NOTIFY_CHOICES: &[&str] = &["always", "day", "week", "never"];

/// Seconds a device must wait between notifications, from the setting, or `None` for never.
/// Unset or unknown means once a day.
fn notify_gap(setting: Option<&str>) -> Option<u64> {
    match setting {
        Some("always") => Some(0),
        Some("week") => Some(7 * 24 * 60 * 60),
        Some("never") => None,
        _ => Some(24 * 60 * 60),
    }
}

/// What identifies a device across plug-ins: a phone's Windows id, or a card's name, since a
/// card's id is only its drive letter and different cards share one.
fn notified_key(device: &Device) -> String {
    let which = if device.kind == "phone" {
        &device.id
    } else {
        &device.name
    };
    format!("{}|{which}", device.kind)
}

/// `known` with `key` stamped `now`, when `key` is due a notification: never announced, or
/// last announced at least `gap` seconds ago. `None` when it was announced too recently.
/// Unreadable lines are dropped.
fn due(known: &str, key: &str, now: u64, gap: u64) -> Option<String> {
    let mut lines: Vec<(&str, u64)> = known
        .lines()
        .filter_map(|line| {
            let (k, at) = line.split_once('\t')?;
            Some((k, at.parse().ok()?))
        })
        .collect();
    if let Some((_, at)) = lines.iter().find(|(k, _)| *k == key)
        && now.saturating_sub(*at) < gap
    {
        return None;
    }
    lines.retain(|(k, _)| *k != key);
    lines.push((key, now));
    Some(
        lines
            .iter()
            .map(|(k, at)| format!("{k}\t{at}"))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

/// Say a device can be imported from, unless Settings says not to or it was said too recently.
fn notify(app: &AppHandle, device: &Device) {
    {
        let state = app.state::<AppState>();
        let Ok(conn) = lock_db(&state) else { return };
        let setting = db::get_setting(&conn, NOTIFY_SETTING).ok().flatten();
        let Some(gap) = notify_gap(setting.as_deref()) else {
            return;
        };
        let known = db::get_setting(&conn, NOTIFIED_KEY)
            .ok()
            .flatten()
            .unwrap_or_default();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        let Some(updated) = due(&known, &notified_key(device), now, gap) else {
            return;
        };
        if let Err(err) = db::set_setting(&conn, NOTIFIED_KEY, &updated) {
            log::warn!("Couldn't note the device notification: {err}");
        }
    }
    let shown = app
        .notification()
        .builder()
        .title(format!("Import photos from {}?", device.name))
        .body("Click to see what's new.")
        .extra(tray::OPENS_KEY, tray::OPENS_IMPORT)
        .extra(DEVICE_KEY, &device.id)
        .show();
    if let Err(err) = shown {
        log::warn!("Couldn't show the import notification: {err}");
    }
}

/// Removable drives with a DCIM folder, the layout every camera and phone card uses.
#[cfg(windows)]
fn drives() -> Vec<Device> {
    use windows::Win32::Storage::FileSystem::{
        GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    use windows::core::HSTRING;

    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .filter_map(|i| {
            let letter = char::from(b'A' + i);
            let root = format!("{letter}:\\");
            let wide = HSTRING::from(root.as_str());
            // An empty card reader slot is removable too; it has no DCIM folder to find.
            if unsafe { GetDriveTypeW(&wide) } != DRIVE_REMOVABLE
                || !Path::new(&root).join("DCIM").is_dir()
            {
                return None;
            }
            let mut label = [0u16; 261];
            let read =
                unsafe { GetVolumeInformationW(&wide, Some(&mut label), None, None, None, None) };
            let end = label.iter().position(|&c| c == 0).unwrap_or(label.len());
            let label = String::from_utf16_lossy(&label[..end]);
            let name = match read {
                Ok(()) if !label.trim().is_empty() => format!("{} ({letter}:)", label.trim()),
                _ => format!("Memory card ({letter}:)"),
            };
            Some(Device {
                kind: "drive",
                id: root,
                name,
            })
        })
        .collect()
}

#[cfg(not(windows))]
fn drives() -> Vec<Device> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device(kind: &'static str, id: &str, name: &str) -> Device {
        Device {
            kind,
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn a_device_is_announced_again_only_after_the_gap() {
        let gap = 600;
        let phone = notified_key(&device("phone", r"\\?\usb#1", "Pixel 8"));
        let known = due("", &phone, 1_000, gap).unwrap();
        assert_eq!(due(&known, &phone, 1_000 + gap - 1, gap), None);
        let again = due(&known, &phone, 1_000 + gap, gap).unwrap();
        assert_eq!(again, format!("{phone}\t{}", 1_000 + gap));
        assert!(due(&known, &phone, 1_000, 0).is_some(), "every time");
    }

    #[test]
    fn each_device_keeps_its_own_time() {
        let phone = notified_key(&device("phone", r"\\?\usb#1", "Pixel 8"));
        let card = notified_key(&device("drive", r"E:\", "CANON_DC"));
        let known = due("", &phone, 1_000, 600).unwrap();
        let known = due(&known, &card, 2_000, 600).unwrap();
        assert_eq!(known.lines().count(), 2);
        assert_eq!(due(&known, &phone, 1_500, 600), None);
        assert!(due(&known, &phone, 1_600, 600).is_some());
        assert_eq!(due(&known, &card, 2_500, 600), None);
    }

    #[test]
    fn the_setting_picks_the_gap_and_defaults_to_a_day() {
        assert_eq!(notify_gap(Some("always")), Some(0));
        assert_eq!(notify_gap(Some("week")), Some(604_800));
        assert_eq!(notify_gap(Some("never")), None);
        assert_eq!(notify_gap(None), Some(86_400));
        assert_eq!(notify_gap(Some("day")), notify_gap(None));
        assert!(
            NOTIFY_CHOICES
                .iter()
                .all(|c| *c == "day" || notify_gap(Some(c)) != notify_gap(None))
        );
    }

    #[test]
    fn cards_are_told_apart_by_name_not_drive_letter() {
        let a = notified_key(&device("drive", r"E:\", "CANON_DC"));
        let b = notified_key(&device("drive", r"E:\", "NIKON"));
        assert_ne!(a, b);
    }
}
