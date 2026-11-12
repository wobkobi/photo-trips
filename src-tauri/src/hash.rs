// File content hashing (blake3): duplicate checks, and checking a copy before it counts.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::SystemTime;

use rayon::prelude::*;

use crate::error::Result;
use crate::index::Report;

/// Read size for [`copy`]: big enough that a phone or card reader streams at full speed.
const COPY_CHUNK: usize = 1 << 20;

/// blake3 hash of a file's contents, as lowercase hex.
pub fn file(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(File::open(path)?)?;
    Ok(hasher.finalize().to_hex().to_string())
}

/// Hash `paths` in parallel, reporting under `stage`. A file that can't be read is logged and
/// gets `None`, as does every file left when `cancel` is set; the caller checks the flag, so
/// the hashes read before a cancel can still be kept.
pub fn many(
    paths: &[PathBuf],
    stage: &str,
    cancel: &AtomicBool,
    report: Report,
) -> Vec<Option<String>> {
    let total = paths.len();
    let done = AtomicUsize::new(0);
    report(stage, 0, total);
    paths
        .par_iter()
        .map(|path| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let found = file(path);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n.is_multiple_of(20) || n == total {
                report(stage, n, total);
            }
            found
                .inspect_err(|err| log::warn!("Couldn't read {}: {err}", path.display()))
                .ok()
        })
        .collect()
}

/// Copy `from` to the new file `to`, hashing the bytes as they pass so the source is read only
/// once (a card is the slow side). The copy keeps the source's modified time. Fails rather than
/// replace an existing `to`. Returns the source's hash.
pub fn copy(from: &Path, to: &Path) -> Result<String> {
    let source = File::open(from)?;
    let modified = source.metadata()?.modified().ok();
    copy_from(source, to, modified)
}

/// [`copy`] from any reader (a phone's file stream). The copy is flushed to disk and, when
/// `modified` is given, takes that modified time.
pub fn copy_from(mut source: impl Read, to: &Path, modified: Option<SystemTime>) -> Result<String> {
    let mut target = OpenOptions::new().write(true).create_new(true).open(to)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = vec![0; COPY_CHUNK];
    loop {
        let n = match source.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err.into()),
        };
        hasher.update(&buf[..n]);
        target.write_all(&buf[..n])?;
    }
    target.sync_all()?;
    if let Some(time) = modified {
        target.set_modified(time)?;
    }
    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn copy_hashes_the_source_and_keeps_its_modified_time() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a.jpg");
        let to = dir.path().join("b.jpg");
        fs::write(&from, vec![7u8; COPY_CHUNK + 5]).unwrap();
        let old = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
        File::options().write(true).open(&from).unwrap().set_modified(old).unwrap();

        let hash = copy(&from, &to).unwrap();
        assert_eq!(hash, file(&from).unwrap());
        assert_eq!(file(&to).unwrap(), hash);
        assert_eq!(fs::metadata(&to).unwrap().modified().unwrap(), old);
        assert!(copy(&from, &to).is_err(), "an existing file is never replaced");
    }

    #[test]
    fn many_gives_none_for_unreadable_files() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a");
        fs::write(&a, "x").unwrap();
        let paths = [a.clone(), dir.path().join("missing")];
        let hashes = many(&paths, "Hashing", &AtomicBool::new(false), &|_, _, _| {});
        assert_eq!(hashes, [Some(file(&a).unwrap()), None]);
    }
}
