// Point the beta channel at the newest release, beta or not. Copies with Beta updates on read
// beta.json from the beta-feed release; this copies the newest release's latest.json there.
//
//   node scripts/beta-feed.mjs              refresh the feed
//   node scripts/beta-feed.mjs --drop 49    delete pull request 49's betas, then refresh
//
// Every run works the answer out from the releases as they are now, so runs that overlap or
// arrive out of order still leave the feed right once the last one finishes.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { BETA_FEED_TAG, RELEASES_REPO, betaPull, feedCandidates } from "./release-lib.mjs";

const dropFlag = process.argv.indexOf("--drop");
const drop = dropFlag === -1 ? null : Number(process.argv[dropFlag + 1]);

/**
 * Stop with a message.
 * @param {string} message - what went wrong
 */
function fail(message) {
  console.error(`beta-feed: ${message}`);
  process.exit(1);
}

/**
 * Run gh against the releases repo and return its output, or null when it fails.
 * @param {string[]} args - gh arguments, without --repo
 * @returns {string | null} trimmed stdout
 */
function gh(args) {
  const result = spawnSync("gh", [...args, "--repo", RELEASES_REPO], { encoding: "utf8" });
  if (result.status !== 0) console.error(result.stderr.trim());
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

if (drop !== null && !(Number.isInteger(drop) && drop > 0)) {
  fail("--drop needs the pull request number, e.g. --drop 49.");
}

/**
 * Every published release.
 * @returns {{ tagName: string, name: string }[]} tag and title of each
 */
function releases() {
  const listed = gh(["release", "list", "--limit", "1000", "--json", "tagName,name"]);
  if (listed === null) fail("couldn't list the releases. Is gh signed in?");
  return JSON.parse(listed);
}

// Betas of a closed pull request go, tags too, so they can't be installed from the feed
if (drop !== null) {
  for (const release of releases().filter((r) => betaPull(r.name) === drop)) {
    if (gh(["release", "delete", release.tagName, "--cleanup-tag", "--yes"]) === null) {
      fail(`couldn't delete ${release.tagName}.`);
    }
    console.log(`beta-feed: deleted ${release.tagName}`);
  }
}

const all = releases();
if (!all.some((r) => r.tagName === BETA_FEED_TAG)) {
  const created = gh([
    "release",
    "create",
    BETA_FEED_TAG,
    "--title",
    "Beta update feed",
    "--notes",
    "Holds beta.json, the update manifest read by copies with Beta updates on. It always describes the newest release, beta or not.",
    "--prerelease",
    "--latest=false",
    "--target",
    "main",
  ]);
  if (created === null) fail(`couldn't create the ${BETA_FEED_TAG} release.`);
}

// Newest first. A release whose latest.json didn't finish uploading (a cancelled run) is passed
// over for the one below it. An upload that fails stops there rather than trying an older one.
const work = mkdtempSync(join(tmpdir(), "beta-feed-"));
let offered = null;
for (const version of feedCandidates(all.map((r) => r.tagName))) {
  const downloaded = join(work, "latest.json");
  rmSync(downloaded, { force: true });
  gh(["release", "download", `v${version}`, "--pattern", "latest.json", "--dir", work]);
  try {
    offered = JSON.parse(readFileSync(downloaded, "utf8")).version;
  } catch {
    console.log(`beta-feed: v${version} has no latest.json, trying the one before it`);
    continue;
  }
  const feed = join(work, "beta.json");
  renameSync(downloaded, feed);
  if (gh(["release", "upload", BETA_FEED_TAG, feed, "--clobber"]) === null) offered = null;
  break;
}
rmSync(work, { recursive: true, force: true });
if (offered === null) fail("couldn't point the feed at any release.");
console.log(`beta-feed: the beta channel now offers ${offered}`);
