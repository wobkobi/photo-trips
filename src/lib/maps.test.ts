import { describe, expect, it } from "vitest";
import { googleMapsUrl } from "./maps";

describe("googleMapsUrl", () => {
  it("opens Google Maps with a pin on the spot", () => {
    expect(googleMapsUrl(-36.8485, 174.7633)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-36.848500,174.763300",
    );
  });
});
