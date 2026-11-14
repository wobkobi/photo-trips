// Build a signed installer for the version in package.json and publish it, with latest.json, as
// a release on the public releases repo. Installed copies find it on their next update check.
//
//   npm run release             build, then publish
//   npm run release -- --dry-run  build and stage the files, without publishing
//
// Signing uses the private key at ~/.tauri/photo-trips-updater.key (or the path in
// PHOTO_TRIPS_UPDATER_KEY). It never goes in the repo: anyone holding it can ship an update.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import {
  RELEASES_REPO,
  assetName,
  assetUrl,
  changelogSection,
  manifest,
} from "./release-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");

/**
 * Stop with a message.
 * @param {string} message - what went wrong and what to do about it
 */
function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/**
 * Run a command and return its output, or null when it fails.
 * @param {string} cmd - program
 * @param {string[]} args - arguments
 * @param {object} [options] - extra spawnSync options
 * @returns {string | null} trimmed stdout
 */
function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...options });
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const tag = `v${version}`;

// Preflight: a release must match a commit, have notes, and not exist yet.
if (!dryRun && run("git", ["status", "--porcelain"]) !== "") {
  fail("the working tree has uncommitted changes. Commit them first.");
}
const notes = changelogSection(readFileSync(join(root, "CHANGELOG.md"), "utf8"), version);
if (!notes) fail(`CHANGELOG.md has no section for ${version}.`);
if (!dryRun && run("gh", ["release", "view", tag, "--repo", RELEASES_REPO]) !== null) {
  fail(`${tag} is already published on ${RELEASES_REPO}. Bump the version first.`);
}
const keyPath = process.env.PHOTO_TRIPS_UPDATER_KEY ?? join(homedir(), ".tauri", "photo-trips-updater.key");
if (!existsSync(keyPath)) fail(`no signing key at ${keyPath}.`);

// Build with updater artifacts on, which also signs the installer.
const configPath = join(root, "src-tauri", "target", "release-config.json");
mkdirSync(join(root, "src-tauri", "target"), { recursive: true });
writeFileSync(configPath, JSON.stringify({ bundle: { createUpdaterArtifacts: true } }));
console.log(`release: building Photo Trips ${version}`);
const cli = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const build = spawnSync(process.execPath, [cli, "build", "--config", configPath], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: readFileSync(keyPath, "utf8").trim(),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});
rmSync(configPath, { force: true });
if (build.status !== 0) fail("the build failed.");

// Stage the installer under a name without spaces, beside its manifest.
const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const built = join(bundle, `Photo Trips_${version}_x64-setup.exe`);
if (!existsSync(built) || !existsSync(`${built}.sig`)) fail(`the build left no signed ${built}.`);
const stage = join(root, "src-tauri", "target", "release", "publish", version);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const name = assetName(version);
const installer = join(stage, name);
copyFileSync(built, installer);
const latest = join(stage, "latest.json");
const announce = manifest({
  version,
  notes,
  signature: readFileSync(`${built}.sig`, "utf8"),
  url: assetUrl(version, name),
  date: new Date(),
});
writeFileSync(latest, `${JSON.stringify(announce, null, 2)}\n`);
const notesFile = join(stage, "notes.md");
writeFileSync(notesFile, `${notes}\n`);

if (dryRun) {
  console.log(`release: dry run, nothing published. Files are in ${stage}`);
  process.exit(0);
}

const published = spawnSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--repo",
    RELEASES_REPO,
    "--title",
    `Photo Trips ${version}`,
    "--notes-file",
    notesFile,
    "--latest",
    installer,
    latest,
  ],
  { cwd: root, stdio: "inherit" },
);
if (published.status !== 0) fail("publishing failed. Nothing was released if gh said so; check the releases page.");

// What installed copies will read on their next check.
const check = await fetch(`https://github.com/${RELEASES_REPO}/releases/latest/download/latest.json`);
const live = check.ok ? await check.json() : null;
if (live?.version !== version) {
  fail(`published, but the latest release reads ${live?.version ?? `HTTP ${check.status}`}.`);
}
console.log(`release: published Photo Trips ${version}. Installed copies will offer it within a day.`);
