import { describe, expect, it } from "vitest";
import type { Tile, TripInfo } from "./api";
import { addEdit, editDone, editLabel, leftOut, nearestTrips, pickedEdits } from "./tripEdits";

const japan: TripInfo = {
  id: 1,
  name: "Japan",
  startAt: "2025-03-12T00:00:00",
  endAt: "2025-03-17T23:59:59",
  folder: "2025-03-12 Japan",
  colour: 1,
  files: 3,
  sample: [],
  excluded: [],
};
const tairua: TripInfo = {
  ...japan,
  id: 2,
  name: "Tairua",
  startAt: "2025-12-26T00:00:00",
  endAt: "2026-01-05T23:59:59",
};

/**
 * A library tile for the tests.
 * @param id - its id
 * @param takenAt - when it was taken
 * @param trip - the trip it's in, if any
 * @returns the tile
 */
function tile(id: number, takenAt: string, trip: TripInfo | null = null): Tile {
  return {
    id,
    takenAt,
    kind: "photo",
    ext: "jpg",
    name: `IMG_${id}.jpg`,
    uncertain: false,
    dateSet: false,
    extra: 0,
    live: false,
    rawTwin: false,
    linked: [],
    version: 1,
    trip: trip && { id: trip.id, name: trip.name, colour: trip.colour },
    empty: false,
  };
}

// Japan has photos 1-3 in it and 4 left out; 5 and 6 are on no trip, 7 is in Tairua.
const tiles = [
  tile(1, "2025-03-12T09:00:00", japan),
  tile(2, "2025-03-14T09:00:00", japan),
  tile(3, "2025-03-17T20:00:00", japan),
  tile(4, "2025-03-15T09:00:00"),
  tile(5, "2025-03-19T10:00:00"),
  tile(6, "2025-03-18T10:00:00"),
  tile(7, "2025-12-30T10:00:00", tairua),
];
/**
 * The tiles with these ids.
 * @param ids - which tiles
 * @returns them, in library order
 */
const byId = (...ids: number[]): Tile[] => tiles.filter((t) => ids.includes(t.id));

describe("leftOut", () => {
  it("finds the photos within a trip's dates that aren't in it", () => {
    expect(leftOut(japan, tiles)).toEqual([4]);
    expect(leftOut(tairua, tiles)).toEqual([]);
  });
});

describe("pickedEdits", () => {
  it("takes photos out of their trip, keeping the ones already left out", () => {
    const { remove, putBack, free } = pickedEdits(byId(2), [japan, tairua], tiles);
    expect(remove).toHaveLength(1);
    expect(remove[0].ids).toEqual([2]);
    expect(remove[0].draft).toEqual({
      name: "Japan",
      startAt: japan.startAt,
      endAt: japan.endAt,
      excluded: [4, 2],
    });
    expect(putBack).toEqual([]);
    expect(free).toEqual([]);
  });

  it("puts a left-out photo back, and sorts a mixed pick by trip", () => {
    const { remove, putBack, free } = pickedEdits(byId(4, 5, 7), [japan, tairua], tiles);
    expect(putBack.map((e) => [e.trip.name, e.ids, e.draft.excluded])).toEqual([
      ["Japan", [4], []],
    ]);
    expect(remove.map((e) => [e.trip.name, e.ids])).toEqual([["Tairua", [7]]]);
    expect(free.map((t) => t.id)).toEqual([5]);
  });
});

describe("addEdit", () => {
  it("widens the trip to whole days around the photos and leaves the rest of those days out", () => {
    const edit = addEdit(japan, byId(5), tiles);
    expect(edit.draft.startAt).toBe(japan.startAt);
    expect(edit.draft.endAt).toBe("2025-03-19T23:59:59");
    // 4 stays left out; 6 is taken in by the wider dates but wasn't picked.
    expect(edit.draft.excluded).toEqual([4, 6]);
    expect(edit.ids).toEqual([5]);
  });

  it("widens the start for photos before the trip", () => {
    const edit = addEdit(japan, [tile(8, "2025-03-10T08:00:00")], tiles);
    expect(edit.draft.startAt).toBe("2025-03-10T00:00:00");
    expect(edit.draft.endAt).toBe(japan.endAt);
  });
});

describe("nearestTrips", () => {
  it("puts the trip closest in time first, leaving out ones more than two weeks away", () => {
    const march = {
      ...tairua,
      id: 3,
      name: "Rotorua",
      startAt: "2025-03-25T00:00:00",
      endAt: "2025-03-26T23:59:59",
    };
    expect(nearestTrips(byId(5), [march, tairua, japan], 5).map((t) => t.name)).toEqual([
      "Japan",
      "Rotorua",
    ]);
    expect(nearestTrips(byId(5), [march, japan], 1)).toHaveLength(1);
    expect(nearestTrips([], [japan], 3)).toEqual([]);
  });
});

describe("editLabel", () => {
  it("names the trip in each kind of change", () => {
    const [remove] = pickedEdits(byId(1), [japan], tiles).remove;
    expect(editLabel(remove)).toBe("Remove from Japan");
    expect(editLabel(addEdit(japan, byId(5), tiles))).toBe("Add to Japan");
  });

  it("says what was done, counting the photos", () => {
    const [remove] = pickedEdits(byId(1, 2), [japan], tiles).remove;
    expect(editDone(remove)).toBe("Took 2 photos out of Japan.");
    const [back] = pickedEdits(byId(4), [japan], tiles).putBack;
    expect(editDone(back)).toBe("Put 1 photo back in Japan.");
    expect(editDone(addEdit(japan, byId(5), tiles))).toBe("Added 1 photo to Japan.");
  });
});
