import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { knownPlace, lookUpPlace, warmPlace } from "./places";

vi.mock("./api", () => ({ api: { placeName: vi.fn() } }));

const placeName = vi.mocked(api.placeName);

afterEach(() => {
  placeName.mockReset();
});

describe("lookUpPlace", () => {
  it("asks once per spot, even when asked twice at once", async () => {
    placeName.mockResolvedValue("Waterview, Auckland, New Zealand");
    const [a, b] = await Promise.all([
      lookUpPlace(-36.87838, 174.70239),
      lookUpPlace(-36.87838, 174.70239),
    ]);
    expect(a).toBe("Waterview, Auckland, New Zealand");
    expect(b).toBe(a);
    expect(await lookUpPlace(-36.87838, 174.70239)).toBe(a);
    expect(placeName).toHaveBeenCalledTimes(1);
    expect(knownPlace(-36.87838, 174.70239)).toBe(a);
  });

  it("forgets a failed lookup, so it's tried again", async () => {
    placeName.mockRejectedValueOnce("Couldn't reach the place-name service.");
    await expect(lookUpPlace(-36.88, 174.71)).rejects.toBe(
      "Couldn't reach the place-name service.",
    );
    expect(knownPlace(-36.88, 174.71)).toBeUndefined();

    placeName.mockResolvedValueOnce("Point Chevalier, Auckland, New Zealand");
    expect(await lookUpPlace(-36.88, 174.71)).toBe("Point Chevalier, Auckland, New Zealand");
  });
});

describe("warmPlace", () => {
  it("looks ahead one spot at a time, in the order asked", async () => {
    const answers: ((place: string | null) => void)[] = [];
    placeName.mockImplementation(
      () => new Promise<string | null>((resolve) => answers.push(resolve)),
    );
    warmPlace(-37.1, 175.1);
    warmPlace(-37.2, 175.2);
    warmPlace(-37.2, 175.2);
    expect(placeName).toHaveBeenCalledTimes(1);

    answers[0]("Raglan, Waikato, New Zealand");
    await vi.waitFor(() => expect(placeName).toHaveBeenCalledTimes(2));
    expect(placeName).toHaveBeenLastCalledWith(-37.2, 175.2);
    answers[1](null);
    await vi.waitFor(() => expect(knownPlace(-37.2, 175.2)).toBeNull());
    expect(knownPlace(-37.1, 175.1)).toBe("Raglan, Waikato, New Zealand");
    expect(placeName).toHaveBeenCalledTimes(2);
  });
});
