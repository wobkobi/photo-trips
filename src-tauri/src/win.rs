// Small helpers shared by the Windows shell callers (thumbnails, property store).

use std::path::Path;

use windows::core::HSTRING;

/// Path in the form the shell's parsing-name APIs accept. They reject forward slashes with
/// E_INVALIDARG, and Rust happily builds mixed-slash paths (`C:\lib/2024/a.jpg`).
pub fn parsing_name(path: &Path) -> HSTRING {
    HSTRING::from(path.to_string_lossy().replace('/', "\\"))
}

/// Put files on the clipboard as Explorer's Copy does, so they paste into a folder, an email or
/// a chat. The clipboard takes a `DROPFILES` header followed by each path as UTF-16 with its own
/// NUL, and one more NUL to end the list.
pub fn copy_files(paths: &[std::path::PathBuf]) -> crate::error::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::DROPFILES;

    let mut wide: Vec<u16> = Vec::new();
    for path in paths {
        wide.extend(path.as_os_str().encode_wide());
        wide.push(0);
    }
    wide.push(0);
    let header = size_of::<DROPFILES>();
    let busy = |_| crate::error::Error::msg("Another app is using the clipboard. Try again.");

    // SAFETY: the block is allocated with room for the header and every path, written only while
    // locked, and handed to the clipboard (which then owns it) or freed when that fails.
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, header + wide.len() * 2)
            .map_err(|err| crate::error::Error::msg(format!("Couldn't copy: {err}")))?;
        let base = GlobalLock(memory).cast::<u8>();
        if base.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err(crate::error::Error::msg("Couldn't copy: out of memory"));
        }
        let drop = base.cast::<DROPFILES>();
        (*drop).pFiles = header as u32;
        (*drop).fWide = true.into();
        std::ptr::copy_nonoverlapping(wide.as_ptr().cast::<u8>(), base.add(header), wide.len() * 2);
        // Reports an error once the lock count reaches zero, which is the expected outcome here.
        let _ = GlobalUnlock(memory);

        if let Err(err) = OpenClipboard(None) {
            let _ = GlobalFree(Some(memory));
            return Err(busy(err));
        }
        let placed = EmptyClipboard()
            .and_then(|()| SetClipboardData(u32::from(CF_HDROP.0), Some(HANDLE(memory.0))));
        let _ = CloseClipboard();
        if let Err(err) = placed {
            let _ = GlobalFree(Some(memory));
            return Err(busy(err));
        }
    }
    Ok(())
}

/// Turn off WebView2's browser shortcuts in the main window: Ctrl+F and F3 find, Ctrl+P print,
/// Ctrl+R and F5 reload, Ctrl+G, Ctrl+U, F7 caret browsing and the rest of the browser's own
/// keys (`AreBrowserAcceleratorKeysEnabled`). Editing keys (Ctrl+C, V, X, A, Z, Home, End) stay,
/// and the page still sees every key press, so its own shortcuts (src/lib/menu.ts) keep working.
///
/// WebView2 applies a settings change made after `NavigationStarting` only from the next
/// top-level navigation, and the page navigates once for the app's life. Calling this first in
/// setup, before this thread handles any window messages, gets the change in before the host has
/// answered that first `NavigationStarting`.
///
/// Release builds only, so dev builds keep F12 and Ctrl+Shift+I for DevTools.
#[cfg(not(debug_assertions))]
pub fn disable_browser_keys(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let queued = window.with_webview(|webview| {
        // SAFETY: plain COM calls on the controller Tauri hands over, run on the UI thread that
        // owns it.
        let off = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.Settings())
                .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
                .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false))
        };
        if let Err(err) = off {
            log::warn!("Couldn't turn off the browser's shortcut keys: {err}");
        }
    });
    if let Err(err) = queued {
        log::warn!("Couldn't reach the window to turn off its browser keys: {err}");
    }
}
