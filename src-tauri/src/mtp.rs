// Phones and cameras connected by USB, through Windows Portable Devices (MTP and PTP). Their
// files can't be opened in place like a card's, so each one is streamed to a local file.
// Every call must stay on one thread: the COM objects behind a device can't cross threads.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use winmtp::PortableDevices::{WPD_OBJECT_DATE_CREATED, WPD_OBJECT_DATE_MODIFIED, WPD_OBJECT_SIZE};
use winmtp::Provider;
use winmtp::device::{Content, Device};
use winmtp::object::{Object, ObjectType};

use crate::error::{Error, Result};
use crate::formats::FormatTable;
use crate::hash;
use crate::index::Report;

/// A phone or camera Windows can see.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceInfo {
    /// Windows' id for the device, stable while it stays plugged in.
    pub id: String,
    pub name: String,
}

/// Start talking to Windows Portable Devices on this thread.
pub fn provider() -> Result<Provider> {
    Provider::new().map_err(|err| Error::msg(format!("Windows can't list phones: {err}")))
}

/// Connected phones and cameras. USB drives also show up as portable devices (through the WPD
/// bus enumerator), so those are left out; they are listed as drives instead.
pub fn list(provider: &Provider) -> Vec<DeviceInfo> {
    let Ok(devices) = provider.enumerate_devices() else {
        return Vec::new();
    };
    devices
        .into_iter()
        .filter(|d| !d.device_id().to_lowercase().contains("wpdbusenum"))
        .map(|d| DeviceInfo {
            id: d.device_id(),
            name: d.friendly_name().to_owned(),
        })
        .collect()
}

/// An open phone or camera.
pub struct Phone {
    content: Content,
    /// Kept open for as long as `content` is read.
    _device: Device,
    pub name: String,
}

/// One photo, video or sidecar on a phone.
pub struct PhoneFile {
    object: Object,
    /// Path on the phone, e.g. `Internal Storage\DCIM\100APPLE\IMG_0001.HEIC`.
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

/// Open the phone with Windows id `id`.
pub fn open(provider: &Provider, id: &str, name: &str) -> Result<Phone> {
    let gone = || Error::msg(format!("{name} is no longer connected. Plug it in and try again."));
    let device = provider
        .enumerate_devices()
        .map_err(|_| gone())?
        .into_iter()
        .find(|d| d.device_id() == id)
        .ok_or_else(gone)?;
    let app = winmtp::make_current_app_identifiers!();
    // winmtp panics instead of returning an error when the device refuses, which is what a
    // locked phone, or an iPhone that hasn't trusted this PC yet, does.
    let opened = catch_unwind(AssertUnwindSafe(|| device.open(&app, false)));
    let Ok(Ok(device)) = opened else {
        return Err(Error::msg(format!(
            "{name} didn't allow access. Unlock it (on an iPhone, tap Trust), then try again."
        )));
    };
    let content = device
        .content()
        .map_err(|err| Error::msg(format!("Couldn't read {name}: {err}")))?;
    Ok(Phone {
        content,
        _device: device,
        name: name.to_owned(),
    })
}

impl Phone {
    /// Every file `table` recognises under the DCIM folder of each of the phone's storages.
    pub fn list(&self, table: &FormatTable, cancel: &AtomicBool, report: Report) -> Result<Vec<PhoneFile>> {
        let mut files = Vec::new();
        let storages = self
            .content
            .functional_objects()
            .map_err(|err| Error::msg(format!("Couldn't read {}: {err}", self.name)))?;
        for storage in storages {
            let Ok(dcim) = storage.object_by_path(Path::new("DCIM")) else {
                continue;
            };
            let base = PathBuf::from(name_of(&storage)).join("DCIM");
            self.walk(&dcim, &base, table, cancel, report, &mut files)?;
        }
        Ok(files)
    }

    fn walk(
        &self,
        folder: &Object,
        path: &Path,
        table: &FormatTable,
        cancel: &AtomicBool,
        report: Report,
        files: &mut Vec<PhoneFile>,
    ) -> Result<()> {
        let children = folder
            .children()
            .map_err(|err| Error::msg(format!("Couldn't read {}: {err}", self.name)))?;
        for child in children {
            if cancel.load(Ordering::Relaxed) {
                return Err(Error::msg("Cancelled"));
            }
            let child_path = path.join(name_of(&child));
            if child.object_type() == ObjectType::Folder {
                self.walk(&child, &child_path, table, cancel, report, files)?;
                continue;
            }
            if !child.object_type().is_file_like() || table.kind_of(&child_path).is_none() {
                continue;
            }
            let props = child.properties(&[
                WPD_OBJECT_SIZE,
                WPD_OBJECT_DATE_MODIFIED,
                WPD_OBJECT_DATE_CREATED,
            ]);
            let (size, modified) = match props {
                Ok(p) => (
                    p.get_u64(&WPD_OBJECT_SIZE).unwrap_or(0),
                    p.get_date(&WPD_OBJECT_DATE_MODIFIED)
                        .or_else(|_| p.get_date(&WPD_OBJECT_DATE_CREATED))
                        .ok(),
                ),
                Err(_) => (0, None),
            };
            files.push(PhoneFile {
                object: child,
                path: child_path,
                size,
                modified,
            });
            if files.len().is_multiple_of(50) {
                report(&format!("Looking for photos on {}", self.name), files.len(), 0);
            }
        }
        Ok(())
    }

    /// Copy one file off the phone to the new file `to`, with the phone's modified time.
    /// Returns its hash.
    pub fn download(&self, file: &PhoneFile, to: &Path) -> Result<String> {
        let stream = file.object.open_read_stream().map_err(|err| {
            Error::msg(format!(
                "Couldn't read {} from {}: {err}",
                file.path.display(),
                self.name
            ))
        })?;
        hash::copy_from(stream, to, file.modified)
    }
}

/// The object's file name: the original name when the device keeps one (an iPhone shows
/// `IMG_0001` but keeps `IMG_0001.HEIC`), otherwise its display name.
fn name_of(object: &Object) -> String {
    object
        .original_file_name()
        .unwrap_or(object.name())
        .to_string_lossy()
}
