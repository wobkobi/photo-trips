// The name of the app Windows opens a file type with, so a button can say "Open in VLC media
// player" rather than a vague "Open with Windows".

use std::path::Path;

use windows::Win32::UI::Shell::{
    ASSOCF_NONE, ASSOCSTR, ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME, AssocQueryStringW,
};
use windows::core::{HSTRING, PWSTR, w};

/// The default app's display name for files ending in `ext` ("jpg" or ".jpg"), or `None` when
/// Windows has no default and would ask which app to use.
#[tauri::command]
pub fn default_app(ext: String) -> Option<String> {
    let ext = ext.trim_start_matches('.');
    // Only a plain extension, so nothing else can be looked up through this.
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let assoc = HSTRING::from(format!(".{ext}"));
    // With no default, Windows names its "Pick an application" dialog (in the PC's language),
    // and that runs as OpenWith.exe. A Store app such as Photos has no executable path, so a
    // failed lookup here doesn't mean there's no default.
    let asks = query(&assoc, ASSOCSTR_EXECUTABLE).is_some_and(|exe| {
        Path::new(&exe)
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("openwith.exe"))
    });
    if asks {
        return None;
    }
    query(&assoc, ASSOCSTR_FRIENDLYAPPNAME).filter(|name| !name.trim().is_empty())
}

/// One association string for the "open" verb. The verb is named because an app such as VLC
/// sets a different default verb ("PlayWithVLC"), and asking without one then finds nothing,
/// though double-clicking still opens the file in that app.
fn query(assoc: &HSTRING, what: ASSOCSTR) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: `buf` outlives the call and `len` holds its size in characters, as the API needs.
    let hr = unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            what,
            assoc,
            w!("open"),
            Some(PWSTR(buf.as_mut_ptr())),
            &mut len,
        )
    };
    if hr.is_err() {
        return None;
    }
    // Read up to the terminating NUL; `len` counts it, so it's one past the text.
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..end]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_common_type_has_a_named_app() {
        // Every Windows install opens .txt files with something (Notepad by default).
        let name = default_app("txt".into()).expect("an app for .txt");
        assert!(!name.trim().is_empty());
        assert_eq!(default_app(".txt".into()), Some(name));
    }

    #[test]
    fn an_unknown_type_or_odd_input_has_none() {
        assert_eq!(default_app("picabinettest".into()), None);
        assert_eq!(default_app(String::new()), None);
        assert_eq!(default_app("jpg\\..\\x".into()), None);
    }
}
