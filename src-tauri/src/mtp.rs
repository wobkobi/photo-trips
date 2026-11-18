// Phones and cameras connected by USB, through Windows Portable Devices (MTP and PTP). Their
// files can't be opened in place like a card's, so each one is streamed to a local file.
// Every call must stay on one thread: the COM objects behind a device can't cross threads.

use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use windows::Win32::Devices::PortableDevices::{
    IPortableDevice, IPortableDeviceContent, IPortableDeviceKeyCollection, IPortableDeviceManager,
    IPortableDeviceProperties, IPortableDeviceValues, PortableDeviceFTM, PortableDeviceKeyCollection,
    PortableDeviceManager, PortableDeviceValues, WPD_CLIENT_DESIRED_ACCESS, WPD_CLIENT_MAJOR_VERSION,
    WPD_CLIENT_MINOR_VERSION, WPD_CLIENT_NAME, WPD_CLIENT_REVISION, WPD_CLIENT_SECURITY_QUALITY_OF_SERVICE,
    WPD_CONTENT_TYPE_AUDIO_ALBUM, WPD_CONTENT_TYPE_CONTACT_GROUP, WPD_CONTENT_TYPE_FOLDER,
    WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT, WPD_CONTENT_TYPE_IMAGE_ALBUM, WPD_CONTENT_TYPE_MIXED_CONTENT_ALBUM,
    WPD_CONTENT_TYPE_VIDEO_ALBUM, WPD_DEVICE_OBJECT_ID, WPD_OBJECT_CONTENT_TYPE, WPD_OBJECT_DATE_CREATED,
    WPD_OBJECT_DATE_MODIFIED, WPD_OBJECT_NAME, WPD_OBJECT_ORIGINAL_FILE_NAME, WPD_OBJECT_SIZE,
    WPD_RESOURCE_DEFAULT,
};
use windows::Win32::Foundation::{E_POINTER, GENERIC_READ, PROPERTYKEY, S_FALSE};
use windows::Win32::Storage::FileSystem::SECURITY_IMPERSONATION;
use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree, IStream, STGM_READ,
};
use windows::Win32::System::Variant::VT_DATE;
use windows::core::{GUID, HSTRING, PCWSTR, PWSTR};

use chrono::{DateTime, Local, TimeZone, Utc};

use crate::error::{Error, Result};
use crate::formats::FormatTable;
use crate::hash;
use crate::index::Report;
use crate::scan;

/// A phone or camera Windows can see.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceInfo {
    /// Windows' id for the device, stable while it stays plugged in.
    pub id: String,
    pub name: String,
}

/// Windows Portable Devices, set up on one thread.
pub struct Provider {
    manager: IPortableDeviceManager,
}

/// Start talking to Windows Portable Devices on this thread.
pub fn provider() -> Result<Provider> {
    // COM already set up on this thread, in either mode, works as well.
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    unsafe { CoCreateInstance(&PortableDeviceManager, None, CLSCTX_ALL) }
        .map(|manager| Provider { manager })
        .map_err(|err| Error::msg(format!("Windows can't list phones: {err}")))
}

/// Connected phones and cameras. USB drives also show up as portable devices (through the WPD
/// bus enumerator), so those are left out; they are listed as drives instead.
pub fn list(provider: &Provider) -> Vec<DeviceInfo> {
    let Ok(ids) = device_ids(&provider.manager) else {
        return Vec::new();
    };
    ids.into_iter()
        .filter(|id| !id.to_lowercase().contains("wpdbusenum"))
        .map(|id| DeviceInfo {
            name: friendly_name(&provider.manager, &id),
            id,
        })
        .collect()
}

fn device_ids(manager: &IPortableDeviceManager) -> windows::core::Result<Vec<String>> {
    unsafe {
        // The manager keeps the list from when it was made, and the device watcher holds one
        // for as long as the app runs.
        manager.RefreshDeviceList()?;
        let mut count = 0;
        manager.GetDevices(std::ptr::null_mut(), &mut count)?;
        if count == 0 {
            return Ok(Vec::new());
        }
        let mut ids = vec![PWSTR::null(); count as usize];
        manager.GetDevices(ids.as_mut_ptr(), &mut count)?;
        Ok(ids.into_iter().take(count as usize).map(|id| take(id)).collect())
    }
}

/// The device's name as Explorer shows it, e.g. "Apple iPhone".
fn friendly_name(manager: &IPortableDeviceManager, id: &str) -> String {
    let id = HSTRING::from(id);
    let id = PCWSTR(id.as_ptr());
    let mut len = 0;
    unsafe {
        if manager.GetDeviceFriendlyName(id, PWSTR::null(), &mut len).is_ok() {
            let mut name = vec![0u16; len as usize];
            if manager.GetDeviceFriendlyName(id, PWSTR(name.as_mut_ptr()), &mut len).is_ok() {
                let end = name.iter().position(|&c| c == 0).unwrap_or(name.len());
                return String::from_utf16_lossy(&name[..end]);
            }
        }
    }
    "Phone".to_owned()
}

/// A string Windows allocated, read then freed.
unsafe fn take(text: PWSTR) -> String {
    let owned = unsafe { text.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(text.0 as *const _)) };
    owned
}

/// An open phone or camera.
pub struct Phone {
    content: IPortableDeviceContent,
    properties: IPortableDeviceProperties,
    /// The details read for every object.
    keys: IPortableDeviceKeyCollection,
    /// Kept open for as long as `content` is read.
    _device: IPortableDevice,
    pub name: String,
}

/// One photo, video or sidecar on a phone.
pub struct PhoneFile {
    /// The device's id for the file, valid while the phone stays connected.
    object: HSTRING,
    /// Path on the phone, e.g. `Internal Storage\DCIM\100APPLE\IMG_0001.HEIC`.
    pub path: PathBuf,
    pub size: u64,
    pub modified: Option<SystemTime>,
}

/// One object on a device: a storage, folder or file.
#[derive(Debug)]
struct Entry {
    id: HSTRING,
    name: String,
    /// WPD content type, when the device gives one.
    kind: Option<GUID>,
    size: u64,
    modified: Option<SystemTime>,
}

impl Entry {
    fn is_storage(&self) -> bool {
        self.kind == Some(WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT)
    }

    fn is_folder(&self) -> bool {
        self.kind == Some(WPD_CONTENT_TYPE_FOLDER)
    }

    /// Albums and contact groups only list other objects, so they hold no data of their own.
    fn is_file(&self) -> bool {
        !matches!(
            self.kind,
            Some(
                WPD_CONTENT_TYPE_FOLDER
                    | WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT
                    | WPD_CONTENT_TYPE_AUDIO_ALBUM
                    | WPD_CONTENT_TYPE_IMAGE_ALBUM
                    | WPD_CONTENT_TYPE_VIDEO_ALBUM
                    | WPD_CONTENT_TYPE_MIXED_CONTENT_ALBUM
                    | WPD_CONTENT_TYPE_CONTACT_GROUP
            )
        )
    }
}

/// Open the phone with Windows id `id`.
pub fn open(provider: &Provider, id: &str, name: &str) -> Result<Phone> {
    if !list(provider).iter().any(|d| d.id == id) {
        return Err(Error::msg(format!(
            "{name} is no longer connected. Plug it in and try again."
        )));
    }
    // A locked phone, or an iPhone that hasn't trusted this PC yet, refuses to open.
    let device = open_device(id).map_err(|err| {
        log::warn!("Couldn't open {name}: {err}");
        Error::msg(format!(
            "{name} didn't allow access. Unlock it (on an iPhone, tap Trust), then try again."
        ))
    })?;
    let failed = |err: windows::core::Error| Error::msg(format!("Couldn't read {name}: {err}"));
    let content = unsafe { device.Content() }.map_err(failed)?;
    let properties = unsafe { content.Properties() }.map_err(failed)?;
    let keys = object_keys().map_err(failed)?;
    Ok(Phone {
        content,
        properties,
        keys,
        _device: device,
        name: name.to_owned(),
    })
}

/// Open a device read-only. WPD asks every app to say who it is when it opens a device.
fn open_device(id: &str) -> windows::core::Result<IPortableDevice> {
    let version = |part: &str| part.parse().unwrap_or(0);
    let app = HSTRING::from("Pic Cabinet");
    let id = HSTRING::from(id);
    unsafe {
        let client: IPortableDeviceValues = CoCreateInstance(&PortableDeviceValues, None, CLSCTX_ALL)?;
        client.SetStringValue(&WPD_CLIENT_NAME, PCWSTR(app.as_ptr()))?;
        client.SetUnsignedIntegerValue(&WPD_CLIENT_MAJOR_VERSION, version(env!("CARGO_PKG_VERSION_MAJOR")))?;
        client.SetUnsignedIntegerValue(&WPD_CLIENT_MINOR_VERSION, version(env!("CARGO_PKG_VERSION_MINOR")))?;
        client.SetUnsignedIntegerValue(&WPD_CLIENT_REVISION, version(env!("CARGO_PKG_VERSION_PATCH")))?;
        // Some drivers act as the calling user to read the device, which this allows.
        client.SetUnsignedIntegerValue(&WPD_CLIENT_SECURITY_QUALITY_OF_SERVICE, SECURITY_IMPERSONATION.0)?;
        // Nothing is ever written to a phone.
        client.SetUnsignedIntegerValue(&WPD_CLIENT_DESIRED_ACCESS, GENERIC_READ.0)?;
        let device: IPortableDevice = CoCreateInstance(&PortableDeviceFTM, None, CLSCTX_ALL)?;
        device.Open(PCWSTR(id.as_ptr()), &client)?;
        Ok(device)
    }
}

fn object_keys() -> windows::core::Result<IPortableDeviceKeyCollection> {
    unsafe {
        let keys: IPortableDeviceKeyCollection =
            CoCreateInstance(&PortableDeviceKeyCollection, None, CLSCTX_ALL)?;
        for key in [
            WPD_OBJECT_NAME,
            WPD_OBJECT_ORIGINAL_FILE_NAME,
            WPD_OBJECT_CONTENT_TYPE,
            WPD_OBJECT_SIZE,
            WPD_OBJECT_DATE_MODIFIED,
            WPD_OBJECT_DATE_CREATED,
        ] {
            keys.Add(&key)?;
        }
        Ok(keys)
    }
}

impl Phone {
    /// Every file `table` recognises in the phone's camera roll (see `camera_roll`).
    pub fn list(&self, table: &FormatTable, cancel: &AtomicBool, report: Report) -> Result<Vec<PhoneFile>> {
        let mut storages = Vec::new();
        let mut readable = false;
        for storage in self.children(WPD_DEVICE_OBJECT_ID)? {
            if !storage.is_storage() {
                continue;
            }
            let top = self.children(PCWSTR(storage.id.as_ptr()))?;
            readable |= !top.is_empty();
            let dcim = top
                .into_iter()
                .find(|e| e.is_folder() && e.name.eq_ignore_ascii_case("DCIM"));
            storages.push((storage, dcim));
        }
        // A locked phone (or one set to charge only) shows no storage, or storage with nothing
        // in it, which would otherwise pass for a phone with no new photos.
        if !readable {
            return Err(Error::msg(format!(
                "Can't see any photos on {}. Unlock it, tap Trust or Allow if it asks, then check again.",
                self.name
            )));
        }
        let mut files = Vec::new();
        for (folder, path) in camera_roll(storages) {
            self.walk(&folder, &path, table, cancel, report, &mut files)?;
        }
        Ok(files)
    }

    fn walk(
        &self,
        folder: &HSTRING,
        path: &Path,
        table: &FormatTable,
        cancel: &AtomicBool,
        report: Report,
        files: &mut Vec<PhoneFile>,
    ) -> Result<()> {
        for child in self.children(PCWSTR(folder.as_ptr()))? {
            if cancel.load(Ordering::Relaxed) {
                return Err(Error::msg("Cancelled"));
            }
            let child_path = path.join(&child.name);
            if child.is_folder() {
                if !scan::skip_folder(&child_path) {
                    self.walk(&child.id, &child_path, table, cancel, report, files)?;
                }
                continue;
            }
            if !child.is_file() || scan::file_kind(&child_path, table).is_none() {
                continue;
            }
            files.push(PhoneFile {
                object: child.id,
                path: child_path,
                size: child.size,
                modified: child.modified,
            });
            if files.len().is_multiple_of(50) {
                report(&format!("Looking for photos on {}", self.name), files.len(), 0);
            }
        }
        Ok(())
    }

    /// The objects directly inside `parent`. One whose details can't be read is left out.
    fn children(&self, parent: PCWSTR) -> Result<Vec<Entry>> {
        let failed = |err: windows::core::Error| Error::msg(format!("Couldn't read {}: {err}", self.name));
        let ids = unsafe { self.content.EnumObjects(0, parent, None) }.map_err(failed)?;
        let mut entries = Vec::new();
        loop {
            let mut batch = [PWSTR::null(); 32];
            let mut fetched = 0;
            let status = unsafe { ids.Next(&mut batch, &mut fetched) };
            // Freed before the status is checked, as a failed call may still hand some over.
            let batch: Vec<HSTRING> = batch[..(fetched as usize).min(batch.len())]
                .iter()
                .map(|&id| HSTRING::from(unsafe { take(id) }))
                .collect();
            status.ok().map_err(failed)?;
            let last = batch.is_empty() || status == S_FALSE;
            for id in batch {
                match self.entry(&id) {
                    Ok(entry) => entries.push(entry),
                    Err(err) => log::warn!("Skipped {id} on {}: {err}", self.name),
                }
            }
            if last {
                break;
            }
        }
        Ok(entries)
    }

    fn entry(&self, id: &HSTRING) -> windows::core::Result<Entry> {
        let values = unsafe { self.properties.GetValues(PCWSTR(id.as_ptr()), &self.keys) }?;
        let text = |key: &PROPERTYKEY| unsafe { values.GetStringValue(key) }.ok().map(|t| unsafe { take(t) });
        Ok(Entry {
            id: id.clone(),
            name: object_name(text(&WPD_OBJECT_ORIGINAL_FILE_NAME), text(&WPD_OBJECT_NAME), id),
            kind: unsafe { values.GetGuidValue(&WPD_OBJECT_CONTENT_TYPE) }.ok(),
            size: unsafe { values.GetUnsignedLargeIntegerValue(&WPD_OBJECT_SIZE) }.unwrap_or(0),
            modified: date(&values, &WPD_OBJECT_DATE_MODIFIED).or_else(|| date(&values, &WPD_OBJECT_DATE_CREATED)),
        })
    }

    /// Copy one file off the phone to the new file `to`, with the phone's modified time.
    /// Returns its hash.
    pub fn download(&self, file: &PhoneFile, to: &Path) -> Result<String> {
        let stream = self.stream(&file.object).map_err(|err| {
            Error::msg(format!(
                "Couldn't read {} from {}: {err}",
                file.path.display(),
                self.name
            ))
        })?;
        hash::copy_from(StreamReader(stream), to, file.modified)
    }

    fn stream(&self, object: &HSTRING) -> windows::core::Result<IStream> {
        let mut optimal_size = 0;
        let mut stream = None;
        unsafe {
            self.content.Transfer()?.GetStream(
                PCWSTR(object.as_ptr()),
                &WPD_RESOURCE_DEFAULT,
                STGM_READ.0,
                &mut optimal_size,
                &mut stream,
            )?;
        }
        stream.ok_or_else(|| E_POINTER.into())
    }
}

/// The name to file an object under: the original file name when the device keeps one,
/// otherwise its display name. An Android phone may show `IMG_0001` but keep `IMG_0001.jpg`,
/// and an iPhone gives only the original name. With neither, the object's id stands in, which
/// only a folder can use (a file needs its extension to be imported).
fn object_name(original: Option<String>, display: Option<String>, id: &HSTRING) -> String {
    original
        .filter(|n| !n.is_empty())
        .or(display.filter(|n| !n.is_empty()))
        .unwrap_or_else(|| id.to_string())
}

/// Where a phone's photos are, as (folder id, path on the phone), from each storage paired
/// with its DCIM folder. Cameras and Android phones keep photos in DCIM. An iPhone has no
/// DCIM: its month folders (`202602__`) sit straight under the storage, so when no storage
/// has DCIM, each one is read whole. A storage without DCIM next to one that has it (an
/// Android phone's SD card) isn't where the camera saves, so it's left out.
fn camera_roll(storages: Vec<(Entry, Option<Entry>)>) -> Vec<(HSTRING, PathBuf)> {
    let any_dcim = storages.iter().any(|(_, dcim)| dcim.is_some());
    storages
        .into_iter()
        .filter_map(|(storage, dcim)| match dcim {
            Some(dcim) => Some((dcim.id, Path::new(&storage.name).join(dcim.name))),
            None if !any_dcim => Some((storage.id, PathBuf::from(storage.name))),
            None => None,
        })
        .collect()
}

/// A date the device gives, read as UTC.
fn date(values: &IPortableDeviceValues, key: &PROPERTYKEY) -> Option<SystemTime> {
    let mut value = unsafe { values.GetValue(key) }.ok()?;
    let inner = unsafe { &value.Anonymous.Anonymous };
    let days = (inner.vt == VT_DATE).then(|| unsafe { inner.Anonymous.date });
    let _ = unsafe { PropVariantClear(&mut value) };
    from_ole_date(days?, &Local)
}

/// An OLE automation date: days since 30 December 1899, with the time of day as the fraction.
/// It carries no zone, and a phone gives its own wall-clock time (an iPhone photo taken at
/// 13:36 in a +13:00 zone says 13:36), so it is read as a time in `zone`. Dates before 1970
/// are taken as unset.
fn from_ole_date<Tz: TimeZone>(days: f64, zone: &Tz) -> Option<SystemTime> {
    // 25,569 days from 30 December 1899 to 1 January 1970.
    let secs = (days - 25_569.0) * 86_400.0;
    if !(secs.is_finite() && secs >= 0.0) {
        return None;
    }
    let as_utc = UNIX_EPOCH + Duration::from_secs_f64(secs);
    let wall = DateTime::<Utc>::from(as_utc).naive_utc();
    // A wall-clock time skipped by a daylight-saving change has no moment; keep it as given.
    Some(
        zone.from_local_datetime(&wall)
            .earliest()
            .map_or(as_utc, |t| t.with_timezone(&Utc).into()),
    )
}

/// A device file's stream, read like a file.
struct StreamReader(IStream);

impl Read for StreamReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut read = 0;
        let want = u32::try_from(buf.len()).unwrap_or(u32::MAX);
        unsafe { self.0.Read(buf.as_mut_ptr().cast(), want, Some(&mut read)) }
            .ok()
            .map_err(io::Error::other)?;
        Ok(read as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn entry(id: &str, name: &str, kind: GUID) -> Entry {
        Entry {
            id: HSTRING::from(id),
            name: name.to_owned(),
            kind: Some(kind),
            size: 0,
            modified: None,
        }
    }

    #[test]
    fn names_come_from_the_original_file_name_first() {
        let id = HSTRING::from("o4ED");
        // iPhone: no display name at all.
        assert_eq!(object_name(Some("IMG_2064.HEIC".into()), None, &id), "IMG_2064.HEIC");
        // Android: a display name without the extension.
        assert_eq!(object_name(Some("IMG_1.jpg".into()), Some("IMG_1".into()), &id), "IMG_1.jpg");
        assert_eq!(object_name(None, Some("DCIM".into()), &id), "DCIM");
        assert_eq!(object_name(Some(String::new()), Some("DCIM".into()), &id), "DCIM");
        assert_eq!(object_name(None, None, &id), "o4ED");
    }

    #[test]
    fn an_iphone_storage_is_read_whole() {
        let storage = entry("s10002", "Internal Storage", WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT);
        assert_eq!(
            camera_roll(vec![(storage, None)]),
            vec![(HSTRING::from("s10002"), PathBuf::from("Internal Storage"))]
        );
    }

    #[test]
    fn dcim_is_read_where_a_storage_has_it() {
        let internal = entry("s1", "Internal shared storage", WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT);
        let dcim = entry("o5", "DCIM", WPD_CONTENT_TYPE_FOLDER);
        let card = entry("s2", "SD card", WPD_CONTENT_TYPE_FUNCTIONAL_OBJECT);
        assert_eq!(
            camera_roll(vec![(internal, Some(dcim)), (card, None)]),
            vec![(HSTRING::from("o5"), Path::new("Internal shared storage").join("DCIM"))]
        );
    }

    #[test]
    fn albums_and_folders_are_not_files() {
        // WPD_CONTENT_TYPE_IMAGE, as an iPhone gives for its photos.
        let image = GUID::from_u128(0xef2107d5_a52a_4243_a26b_62d4176d7603);
        assert!(entry("o1", "IMG_1.jpg", image).is_file());
        assert!(!entry("o2", "202602__", WPD_CONTENT_TYPE_FOLDER).is_file());
        assert!(!entry("o3", "Camera", WPD_CONTENT_TYPE_IMAGE_ALBUM).is_file());
        let untyped = Entry {
            kind: None,
            ..entry("o4", "IMG_2.jpg", image)
        };
        assert!(untyped.is_file());
    }

    #[test]
    fn ole_dates_count_days_from_1899() {
        assert_eq!(from_ole_date(25_569.0, &Utc), Some(UNIX_EPOCH));
        assert_eq!(from_ole_date(25_569.5, &Utc), Some(UNIX_EPOCH + Duration::from_secs(43_200)));
        // 14 February 2026, 09:00.
        assert_eq!(
            from_ole_date(46_067.375, &Utc),
            Some(UNIX_EPOCH + Duration::from_secs(1_771_059_600))
        );
        assert_eq!(from_ole_date(1.0, &Utc), None);
        assert_eq!(from_ole_date(f64::NAN, &Utc), None);
    }

    #[test]
    fn phone_dates_are_the_phones_own_wall_clock() {
        // An iPhone photo with EXIF 2026-11-14 13:36:13 +13:00 reports 13:36:13 over MTP, which
        // is 00:36:13 UTC.
        let nz = FixedOffset::east_opt(13 * 3600).unwrap();
        let wall = 46_340.0 + (13.0 * 3600.0 + 36.0 * 60.0 + 13.0) / 86_400.0;
        let utc = chrono::NaiveDate::from_ymd_opt(2026, 11, 14)
            .unwrap()
            .and_hms_opt(0, 36, 13)
            .unwrap()
            .and_utc();
        let read = from_ole_date(wall, &nz).unwrap();
        let off = SystemTime::from(utc).duration_since(read).unwrap_or_else(|e| e.duration());
        assert!(off < Duration::from_millis(1), "{off:?} away from {utc}");
    }

    /// Reads whichever phone is plugged in without changing it: lists its photos, then copies
    /// the smallest one to a temporary folder. Run with
    /// `cargo test reads_a_connected_phone -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs an unlocked phone plugged in"]
    fn reads_a_connected_phone() {
        let provider = provider().unwrap();
        let device = list(&provider).into_iter().next().expect("no phone plugged in");
        let phone = open(&provider, &device.id, &device.name).unwrap();
        let started = std::time::Instant::now();
        let files = phone
            .list(&FormatTable::default(), &AtomicBool::new(false), &|_, found, _| {
                eprintln!("  {found} found so far")
            })
            .unwrap();
        println!("listed in {:?}", started.elapsed());
        println!("{}: {} files", device.name, files.len());
        for file in files.iter().take(5) {
            println!("  {} ({} bytes, {:?})", file.path.display(), file.size, file.modified);
        }
        let smallest = files.iter().filter(|f| f.size > 0).min_by_key(|f| f.size).expect("no files");
        let dir = tempfile::tempdir().unwrap();
        let to = dir.path().join("copy");
        let hash = phone.download(smallest, &to).unwrap();
        assert_eq!(std::fs::metadata(&to).unwrap().len(), smallest.size);
        assert_eq!(hash, hash::file(&to).unwrap());
    }
}
