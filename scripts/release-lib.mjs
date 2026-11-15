// Pure helpers for release.mjs: the release notes from CHANGELOG.md and the latest.json the
// app's updater reads.

/** The repo whose GitHub releases host the installers and latest.json. */
export const RELEASES_REPO = "wobkobi/pic-cabinet";

/**
 * Installer name on the release. GitHub turns spaces in asset names into dots, so the name
 * the bundler gives ("Pic Cabinet_...") is replaced with one that has none.
 * @param {string} version - app version, e.g. "0.11.0"
 * @returns the asset file name
 */
export function assetName(version) {
  return `Pic-Cabinet_${version}_x64-setup.exe`;
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

/** Keep a Changelog's heading order, used when sections from several versions are merged. */
const HEADING_ORDER = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

/**
 * Compare two x.y.z versions by number.
 * @param {string} a - first version
 * @param {string} b - second version
 * @returns negative, zero or positive, as a is older than, equal to or newer than b
 */
function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

/**
 * Notes for a release: every changelog section after the last published release up to this
 * version, so changes from a version that was never released still reach installed copies.
 * Sections are merged under one heading each ("### Added", "### Fixed"), newest first.
 * @param {string} changelog - CHANGELOG.md text
 * @param {string} version - version being released
 * @param {string | null} since - last published version, or null to use this version's section alone
 * @returns the notes, or null when the changelog has no section for this version
 */
export function releaseNotes(changelog, version, since) {
  const own = changelogSection(changelog, version);
  if (!own || !since) return own;
  const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
    .map((match) => match[1])
    .filter((v) => compareVersions(v, since) > 0 && compareVersions(v, version) <= 0);
  if (versions.length <= 1) return own;

  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const v of versions) {
    let heading = "";
    for (const line of (changelogSection(changelog, v) ?? "").split("\n")) {
      if (line.startsWith("### ")) heading = line;
      else if (line.trim()) groups.set(heading, [...(groups.get(heading) ?? []), line]);
    }
  }
  /**
   * Where a heading sorts in {@link HEADING_ORDER}; any other heading, or none, goes last.
   * @param {string} heading - "### Added" and the like
   * @returns {number} its position
   */
  const rank = (heading) => {
    const i = HEADING_ORDER.indexOf(heading.slice(4));
    return i === -1 ? HEADING_ORDER.length : i;
  };
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([heading, lines]) => (heading ? `${heading}\n\n${lines.join("\n")}` : lines.join("\n")))
    .join("\n\n");
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
