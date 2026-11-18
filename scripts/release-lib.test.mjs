import { describe, expect, it } from "vitest";
import {
  assetName,
  assetUrl,
  betaPull,
  betaTitle,
  changeHistory,
  changelogSection,
  compareReleases,
  feedCandidates,
  manifest,
  nextBeta,
  releaseNotes,
} from "./release-lib.mjs";

const CHANGELOG = `# Changelog

Intro text.

## [0.11.0] - 2026-11-15

### Added

- Updates: Settings > About checks for a new version
  and installs it.

### Fixed

- A fix.

## [0.10.1] - 2026-11-14

### Fixed

- Older.
`;

describe("changelogSection", () => {
  it("takes one version's section and joins wrapped bullets", () => {
    expect(changelogSection(CHANGELOG, "0.11.0")).toBe(
      "### Added\n\n- Updates: Settings > About checks for a new version and installs it.\n\n### Fixed\n\n- A fix.",
    );
  });

  it("reads the last section to the end of the file", () => {
    expect(changelogSection(CHANGELOG, "0.10.1")).toBe("### Fixed\n\n- Older.");
  });

  it("is null for a version without a section", () => {
    expect(changelogSection(CHANGELOG, "0.12.0")).toBeNull();
    // 0.1.0 must not match the 0.11.0 heading.
    expect(changelogSection(CHANGELOG, "0.1")).toBeNull();
  });
});

describe("releaseNotes", () => {
  const UNRELEASED = `# Changelog

## [0.12.1] - 2026-11-16

### Fixed

- Newest fix.

## [0.12.0] - 2026-11-16

### Added

- Never released.

### Fixed

- Older fix.
${CHANGELOG.slice(CHANGELOG.indexOf("## [0.11.0]"))}`;

  it("is just this version's section when the last release was the one before", () => {
    expect(releaseNotes(CHANGELOG, "0.11.0", "0.10.1")).toBe(changelogSection(CHANGELOG, "0.11.0"));
  });

  it("is just this version's section when the last release isn't known", () => {
    expect(releaseNotes(UNRELEASED, "0.12.1", null)).toBe("### Fixed\n\n- Newest fix.");
  });

  it("merges versions that were never released, by heading in the usual order", () => {
    expect(releaseNotes(UNRELEASED, "0.12.1", "0.11.0")).toBe(
      "### Added\n\n- Never released.\n\n### Fixed\n\n- Newest fix.\n- Older fix.",
    );
  });

  it("compares versions by number, not text", () => {
    const notes = releaseNotes(UNRELEASED, "0.12.1", "0.9.4");
    expect(notes).toContain("- Updates: Settings > About");
    expect(notes).toContain("- Older.");
  });

  it("is null when this version has no section", () => {
    expect(releaseNotes(UNRELEASED, "0.13.0", "0.11.0")).toBeNull();
  });
});

describe("manifest", () => {
  it("announces the Windows installer", () => {
    const url = assetUrl("0.11.0", assetName("0.11.0"));
    expect(url).toBe(
      "https://github.com/wobkobi/pic-cabinet/releases/download/v0.11.0/Pic-Cabinet_0.11.0_x64-setup.exe",
    );
    const changes = [{ version: "0.11.0", notes: "- A fix." }];
    expect(
      manifest({
        version: "0.11.0",
        notes: "- A fix.",
        changes,
        signature: "sig\n",
        url,
        date: new Date("2026-11-15T01:02:03Z"),
      }),
    ).toEqual({
      version: "0.11.0",
      notes: "- A fix.",
      changes,
      pub_date: "2026-11-15T01:02:03.000Z",
      platforms: { "windows-x86_64": { signature: "sig", url } },
    });
  });
});

describe("changeHistory", () => {
  it("lists every version up to this one, newest first, by number", () => {
    const changelog = `${CHANGELOG}\n## [0.9.0] - 2026-11-13\n\n### Added\n\n- First.\n`;
    expect(changeHistory(changelog, "0.11.0")).toEqual([
      {
        version: "0.11.0",
        notes:
          "### Added\n\n- Updates: Settings > About checks for a new version and installs it.\n\n### Fixed\n\n- A fix.",
      },
      { version: "0.10.1", notes: "### Fixed\n\n- Older." },
      { version: "0.9.0", notes: "### Added\n\n- First." },
    ]);
  });

  it("leaves out sections newer than the release", () => {
    expect(changeHistory(CHANGELOG, "0.10.1").map((c) => c.version)).toEqual(["0.10.1"]);
  });
});

describe("compareReleases", () => {
  it("puts a beta below the release it leads up to and above the one before", () => {
    const sorted = ["0.31.0", "0.31.0-beta.10", "0.30.7", "0.31.0-beta.2"].sort(compareReleases);
    expect(sorted).toEqual(["0.30.7", "0.31.0-beta.2", "0.31.0-beta.10", "0.31.0"]);
  });

  it("treats the same version as equal", () => {
    expect(compareReleases("0.31.0", "0.31.0")).toBe(0);
    expect(compareReleases("0.31.0-beta.3", "0.31.0-beta.3")).toBe(0);
  });
});

describe("nextBeta", () => {
  it("counts on from the highest beta of the same version", () => {
    const tags = ["v0.31.0-beta.2", "v0.31.0-beta.10", "v0.3.0-beta.40", "v0.31.0"];
    expect(nextBeta("0.31.0", tags)).toBe("0.31.0-beta.11");
  });

  it("starts at 1", () => {
    expect(nextBeta("0.32.0", ["v0.31.0-beta.4", "beta-feed"])).toBe("0.32.0-beta.1");
  });
});

describe("betaTitle", () => {
  it("names the pull request, which betaPull reads back", () => {
    const title = betaTitle("0.31.0-beta.3", 49);
    expect(title).toBe("Pic Cabinet 0.31.0-beta.3 from #49");
    expect(betaPull(title)).toBe(49);
  });

  it("finds no pull request in a finished release's title", () => {
    expect(betaPull("Pic Cabinet 0.30.7")).toBeNull();
    expect(betaPull("Beta update feed")).toBeNull();
  });
});

describe("feedCandidates", () => {
  it("lists releases and betas newest first, without the feed or stray tags", () => {
    const tags = ["v0.30.7", "beta-feed", "v0.31.0-beta.2", "v0.31.0-beta.10", "nightly"];
    expect(feedCandidates(tags)).toEqual(["0.31.0-beta.10", "0.31.0-beta.2", "0.30.7"]);
  });
});
