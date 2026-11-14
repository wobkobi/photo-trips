// Notice memory cards and phones as they are plugged in, so the Import page can list them and
// the tray can offer to import from them. Checked every few seconds on a background thread.

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

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
            // Whatever was plugged in before Photo Trips started isn't news.
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

fn notify(app: &AppHandle, device: &Device) {
    let shown = app
        .notification()
        .builder()
        .title(format!("Import photos from {}?", device.name))
        .body(format!(
            "Choose Import from {} in the Photo Trips tray menu to see what's new.",
            device.name
        ))
        .show();
    if let Err(err) = shown {
        log::warn!("Couldn't show the import notification: {err}");
    }
}

/// Removable drives with a DCIM folder, the layout every camera and phone card uses.
#[cfg(windows)]
fn drives() -> Vec<Device> {
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};
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
            let read = unsafe { GetVolumeInformationW(&wide, Some(&mut label), None, None, None, None) };
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
