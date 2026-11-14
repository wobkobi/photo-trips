// Updates from the public releases repo (see tauri.conf.json for the address).
//
// Each installer is signed with a private key kept off the repo, and tauri.conf.json carries
// the public half. The plugin refuses a download whose signature doesn't match, or whose
// signature was made for a different version than the one announced, so a tampered or replayed
// release can't be installed.
//
// The app checks shortly after it starts and then once a day, and says so once per version.
// Nothing installs without a click in Settings > About.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::AppState;
use crate::commands::lock_db;
use crate::db;
use crate::error::{Error, Result};
use crate::jobs::Jobs;
use crate::tray;

/// Sent with an [`Available`] whenever a check finds a newer version.
pub const AVAILABLE_EVENT: &str = "update://available";
/// Sent with an [`InstallProgress`] while an update downloads and installs.
pub const PROGRESS_EVENT: &str = "update://progress";

/// Long enough after starting that the startup index and device checks get going first.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(60);
const CHECK_EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// The day is measured on the wall clock, checked this often. A sleeping PC doesn't advance a
/// thread's sleep, so one 24-hour sleep could stretch over days.
const WAKE_EVERY: Duration = Duration::from_secs(60 * 60);
const EMIT_EVERY: Duration = Duration::from_millis(100);
/// The version the last notification was about, so each version is announced once.
const NOTIFIED_KEY: &str = "update_notified";

/// A newer version on offer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Available {
    pub version: String,
    /// The changelog section for that version.
    pub notes: Option<String>,
}

/// How far an install has got.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
enum InstallProgress {
    /// `total` is `None` when the server doesn't give a size.
    Downloading { done: u64, total: Option<u64> },
    /// Downloaded; the running job of this kind has to finish first.
    Waiting { kind: &'static str },
    /// The installer has been started and the app is about to close.
    Installing,
}

/// Managed state: the update found by the last check, if any.
#[derive(Default)]
pub struct Updates {
    pending: Mutex<Option<Update>>,
    last_check: Mutex<Option<SystemTime>>,
    installing: AtomicBool,
}

impl Updates {
    fn available(&self) -> Option<Available> {
        let pending = self.pending.lock().ok()?;
        pending.as_ref().map(|update| Available {
            version: update.version.clone(),
            notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        })
    }
}

/// Check in the background: once soon after starting, then daily.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("updates".into())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK_AFTER);
            loop {
                if check_due(&app) {
                    match tauri::async_runtime::block_on(check(&app)) {
                        Ok(Some(found)) => notify_once(&app, &found),
                        Ok(None) => {}
                        Err(err) => log::info!("Update check skipped: {err}"),
                    }
                }
                std::thread::sleep(WAKE_EVERY);
            }
        });
    if let Err(err) = spawned {
        log::warn!("Couldn't start update checks: {err}");
    }
}

fn check_due(app: &AppHandle) -> bool {
    let updates = app.state::<Updates>();
    let last = updates.last_check.lock().ok().and_then(|last| *last);
    is_due(last, SystemTime::now())
}

/// Whether a day has passed since `last`. A clock set back counts as due rather than waiting
/// out the difference.
fn is_due(last: Option<SystemTime>, now: SystemTime) -> bool {
    match last {
        None => true,
        Some(last) => now.duration_since(last).map_or(true, |gap| gap >= CHECK_EVERY),
    }
}

/// Ask the releases repo for a newer version, and remember the answer.
async fn check(app: &AppHandle) -> Result<Option<Available>> {
    let updates = app.state::<Updates>();
    let found = app
        .updater()
        .map_err(|err| Error::msg(err.to_string()))?
        .check()
        .await
        .map_err(|err| Error::msg(err.to_string()))?;
    if let Ok(mut last) = updates.last_check.lock() {
        *last = Some(SystemTime::now());
    }
    let version = found.as_ref().map(|update| update.version.clone());
    if let Ok(mut pending) = updates.pending.lock() {
        *pending = found;
    }
    tray::set_update(app, version.as_deref());
    let available = updates.available();
    if let Some(found) = &available {
        let _ = app.emit(AVAILABLE_EVENT, found);
    }
    Ok(available)
}

/// Say a new version is ready, unless this version has been announced before.
fn notify_once(app: &AppHandle, found: &Available) {
    let state = app.state::<AppState>();
    let Ok(conn) = lock_db(&state) else { return };
    if db::get_setting(&conn, NOTIFIED_KEY).ok().flatten().as_deref() == Some(&found.version) {
        return;
    }
    let shown = app
        .notification()
        .builder()
        .title(format!("Photo Trips {} is ready to install", found.version))
        .body("Choose Install update in the Photo Trips tray menu to see what's new.")
        .show();
    match shown {
        Ok(()) => {
            if let Err(err) = db::set_setting(&conn, NOTIFIED_KEY, &found.version) {
                log::warn!("Couldn't note the update notification: {err}");
            }
        }
        Err(err) => log::warn!("Couldn't show the update notification: {err}"),
    }
}

/// The update found by the last check, without checking again.
#[tauri::command]
pub fn update_status(app: AppHandle) -> Option<Available> {
    app.state::<Updates>().available()
}

/// Check for a newer version now.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<Available>> {
    check(&app).await.map_err(|err| {
        log::warn!("Update check failed: {err}");
        Error::msg("Couldn't reach the update server. Check the internet connection and try again.")
    })
}

/// Download the update, wait for any running task, then start the installer. The installer
/// closes the app and opens the new version, so on success this never returns.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    let updates = app.state::<Updates>();
    let update = updates
        .pending
        .lock()
        .ok()
        .and_then(|pending| pending.clone())
        .ok_or_else(|| Error::msg("Check for updates first."))?;
    if updates.installing.swap(true, Ordering::SeqCst) {
        return Err(Error::msg("The update is already installing."));
    }
    let installed = install(&app, &update).await;
    updates.installing.store(false, Ordering::SeqCst);
    installed.map_err(|err| {
        log::error!("Update to {} failed: {err}", update.version);
        Error::msg(format!(
            "Couldn't install version {}. Try again later; Help > Open log folder has the details.",
            update.version
        ))
    })
}

async fn install(app: &AppHandle, update: &Update) -> Result<()> {
    let mut done = 0u64;
    let mut last_emit = Instant::now() - EMIT_EVERY;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                if last_emit.elapsed() >= EMIT_EVERY || total == Some(done) {
                    last_emit = Instant::now();
                    let _ = app.emit(PROGRESS_EVENT, InstallProgress::Downloading { done, total });
                }
            },
            || {},
        )
        .await
        .map_err(|err| Error::msg(err.to_string()))?;

    // A sort or import cut off by the exit would be recovered at the next start, but waiting
    // for it is gentler. Once closed, no new job (an inbox import, say) can start either.
    let jobs = app.state::<Jobs>();
    loop {
        match jobs.close() {
            Ok(()) => break,
            Err(kind) => {
                let _ = app.emit(PROGRESS_EVENT, InstallProgress::Waiting { kind });
                tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_secs(1)))
                    .await
                    .map_err(|err| Error::msg(err.to_string()))?;
            }
        }
    }

    let _ = app.emit(PROGRESS_EVENT, InstallProgress::Installing);
    log::info!("Installing Photo Trips {}", update.version);
    // On Windows this starts the installer and exits the app; it only returns on failure.
    let installed = update.install(&bytes).map_err(|err| Error::msg(err.to_string()));
    jobs.reopen();
    installed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_day_must_pass_between_checks() {
        let now = SystemTime::now();
        assert!(is_due(None, now));
        assert!(!is_due(Some(now - Duration::from_secs(60 * 60)), now));
        assert!(is_due(Some(now - CHECK_EVERY), now));
        // A clock set back an hour checks rather than waiting a day and an hour.
        assert!(is_due(Some(now + Duration::from_secs(60 * 60)), now));
    }

    #[test]
    fn progress_is_tagged_by_stage() {
        let json = |p| serde_json::to_value(p).unwrap();
        assert_eq!(
            json(InstallProgress::Downloading { done: 5, total: Some(10) }),
            serde_json::json!({ "stage": "downloading", "done": 5, "total": 10 })
        );
        assert_eq!(
            json(InstallProgress::Waiting { kind: "import" }),
            serde_json::json!({ "stage": "waiting", "kind": "import" })
        );
        assert_eq!(json(InstallProgress::Installing), serde_json::json!({ "stage": "installing" }));
    }

    #[test]
    fn updates_come_signed_from_the_releases_repo() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        assert_eq!(updater["requireSignedVersion"], true);
        assert!(
            updater["endpoints"][0]
                .as_str()
                .unwrap()
                .starts_with("https://github.com/wobkobi/photo-trips-releases/")
        );
        assert!(!updater["pubkey"].as_str().unwrap().is_empty());
    }
}
