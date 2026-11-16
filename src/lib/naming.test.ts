import { describe, expect, it } from "vitest";
import { cleanName, monthFolder, namingOf, tripFolder, tripTitle } from "./naming";

describe("folder names", () => {
  it("names month folders the way each preset says", () => {
    expect(monthFolder("year-month", "2026-03-12T10:00:00")).toBe("2026\\2026-03");
    expect(monthFolder("number-name", "2026-03-12")).toBe("2026\\03 March");
    expect(monthFolder("name-year", "2026-12-01")).toBe("2026\\December 2026");
  });

  it("names trip folders the way each preset says", () => {
    expect(tripFolder("date-name", "2026-03-12", "Japan")).toBe("Trips\\2026-03-12 Japan");
    expect(tripFolder("name-year", "2026-03-12", "Japan")).toBe("Trips\\Japan 2026");
    expect(tripFolder("year-name", "2026-03-12", "Japan")).toBe("Trips\\2026 Japan");
  });

  it("gives a trip over New Year both years, as naming.rs does", () => {
    const [start, end] = ["2025-12-26", "2026-01-05"];
    expect(tripTitle("date-name", start, "Tairua", end)).toBe("2025-12-26 Tairua");
    expect(tripTitle("name-year", start, "Tairua", end)).toBe("Tairua 2025-26");
    expect(tripTitle("year-name", start, "Tairua", end)).toBe("2025-26 Tairua");
    expect(tripFolder("name-year", "1999-12-30", "Tairua", "2000-01-02")).toBe(
      "Trips\\Tairua 1999-00",
    );
  });

  it("cleans a trip name for its folder, as trips.rs does", () => {
    expect(cleanName("  Japan: Tokyo / Kyoto?  ")).toBe("Japan Tokyo Kyoto");
    expect(cleanName("Road trip...")).toBe("Road trip");
    expect(cleanName("a\tb\nc")).toBe("a b c");
    expect(cleanName("<>|*")).toBe("");
    expect(cleanName("x".repeat(200))).toHaveLength(80);
    expect(tripTitle("name-year", "2026-03-12", "Japan?")).toBe("Japan 2026");
  });

  it("reads missing or unknown settings as the defaults", () => {
    expect(namingOf(null)).toEqual({ months: "year-month", trips: "date-name" });
    expect(namingOf({ month_folders: "number-name", trip_folders: "odd" })).toEqual({
      months: "number-name",
      trips: "date-name",
    });
  });
});
