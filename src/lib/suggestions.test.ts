import { describe, expect, it } from "vitest";
import type { Suggestion } from "./api";
import { daysIn, formFromSuggestion, howFound, reasonText, suggestionKey } from "./suggestions";
import { toDraft } from "./trips";

const japan: Suggestion = {
  startDay: "2025-03-12",
  endDay: "2025-03-17",
  name: "Kyoto and Tokyo",
  namedByPlace: true,
  files: 184,
  awayDays: 0,
  awayKm: null,
  sample: [],
};

describe("daysIn", () => {
  it("counts both ends", () => {
    expect(daysIn("2025-03-12", "2025-03-12")).toBe(1);
    expect(daysIn("2025-03-12", "2025-03-17")).toBe(6);
  });

  it("crosses months, years and daylight saving changes", () => {
    expect(daysIn("2025-02-27", "2025-03-02")).toBe(4);
    expect(daysIn("2024-12-30", "2025-01-02")).toBe(4);
    expect(daysIn("2025-04-05", "2025-04-07")).toBe(3);
    expect(daysIn("2025-09-27", "2025-09-29")).toBe(3);
  });
});

describe("reasonText", () => {
  it("counts the photos and days", () => {
    expect(reasonText(japan)).toBe("184 photos and videos over 6 days.");
    expect(reasonText({ ...japan, files: 1 })).toBe("1 photo or video over 6 days.");
  });

  it("says how many days were away and how far", () => {
    expect(reasonText({ ...japan, awayDays: 4, awayKm: 2150 })).toBe(
      "184 photos and videos over 6 days. 4 of the days were about 2,150 km from home.",
    );
    expect(reasonText({ ...japan, awayDays: 1, awayKm: 80 })).toBe(
      "184 photos and videos over 6 days. 1 of the days was about 80 km from home.",
    );
    expect(reasonText({ ...japan, awayDays: 6, awayKm: 8800 })).toBe(
      "184 photos and videos over 6 days. All 6 days were about 8,800 km from home.",
    );
  });

  it("says a day trip in one go", () => {
    const day = { ...japan, startDay: "2026-08-28", endDay: "2026-08-28", files: 142 };
    expect(reasonText({ ...day, awayDays: 1, awayKm: 108 })).toBe(
      "142 photos and videos in one day, about 108 km from home.",
    );
    expect(reasonText({ ...day, awayDays: 0, awayKm: null })).toBe(
      "142 photos and videos in one day.",
    );
  });
});

describe("howFound", () => {
  const busy =
    "A day with 15 or more photos and videos counts as busy. Two or more busy days in a row make a suggestion, even with a quiet day between them.";
  const away =
    "A day spent more than 50 km from home counts as well, however few photos it has, and a busy one makes a suggestion on its own as a day trip. Busy days at home don't count.";

  it("names a home worked out from the photos", () => {
    expect(howFound({ minPhotos: 15, located: 900, home: { place: "Auckland", set: false } })).toBe(
      `${busy} Home looks to be near Auckland, where photos were taken on the most days. ${away}`,
    );
    expect(howFound({ minPhotos: 15, located: 900, home: { place: null, set: false } })).toBe(
      `${busy} Home looks to be where photos were taken on the most days. ${away}`,
    );
  });

  it("says when home was set by hand", () => {
    expect(howFound({ minPhotos: 15, located: 0, home: { place: "Dunedin", set: true } })).toBe(
      `${busy} Home is set in Settings, near Dunedin. ${away}`,
    );
  });

  it("explains why only busy days count without a home", () => {
    expect(howFound({ minPhotos: 15, located: 0, home: null })).toBe(
      `${busy} None of the photos have a location, so only busy days count.`,
    );
    expect(howFound({ minPhotos: 15, located: 12, home: null })).toBe(
      `${busy} Too few photos have a location to tell where home is, so only busy days count.`,
    );
  });
});

describe("a suggestion as a trip", () => {
  it("takes in its whole first and last days", () => {
    expect(toDraft(formFromSuggestion(japan))).toEqual({
      name: "Kyoto and Tokyo",
      startAt: "2025-03-12T00:00:00",
      endAt: "2025-03-17T23:59:59",
    });
  });

  it("is keyed by its days", () => {
    expect(suggestionKey(japan)).toBe("2025-03-12|2025-03-17");
  });
});
