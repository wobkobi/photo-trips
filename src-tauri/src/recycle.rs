// The Windows Recycle Bin: sending a file there and bringing it back. Tests swap in a fake bin
// (a temp folder), so running them never touches the real one.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::planner::same_path;

#[cfg(test)]
use fake as backend;
#[cfg(not(test))]
use system as backend;

/// Send one file to the Recycle Bin. Windows is told never to delete outright: a file the bin
/// can't take (a drive without a bin, a file too big for it) is refused and stays where it is.
pub fn to_bin(path: &Path) -> Result<()> {
    backend::delete(path)?;
    // Belt and braces: the shell has reported success for items it skipped in the past.
    if exists(path) {
        return Err(Error::msg("Windows left it where it was"));
    }
    Ok(())
}

/// The Recycle Bin's contents, read once and shared by every restore in an undo, since
/// listing a full bin takes a while.
#[derive(Default)]
pub struct Bin {
    items: Option<Vec<backend::Item>>,
}

impl Bin {
    /// Bring back the newest bin item that came from `path`, skipping any whose size doesn't
    /// match `size` (another file deleted from the same place later). The folder it was in is
    /// recreated if a clean-up removed it.
    pub fn restore(&mut self, path: &Path, size: Option<u64>) -> Result<()> {
        let items = match &mut self.items {
            Some(items) => items,
            None => self.items.insert(backend::list()?),
        };
        let found = items
            .iter()
            .enumerate()
            .filter(|(_, item)| same_path(&backend::original_path(item), path))
            .filter(|(_, item)| {
                size.is_none_or(|want| backend::size(item).is_none_or(|got| got == want))
            })
            .max_by_key(|(_, item)| backend::deleted(item))
            .map(|(i, _)| i)
            .ok_or_else(|| Error::msg("It is no longer in the Recycle Bin"))?;
        let item = items.swap_remove(found);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        backend::restore(item)?;
        // A restore with no UI skips an item it can't place instead of failing.
        if !exists(path) {
            return Err(Error::msg(
                "Windows couldn't take it out of the Recycle Bin",
            ));
        }
        Ok(())
    }
}

/// True when anything (file, folder or broken link) has this path.
fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// The real Recycle Bin, through the `trash` crate.
mod system {
    use super::*;

    pub type Item = trash::TrashItem;

    pub fn delete(path: &Path) -> Result<()> {
        trash::delete(path).map_err(describe)
    }

    pub fn list() -> Result<Vec<Item>> {
        trash::os_limited::list().map_err(describe)
    }

    pub fn original_path(item: &Item) -> PathBuf {
        item.original_path()
    }

    pub fn deleted(item: &Item) -> i64 {
        item.time_deleted
    }

    pub fn size(item: &Item) -> Option<u64> {
        trash::os_limited::metadata(item).ok()?.size.size()
    }

    pub fn restore(item: Item) -> Result<()> {
        trash::os_limited::restore_all([item]).map_err(describe)
    }

    /// The reason in a shell failure, which reads "windows error: <path>: <reason> (0x...)".
    /// Anything else keeps the crate's own wording.
    fn describe(err: trash::Error) -> Error {
        let text = match &err {
            trash::Error::Os { description, .. } => description
                .rsplit_once(": ")
                .map(|(_, reason)| reason)
                .and_then(|reason| reason.rsplit_once(" (0x").map(|(r, _)| r))
                .map(capitalise)
                .unwrap_or_else(|| description.clone()),
            trash::Error::RestoreCollision { path, .. } => {
                format!("{} is already there", path.display())
            }
            other => other.to_string(),
        };
        Error::msg(text)
    }

    fn capitalise(text: &str) -> String {
        let mut chars = text.chars();
        match chars.next() {
            Some(first) => first.to_uppercase().chain(chars).collect(),
            None => String::new(),
        }
    }
}

/// A stand-in bin for tests: files move into a shared temp folder and come back from it.
/// Tests run in parallel, but each uses its own library folder, so their paths never mix.
#[cfg(test)]
pub mod fake {
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::{Mutex, OnceLock};

    use super::*;

    #[derive(Debug, Clone)]
    pub struct Item {
        original: PathBuf,
        stored: PathBuf,
        deleted: i64,
    }

    struct State {
        dir: tempfile::TempDir,
        items: Mutex<Vec<Item>>,
    }

    static STATE: OnceLock<State> = OnceLock::new();
    static NEXT: AtomicI64 = AtomicI64::new(1);

    fn state() -> &'static State {
        STATE.get_or_init(|| State {
            dir: tempfile::tempdir().unwrap(),
            items: Mutex::new(Vec::new()),
        })
    }

    pub fn delete(path: &Path) -> Result<()> {
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let stored = state().dir.path().join(n.to_string());
        fs::rename(path, &stored)?;
        state().items.lock().unwrap().push(Item {
            original: path.to_path_buf(),
            stored,
            deleted: n,
        });
        Ok(())
    }

    pub fn list() -> Result<Vec<Item>> {
        Ok(state().items.lock().unwrap().clone())
    }

    pub fn original_path(item: &Item) -> PathBuf {
        item.original.clone()
    }

    pub fn deleted(item: &Item) -> i64 {
        item.deleted
    }

    pub fn size(item: &Item) -> Option<u64> {
        fs::metadata(&item.stored).ok().map(|m| m.len())
    }

    pub fn restore(item: Item) -> Result<()> {
        if exists(&item.original) {
            return Err(Error::msg(format!(
                "{} is already there",
                item.original.display()
            )));
        }
        fs::rename(&item.stored, &item.original)?;
        state()
            .items
            .lock()
            .unwrap()
            .retain(|i| i.stored != item.stored);
        Ok(())
    }

    /// True when a file from `path` is waiting in the fake bin.
    pub fn holds(path: &Path) -> bool {
        state()
            .items
            .lock()
            .unwrap()
            .iter()
            .any(|i| same_path(&i.original, path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_binned_file_comes_back_to_a_folder_that_was_removed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("in\\IMG_1.jpg");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "photo").unwrap();

        to_bin(&path).unwrap();
        assert!(!path.exists() && fake::holds(&path));
        fs::remove_dir(path.parent().unwrap()).unwrap();

        Bin::default().restore(&path, Some(5)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "photo");
        assert!(!fake::holds(&path));
    }

    #[test]
    fn restore_picks_the_newest_item_of_the_right_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("IMG_1.jpg");
        for text in ["first", "second", "a later file"] {
            fs::write(&path, text).unwrap();
            to_bin(&path).unwrap();
        }
        // "second" and "a later file" are both newer than "first"; only "second" is 6 bytes.
        Bin::default().restore(&path, Some(6)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
    }

    #[test]
    fn restore_refuses_when_nothing_matches() {
        let dir = tempfile::tempdir().unwrap();
        let err = Bin::default()
            .restore(&dir.path().join("never-binned.jpg"), None)
            .unwrap_err();
        assert!(err.to_string().contains("no longer in the Recycle Bin"));
    }

    /// Round trip through the real Recycle Bin. Ignored so a normal test run never touches it;
    /// run it by hand with `cargo test -- --ignored real_bin`.
    #[test]
    #[ignore]
    fn real_bin_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join(format!("phototrips-bin-test-{}.txt", std::process::id()));
        fs::write(&path, "bin test").unwrap();
        system::delete(&path).unwrap();
        assert!(!path.exists());
        let item = system::list()
            .unwrap()
            .into_iter()
            .filter(|i| same_path(&system::original_path(i), &path))
            .max_by_key(system::deleted)
            .expect("the file should be in the Recycle Bin");
        assert_eq!(system::size(&item), Some(8));
        system::restore(item).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "bin test");
    }
}
