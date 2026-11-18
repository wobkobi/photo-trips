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
 * Areas of the app in the order release notes list them. A changelog bullet names its area
 * first ("- **Viewer:** Clicking a photo zooms in"); areas not listed here follow in the order
 * they first appear, and bullets without one go under General, last.
 */
const AREA_ORDER = [
  "Library",
  "Viewer",
  "Trips",
  "Import",
  "Phones",
  "Sort",
  "Duplicates",
  "Recycle Bin",
  "History",
  "Navigation",
  "Settings",
  "Updates",
];

/** What each changelog heading is called beside a bullet once the notes are grouped by area. */
const TYPE_LABEL = {
  Added: "New",
  Changed: "Changed",
  Deprecated: "Deprecated",
  Removed: "Removed",
  Fixed: "Fixed",
  Security: "Security",
};

/**
 * Regroup changelog notes by area of the app, each bullet labelled with its kind ("- New: ...",
 * "- Fixed: ..."), so a release reads as what changed where. Notes with no area-tagged bullet
 * (releases from before areas were used) come back unchanged.
 * @param {string} notes - "### Added" style groups of single-line bullets
 * @returns the notes grouped under "### Library" style headings
 */
export function byArea(notes) {
  const lines = notes.split("\n");
  const tagged = /^- \*\*([^*]+?):\*\*\s+(.*)$/;
  if (!lines.some((line) => tagged.test(line))) return notes;

  /** @type {Map<string, string[]>} */
  const areas = new Map();
  let kind = "";
  for (const line of lines) {
    if (line.startsWith("### ")) {
      kind = line.slice(4).trim();
      continue;
    }
    if (!line.trim()) continue;
    const match = tagged.exec(line);
    const area = match ? match[1].trim() : "General";
    const text = match ? match[2] : line.replace(/^[-*]\s+/, "");
    const label = TYPE_LABEL[/** @type {keyof typeof TYPE_LABEL} */ (kind)] ?? kind;
    areas.set(area, [...(areas.get(area) ?? []), label ? `- ${label}: ${text}` : `- ${text}`]);
  }
  /**
   * Where an area sorts: listed areas in {@link AREA_ORDER}, then others, then General.
   * @param {string} area - area name
   * @returns {number} its position
   */
  const rank = (area) => {
    if (area === "General") return AREA_ORDER.length + 1;
    const i = AREA_ORDER.indexOf(area);
    return i === -1 ? AREA_ORDER.length : i;
  };
  return [...areas]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([area, bullets]) => `### ${area}\n\n${bullets.join("\n")}`)
    .join("\n\n");
}

/**
 * Notes for a release: every changelog section after the last published release up to this
 * version, so changes from a version that was never released still reach installed copies.
 * Grouped by area of the app when the changelog names areas, see {@link byArea}.
 * @param {string} changelog - CHANGELOG.md text
 * @param {string} version - version being released
 * @param {string | null} since - last published version, or null to use this version's section alone
 * @returns the notes, or null when the changelog has no section for this version
 */
export function releaseNotes(changelog, version, since) {
  const notes = typedNotes(changelog, version, since);
  return notes && byArea(notes);
}

/**
 * {@link releaseNotes} before grouping by area: the sections merged under one heading each
 * ("### Added", "### Fixed"), newest first.
 * @param {string} changelog - CHANGELOG.md text
 * @param {string} version - version being released
 * @param {string | null} since - last published version, or null for this version's section alone
 * @returns the notes, or null when the changelog has no section for this version
 */
function typedNotes(changelog, version, since) {
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
 * Every changelog section up to this version, newest first. The app picks the ones newer than
 * the copy it's running, so an update that skips releases still lists everything it brings.
 * @param {string} changelog - CHANGELOG.md text
 * @param {string} version - version being released; later sections are left out
 * @returns {{ version: string, notes: string }[]} one entry per version that has notes
 */
export function changeHistory(changelog, version) {
  return [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)]
    .map((match) => match[1])
    .filter((v) => compareVersions(v, version) <= 0)
    .sort((a, b) => compareVersions(b, a))
    .flatMap((v) => {
      const notes = changelogSection(changelog, v);
      return notes ? [{ version: v, notes: byArea(notes) }] : [];
    });
}

/**
 * The update manifest the app fetches from the latest release. `notes` is what the updater
 * plugin reads; `changes` is extra, read by the app itself.
 * @param {object} release - what to announce
 * @param {string} release.version - the new version
 * @param {string} release.notes - its release notes
 * @param {{ version: string, notes: string }[]} release.changes - from {@link changeHistory}
 * @param {string} release.signature - contents of the installer's .sig file
 * @param {string} release.url - where the installer downloads from
 * @param {Date} release.date - publish time
 * @returns the latest.json object
 */
export function manifest({ version, notes, changes, signature, url, date }) {
  return {
    version,
    notes,
    changes,
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

/**
 * Branch whose beta.json is the beta channel's update manifest. A branch, not a release asset,
 * because published releases here are immutable and their files can't be replaced.
 */
export const BETA_FEED_BRANCH = "update-feed";

/**
 * Order two release versions, each "x.y.z" or "x.y.z-beta.n". A beta sorts below the release
 * it leads up to, as semver has it, so a beta tester moves on to the finished version.
 * @param {string} a - first version
 * @param {string} b - second version
 * @returns negative, zero or positive, as a is older than, equal to or newer than b
 */
export function compareReleases(a, b) {
  const [x, y] = [a, b].map(splitRelease);
  const core = compareVersions(x.core, y.core);
  if (core !== 0) return core;
  if (x.beta === y.beta) return 0;
  return x.beta - y.beta;
}

/**
 * Split a release version into its x.y.z and beta number.
 * @param {string} version - "x.y.z" or "x.y.z-beta.n"
 * @returns {{ core: string, beta: number }} the beta number is Infinity for a finished release,
 *   which outranks every beta of it
 */
function splitRelease(version) {
  const match = /^(\d+\.\d+\.\d+)(?:-beta\.(\d+))?$/.exec(version);
  if (!match) throw new Error(`not a release version: ${version}`);
  return { core: match[1], beta: match[2] === undefined ? Infinity : Number(match[2]) };
}

/**
 * The next beta of a version: one past the highest beta of it already published, so beta numbers
 * count up across every pull request without gaps.
 * @param {string} version - package.json version, e.g. "0.31.0"
 * @param {string[]} tags - tags of the releases already published
 * @returns the beta version, e.g. "0.31.0-beta.3"
 */
export function nextBeta(version, tags) {
  const prefix = `v${version}-beta.`;
  const taken = tags
    .filter((tag) => tag.startsWith(prefix) && /^\d+$/.test(tag.slice(prefix.length)))
    .map((tag) => Number(tag.slice(prefix.length)));
  return `${version}-beta.${Math.max(0, ...taken) + 1}`;
}

/**
 * Release title of a beta. The pull request number in it is how a closed pull request's betas
 * are found again, see {@link betaPull}.
 * @param {string} version - beta version
 * @param {number} pull - pull request number
 * @returns the title
 */
export function betaTitle(version, pull) {
  return `Pic Cabinet ${version} from #${pull}`;
}

/**
 * The pull request a beta came from, read back from its title.
 * @param {string} title - release title
 * @returns the pull request number, or null when the release isn't a beta
 */
export function betaPull(title) {
  const match = /^Pic Cabinet \d+\.\d+\.\d+-beta\.\d+ from #(\d+)$/.exec(title);
  return match ? Number(match[1]) : null;
}

/**
 * Releases the beta feed can point at, newest first: every finished release and beta, but not
 * tags that aren't versions.
 * @param {string[]} tags - tags of the published releases
 * @returns the versions, without their "v"
 */
export function feedCandidates(tags) {
  return tags
    .filter((tag) => /^v\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(tag))
    .map((tag) => tag.slice(1))
    .sort((a, b) => compareReleases(b, a));
}

/**
 * Release notes made safe for a GitHub release body, where "@word" mentions a user: GitHub lists
 * them as contributors and notifies them, so a NAS folder like `@eaDir` pinged a stranger. A
 * zero-width space after the "@" stops the link and reads the same. Code spans are left alone.
 * @param {string} notes - release notes markdown
 * @returns the notes with no mentions
 */
export function withoutMentions(notes) {
  return notes
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/(^|[^\w])@(?=\w)/g, "$1@\u200B")))
    .join("");
}
