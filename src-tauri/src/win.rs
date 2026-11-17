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
