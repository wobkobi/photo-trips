import { afterEach, describe, expect, it, vi } from "vitest";
import { knownPlace, lookUpPlace } from "./places";

/**
 * A fetch stand-in that answers like Photon with one address.
 * @param district - the suburb Photon names
 * @returns the mock, for counting calls
 */
function photon(district: string): ReturnType<typeof vi.fn> {
  const answer = {
    features: [{ properties: { district, state: "Auckland", country: "New Zealand" } }],
  };
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(answer))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookUpPlace", () => {
  it("asks Photon once per spot, even when asked twice at once", async () => {
    const fetchMock = photon("Flat Bush");
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([lookUpPlace(-36.97, 174.91), lookUpPlace(-36.97, 174.91)]);
    expect(a).toBe("Flat Bush, Auckland, New Zealand");
    expect(b).toBe(a);
    expect(await lookUpPlace(-36.97, 174.91)).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(knownPlace(-36.97, 174.91)).toBe(a);
  });

  it("forgets a failed lookup, so it's tried again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(lookUpPlace(-36.88, 174.71)).rejects.toThrow("offline");
    expect(knownPlace(-36.88, 174.71)).toBeUndefined();

    vi.stubGlobal("fetch", photon("Point Chevalier"));
    expect(await lookUpPlace(-36.88, 174.71)).toBe("Point Chevalier, Auckland, New Zealand");
  });
});
