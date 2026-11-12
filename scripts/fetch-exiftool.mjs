// Download the pinned ExifTool Windows build into src-tauri/resources/exiftool/ so it can be
// bundled with the app. Skips the download when the pinned version is already in place.
// Runs from the predev / prebuild npm scripts; safe to run by hand.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const VERSION = "13.63";
// SHA2-256 published at https://exiftool.org/checksums.txt
const SHA256 = "7a4bff4b1d6ee15adef882837847f76c0ed23228d294feed285939b6c9b293bd";
const ZIP = `exiftool-${VERSION}_64.zip`;
// exiftool.org only hosts the newest release; SourceForge keeps every version.
const URLS = [
  `https://exiftool.org/${ZIP}`,
  `https://sourceforge.net/projects/exiftool/files/${ZIP}/download`,
];

const target = resolve(import.meta.dirname, "../src-tauri/resources/exiftool");
const marker = join(target, "VERSION");

if (process.platform !== "win32") {
  console.log("fetch-exiftool: not on Windows, skipping");
  process.exit(0);
}
if (existsSync(marker) && readFileSync(marker, "utf8").trim() === VERSION) {
  process.exit(0);
}

/**
 * Download the zip from the first mirror that answers with the expected checksum.
 * @returns {Promise<Buffer>} the verified zip bytes
 */
async function download() {
  for (const url of URLS) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const sum = createHash("sha256").update(bytes).digest("hex");
      if (sum !== SHA256) throw new Error(`checksum mismatch (${sum})`);
      return bytes;
    } catch (err) {
      console.warn(`fetch-exiftool: ${url} failed: ${err.message}`);
    }
  }
  throw new Error("fetch-exiftool: no mirror produced a verified download");
}

const bytes = await download();
const work = join(tmpdir(), `exiftool-${VERSION}-${process.pid}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const zipPath = join(work, ZIP);
writeFileSync(zipPath, bytes);

// Windows' own bsdtar reads zip files; Git Bash's GNU tar on PATH does not.
const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
execFileSync(tar, ["-xf", zipPath, "-C", work]);

const unpacked = join(work, `exiftool-${VERSION}_64`);
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// The "(-k)" in the shipped name makes ExifTool wait for a key press; the plain name doesn't.
renameSync(join(unpacked, "exiftool(-k).exe"), join(target, "exiftool.exe"));
renameSync(join(unpacked, "exiftool_files"), join(target, "exiftool_files"));
writeFileSync(marker, `${VERSION}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`fetch-exiftool: ExifTool ${VERSION} ready in ${target}`);
