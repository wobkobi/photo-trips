import { describe, expect, it } from "vitest";
import { DEFAULT_VOLUME, parseVolume } from "./videoVolume";

describe("parseVolume", () => {
  it("starts quieter than full volume", () => {
    expect(parseVolume(null)).toEqual({ volume: DEFAULT_VOLUME, muted: false });
    expect(DEFAULT_VOLUME).toBeLessThan(1);
  });

  it("keeps a saved volume and mute", () => {
    expect(parseVolume('{"volume":0.15,"muted":true}')).toEqual({ volume: 0.15, muted: true });
  });

  it("ignores malformed or out-of-range values", () => {
    expect(parseVolume("not json").volume).toBe(DEFAULT_VOLUME);
    expect(parseVolume('{"volume":3}').volume).toBe(DEFAULT_VOLUME);
    expect(parseVolume('{"volume":"loud"}').volume).toBe(DEFAULT_VOLUME);
  });
});
