import { describe, expect, it } from "vitest";
import { assetName, assetUrl, changelogSection, manifest, releaseNotes } from "./release-lib.mjs";

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
    expect(
      manifest({
        version: "0.11.0",
        notes: "- A fix.",
        signature: "sig\n",
        url,
        date: new Date("2026-11-15T01:02:03Z"),
      }),
    ).toEqual({
      version: "0.11.0",
      notes: "- A fix.",
      pub_date: "2026-11-15T01:02:03.000Z",
      platforms: { "windows-x86_64": { signature: "sig", url } },
    });
  });
});
