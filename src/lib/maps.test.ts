import { describe, expect, it } from "vitest";
import { googleMapsUrl, mapStyleUrl } from "./maps";

describe("map links", () => {
  it("picks the OpenFreeMap style for the theme", () => {
    expect(mapStyleUrl(false)).toBe("https://tiles.openfreemap.org/styles/positron");
    expect(mapStyleUrl(true)).toBe("https://tiles.openfreemap.org/styles/dark");
  });

  it("opens Google Maps with a pin on the spot", () => {
    expect(googleMapsUrl(-36.8485, 174.7633)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-36.848500,174.763300",
    );
  });
});
