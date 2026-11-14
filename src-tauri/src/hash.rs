// File content hashing (blake3), used to check copies before an original is removed.

use std::fs::File;
use std::path::Path;

use crate::error::Result;

/// blake3 hash of a file's contents, as lowercase hex.
pub fn file(path: &Path) -> Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(File::open(path)?)?;
    Ok(hasher.finalize().to_hex().to_string())
}
