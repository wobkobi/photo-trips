// Pure helpers for release.mjs: the release notes from CHANGELOG.md and the latest.json the
// app's updater reads.

/** The repo whose GitHub releases host the installers and latest.json. */
export const RELEASES_REPO = "wobkobi/photo-trips";

/**
 * Installer name on the release. GitHub turns spaces in asset names into dots, so the name
 * the bundler gives ("Photo Trips_...") is replaced with one that has none.
 * @param {string} version - app version, e.g. "0.11.0"
 * @returns the asset file name
 */
export function assetName(version) {
  return `Photo-Trips_${version}_x64-setup.exe`;
}

/**
 * A version's section of the changelog, without its "## [x.y.z]" heading. Bullets wrapped over
 * several lines are joined into one line each.
 * @param {string} changelog - CHANGELOG.md text
 * @param {string} version - version to find
 * @returns the notes, or null when the changelog has no section for that version
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const body = end === -1 ? rest : rest.slice(0, end);

  const out = [];
  for (const line of body) {
    // An indented line under a bullet continues it.
    if (/^\s+\S/.test(line) && out.length > 0 && /^[-*]\s/.test(out[out.length - 1])) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else {
      out.push(line.trimEnd());
    }
  }
  const notes = out.join("\n").trim();
  return notes || null;
}

/**
 * The update manifest the app fetches from the latest release.
 * @param {object} release - what to announce
 * @param {string} release.version - the new version
 * @param {string} release.notes - its release notes
 * @param {string} release.signature - contents of the installer's .sig file
 * @param {string} release.url - where the installer downloads from
 * @param {Date} release.date - publish time
 * @returns the latest.json object
 */
export function manifest({ version, notes, signature, url, date }) {
  return {
    version,
    notes,
    pub_date: date.toISOString(),
    platforms: { "windows-x86_64": { signature: signature.trim(), url } },
  };
}

/**
 * Download URL of a release asset.
 * @param {string} version - release version
 * @param {string} name - asset file name
 * @returns the URL
 */
export function assetUrl(version, name) {
  return `https://github.com/${RELEASES_REPO}/releases/download/v${version}/${name}`;
}
