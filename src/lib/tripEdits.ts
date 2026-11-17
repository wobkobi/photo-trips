// Trip changes made from picked Library photos: take them out of their trip, put left-out ones
// back, or add them to a trip by widening its dates. Each becomes a TripDraft for plan_trip,
// which reads the draft's list as every photo within the dates that is left out (trips.rs
// `exclusions`), so each draft carries the full list, not just the change.

import type { Tile, TripDraft, TripInfo } from "./api";
import { count } from "./format";

/** One change the picked photos allow, ready to preview. */
export interface TripEdit {
  kind: "remove" | "put-back" | "add";
  trip: TripInfo;
  /** The picked photos it applies to. */
  ids: number[];
  draft: TripDraft;
}

/** What the picked photos can do: per trip they're in or left out of, and those on no trip. */
export interface PickedEdits {
  remove: TripEdit[];
  putBack: TripEdit[];
  /** Picked photos on no trip and outside every trip's dates, which can be added to one. */
  free: Tile[];
}

/**
 * Whether a photo was taken within a trip's dates. Both are "YYYY-MM-DDTHH:MM:SS", so they
 * compare as text.
 * @param trip - the trip, or any range
 * @param trip.startAt - its first moment
 * @param trip.endAt - its last moment
 * @param takenAt - when the photo was taken
 * @returns true when it falls within the trip's first and last moment
 */
function within(trip: { startAt: string; endAt: string }, takenAt: string): boolean {
  return trip.startAt <= takenAt && takenAt <= trip.endAt;
}

/**
 * Photos within a trip's dates that are left out of it. Trips never overlap, so a photo within
 * one's dates with no trip band can only be one taken out of it.
 * @param trip - the trip
 * @param tiles - every photo in the library, unfiltered
 * @returns their ids
 */
export function leftOut(trip: TripInfo, tiles: Tile[]): number[] {
  return tiles.filter((t) => t.trip === null && within(trip, t.takenAt)).map((t) => t.id);
}

/**
 * A draft that keeps a trip's name and dates with a new left-out list.
 * @param trip - the trip
 * @param excluded - every photo within its dates to leave out
 * @returns the draft
 */
function keepDates(trip: TripInfo, excluded: number[]): TripDraft {
  return { name: trip.name, startAt: trip.startAt, endAt: trip.endAt, excluded };
}

/**
 * Sort picked photos by what can be done with them.
 * @param picked - the picked photos
 * @param trips - every trip
 * @param tiles - every photo in the library, unfiltered
 * @returns the removals and put-backs per trip, and the photos on no trip
 */
export function pickedEdits(picked: Tile[], trips: TripInfo[], tiles: Tile[]): PickedEdits {
  const remove: TripEdit[] = [];
  const putBack: TripEdit[] = [];
  const free: Tile[] = [];
  const inTrip = new Map<number, number[]>();
  const outOf = new Map<number, number[]>();
  for (const tile of picked) {
    const owner = tile.trip ? trips.find((t) => t.id === tile.trip?.id) : undefined;
    const around = owner ? undefined : trips.find((t) => within(t, tile.takenAt));
    if (owner) inTrip.set(owner.id, [...(inTrip.get(owner.id) ?? []), tile.id]);
    else if (around) outOf.set(around.id, [...(outOf.get(around.id) ?? []), tile.id]);
    else free.push(tile);
  }
  for (const trip of trips) {
    const taking = inTrip.get(trip.id);
    if (taking) {
      const excluded = [...new Set([...leftOut(trip, tiles), ...taking])];
      remove.push({ kind: "remove", trip, ids: taking, draft: keepDates(trip, excluded) });
    }
    const back = outOf.get(trip.id);
    if (back) {
      const excluded = leftOut(trip, tiles).filter((id) => !back.includes(id));
      putBack.push({ kind: "put-back", trip, ids: back, draft: keepDates(trip, excluded) });
    }
  }
  return { remove, putBack, free };
}

/**
 * Add photos to a trip by widening its dates to whole days around them. Other photos the wider
 * dates take in are left out, so only the picked ones join.
 * @param trip - the trip to add to
 * @param free - picked photos on no trip
 * @param tiles - every photo in the library, unfiltered
 * @returns the change
 */
export function addEdit(trip: TripInfo, free: Tile[], tiles: Tile[]): TripEdit {
  const days = free.map((t) => t.takenAt.slice(0, 10)).sort();
  const first = `${days[0]}T00:00:00`;
  const last = `${days[days.length - 1]}T23:59:59`;
  const wider = {
    startAt: first < trip.startAt ? first : trip.startAt,
    endAt: last > trip.endAt ? last : trip.endAt,
  };
  const ids = free.map((t) => t.id);
  const newcomers = tiles
    .filter((t) => within(wider, t.takenAt) && !within(trip, t.takenAt) && !ids.includes(t.id))
    .map((t) => t.id);
  return {
    kind: "add",
    trip,
    ids,
    draft: { name: trip.name, ...wider, excluded: [...leftOut(trip, tiles), ...newcomers] },
  };
}

/**
 * Photos further than this from a trip aren't offered for it: widening a trip by weeks to take
 * in a few photos would make it a different trip. Two weeks, in milliseconds.
 */
const ADD_REACH_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Trips near in time to some photos, nearest first, for adding them to one.
 * @param free - the photos
 * @param trips - every trip
 * @param limit - how many to give
 * @returns up to `limit` trips within two weeks of the photos
 */
export function nearestTrips(free: Tile[], trips: TripInfo[], limit: number): TripInfo[] {
  if (free.length === 0) return [];
  const taken = free.map((t) => t.takenAt).sort();
  const [first, last] = [taken[0], taken[taken.length - 1]];
  /**
   * Time between the photos and a trip; 0 when they share any of it.
   * @param trip - the trip
   * @returns the gap in milliseconds
   */
  const gap = (trip: TripInfo): number => {
    if (trip.endAt < first) return Date.parse(first) - Date.parse(trip.endAt);
    if (trip.startAt > last) return Date.parse(trip.startAt) - Date.parse(last);
    return 0;
  };
  return trips
    .filter((trip) => gap(trip) <= ADD_REACH_MS)
    .sort((a, b) => gap(a) - gap(b))
    .slice(0, limit);
}

/**
 * The result toast's first sentence once a change is made.
 * @param edit - the change
 * @returns e.g. "Took 2 photos out of Japan."
 */
export function editDone(edit: TripEdit): string {
  const photos = count(edit.ids.length, "photo", "photos");
  if (edit.kind === "remove") return `Took ${photos} out of ${edit.trip.name}.`;
  if (edit.kind === "put-back") return `Put ${photos} back in ${edit.trip.name}.`;
  return `Added ${photos} to ${edit.trip.name}.`;
}

/**
 * The menu or button label for a change.
 * @param edit - the change
 * @returns e.g. "Remove from Japan"
 */
export function editLabel(edit: TripEdit): string {
  if (edit.kind === "remove") return `Remove from ${edit.trip.name}`;
  if (edit.kind === "put-back") return `Put back in ${edit.trip.name}`;
  return `Add to ${edit.trip.name}`;
}
