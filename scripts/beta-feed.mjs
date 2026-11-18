// Point the beta channel at the newest release, beta or not. Copies with Beta updates on read
// beta.json from the update-feed branch; this copies the newest release's latest.json there.
//
//   node scripts/beta-feed.mjs              refresh the feed
//   node scripts/beta-feed.mjs --drop 49    delete pull request 49's betas, then refresh
//
// The feed lives on a branch rather than a release because the repo's releases are immutable:
// once published, a release's files can't be replaced. The branch holds only beta.json, and each
// refresh adds one commit on top.
//
// Every run works the answer out from the releases as they are now, so runs that overlap or
// arrive out of order still leave the feed right once the last one finishes.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { BETA_FEED_BRANCH, RELEASES_REPO, betaPull, feedCandidates } from "./release-lib.mjs";

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
 * Run gh and return its output, or null when it fails.
 * @param {string[]} args - gh arguments
 * @param {string} [input] - text for its stdin
 * @returns {string | null} trimmed stdout
 */
function gh(args, input) {
  const result = spawnSync("gh", args, { encoding: "utf8", input });
  if (result.status !== 0) console.error(result.stderr.trim());
  return result.status === 0 ? (result.stdout ?? "").trim() : null;
}

/**
 * Call the GitHub REST API on the releases repo.
 * @param {string} method - HTTP method
 * @param {string} path - path after repos/<repo>/
 * @param {object} [body] - JSON body
 * @returns {{ sha?: string, object?: { sha: string } } | null} the parsed response, or null when the call fails
 */
function api(method, path, body) {
  const args = ["api", "--method", method, `repos/${RELEASES_REPO}/${path}`];
  const out = body ? gh([...args, "--input", "-"], JSON.stringify(body)) : gh(args);
  return out === null ? null : JSON.parse(out || "null");
}

if (drop !== null && !(Number.isInteger(drop) && drop > 0)) {
  fail("--drop needs the pull request number, e.g. --drop 49.");
}

/**
 * Every published release.
 * @returns {{ tagName: string, name: string }[]} tag and title of each
 */
function releases() {
  const listed = gh([
    "release",
    "list",
    "--repo",
    RELEASES_REPO,
    "--limit",
    "1000",
    "--json",
    "tagName,name",
  ]);
  if (listed === null) fail("couldn't list the releases. Is gh signed in?");
  return JSON.parse(listed);
}

// Betas of a closed pull request go, so they can't be installed from the feed. A tag that GitHub
// keeps (an immutable release's tag can be protected) stays; numbering skips it.
if (drop !== null) {
  for (const release of releases().filter((r) => betaPull(r.name) === drop)) {
    const repo = ["--repo", RELEASES_REPO, "--yes"];
    if (gh(["release", "delete", release.tagName, "--cleanup-tag", ...repo]) !== null) {
      console.log(`beta-feed: deleted ${release.tagName}`);
    } else if (gh(["release", "delete", release.tagName, ...repo]) !== null) {
      console.log(`beta-feed: deleted ${release.tagName}, but its tag stays`);
    } else {
      fail(`couldn't delete ${release.tagName}.`);
    }
  }
}

// Newest first. A release whose latest.json didn't finish uploading (a cancelled run) is passed
// over for the one below it.
const work = mkdtempSync(join(tmpdir(), "beta-feed-"));
let feed = null;
for (const version of feedCandidates(releases().map((r) => r.tagName))) {
  const downloaded = join(work, "latest.json");
  rmSync(downloaded, { force: true });
  gh([
    "release",
    "download",
    `v${version}`,
    "--repo",
    RELEASES_REPO,
    "--pattern",
    "latest.json",
    "--dir",
    work,
  ]);
  try {
    feed = readFileSync(downloaded, "utf8");
    JSON.parse(feed);
    break;
  } catch {
    feed = null;
    console.log(`beta-feed: v${version} has no latest.json, trying the one before it`);
  }
}
rmSync(work, { recursive: true, force: true });
if (feed === null) fail("no release has a latest.json to point the feed at.");
const offered = JSON.parse(feed).version;

// One commit holding just beta.json, on top of the branch's last one (or as its first)
const ref = api("GET", `git/ref/heads/${BETA_FEED_BRANCH}`);
const parent = ref?.object?.sha ?? null;
const tree = api("POST", "git/trees", {
  tree: [{ path: "beta.json", mode: "100644", type: "blob", content: feed }],
});
const commit =
  tree &&
  api("POST", "git/commits", {
    message: `Beta feed: ${offered}`,
    tree: tree.sha,
    parents: parent ? [parent] : [],
  });
if (!commit) fail("couldn't write the feed commit.");
const moved = parent
  ? api("PATCH", `git/refs/heads/${BETA_FEED_BRANCH}`, { sha: commit.sha, force: true })
  : api("POST", "git/refs", { ref: `refs/heads/${BETA_FEED_BRANCH}`, sha: commit.sha });
if (!moved) fail(`couldn't move the ${BETA_FEED_BRANCH} branch.`);
console.log(`beta-feed: the beta channel now offers ${offered}`);
