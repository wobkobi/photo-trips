import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "./releaseNotes";

describe("parseReleaseNotes", () => {
  it("groups bullets under their headings", () => {
    const notes = "### Added\n\n- A menu bar.\n- Updates.\n\n### Fixed\n\n- iPhone import.";
    expect(parseReleaseNotes(notes)).toEqual([
      { heading: "Added", items: ["A menu bar.", "Updates."] },
      { heading: "Fixed", items: ["iPhone import."] },
    ]);
  });

  it("joins a bullet wrapped over several lines", () => {
    const notes = "### Fixed\r\n\r\n- Importing from an iPhone\r\n  found nothing.\r\n";
    expect(parseReleaseNotes(notes)).toEqual([
      { heading: "Fixed", items: ["Importing from an iPhone found nothing."] },
    ]);
  });

  it("keeps plain lines and drops empty groups", () => {
    expect(parseReleaseNotes("### Added\n\n### Fixed\nSmall fixes.")).toEqual([
      { heading: "Fixed", items: ["Small fixes."] },
    ]);
    expect(parseReleaseNotes("- No heading")).toEqual([{ heading: null, items: ["No heading"] }]);
    expect(parseReleaseNotes("  \n")).toEqual([]);
  });
});
