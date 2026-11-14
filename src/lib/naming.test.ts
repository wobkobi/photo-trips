import { describe, expect, it } from "vitest";
import { monthFolder, namingOf, tripFolder } from "./naming";

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

  it("reads missing or unknown settings as the defaults", () => {
    expect(namingOf(null)).toEqual({ months: "year-month", trips: "date-name" });
    expect(namingOf({ month_folders: "number-name", trip_folders: "odd" })).toEqual({
      months: "number-name",
      trips: "date-name",
    });
  });
});
