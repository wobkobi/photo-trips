// Restarts the app once when its window's page never loads. Software that hooks into other
// programs, such as RivaTuner's overlay, can crash WebView2 as it starts and leave a black
// window; a fresh start usually gets past it. A marker file stops a second restart, so a PC
// where the page can never load doesn't restart forever.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager, State};

/// How long the page gets to load before the app counts it as stuck. Generous, because a
/// login start on a slow PC can take a while to bring WebView2 up.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Written just before a restart, and removed once a page loads.
const MARKER: &str = "blank-window-restart";

/// Set once the page has called [`frontend_ready`]. Managed on the builder, since the window
/// and its page are created before setup runs.
#[derive(Default)]
pub struct PageReady(AtomicBool);

/// What to do when the page still hasn't loaded after [`TIMEOUT`].
#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    /// It loaded in time.
    Fine,
    /// First failure: restart and try again.
    Restart,
    /// It failed after a restart too, so stay up rather than restart in a loop.
    GiveUp,
}

/// The page has loaded, so the window works.
#[tauri::command]
pub fn frontend_ready(app: AppHandle, ready: State<'_, PageReady>) {
    ready.0.store(true, Ordering::Relaxed);
    if let Ok(dir) = app.path().app_local_data_dir() {
        let _ = std::fs::remove_file(dir.join(MARKER));
    }
}

/// Start the timer. Runs whether or not the window is showing: a hidden window loads its page
/// too, and a broken one would otherwise only show up when opened from the tray.
pub fn start(app: &AppHandle, data_dir: &Path) {
    let app = app.clone();
    let data_dir = data_dir.to_path_buf();
    std::thread::spawn(move || {
        std::thread::sleep(TIMEOUT);
        let ready = app.state::<PageReady>().0.load(Ordering::Relaxed);
        match on_timeout(ready, &data_dir) {
            Outcome::Fine => {}
            Outcome::Restart => {
                log::warn!(
                    "The window's page didn't load within {}s, so Pic Cabinet is restarting. \
                     Overlay or screen-recording software hooking into WebView2 can cause this.",
                    TIMEOUT.as_secs()
                );
                app.request_restart();
            }
            Outcome::GiveUp => log::error!(
                "The window's page still didn't load after a restart. Overlay or \
                 screen-recording software (such as RivaTuner) may be blocking WebView2."
            ),
        }
    });
}

/// Decide what a timeout means, and leave the marker ready for the next start.
fn on_timeout(ready: bool, data_dir: &Path) -> Outcome {
    let marker = data_dir.join(MARKER);
    if ready {
        return Outcome::Fine;
    }
    if marker.exists() {
        // Cleared so a later start, perhaps after the cause is fixed, gets its one restart back.
        let _ = std::fs::remove_file(&marker);
        return Outcome::GiveUp;
    }
    match std::fs::write(&marker, b"") {
        Ok(()) => Outcome::Restart,
        // Without the marker the next start couldn't tell it had been restarted, so don't risk a loop.
        Err(err) => {
            log::error!("Couldn't write the restart marker: {err}");
            Outcome::GiveUp
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_that_loads_needs_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(on_timeout(true, dir.path()), Outcome::Fine);
        assert!(!dir.path().join(MARKER).exists());
    }

    #[test]
    fn a_blank_window_restarts_once_then_gives_up() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(on_timeout(false, dir.path()), Outcome::Restart);
        assert!(dir.path().join(MARKER).exists());
        assert_eq!(on_timeout(false, dir.path()), Outcome::GiveUp);
        // The next start after giving up gets its restart back.
        assert_eq!(on_timeout(false, dir.path()), Outcome::Restart);
    }

    #[test]
    fn a_missing_data_folder_never_restarts() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("missing");
        assert_eq!(on_timeout(false, &gone), Outcome::GiveUp);
    }
}
