// Trip form maths: turning a trip's first and last days into the inclusive range the backend
// stores, and back, plus the short range text and colour classes shared by every trip view.

import type { Tile, TripDraft, TripInfo } from "./api";

/** What the trip form edits. Dates are "YYYY-MM-DD"; a trip always takes in whole days. */
export interface TripForm {
  name: string;
  startDate: string;
  endDate: string;
}

/** A date range picked outside the Trips page (Library selection, a suggestion). */
export interface TripRange {
  startDate: string;
  endDate: string;
}

/** A new trip started outside the Trips page, to open in its editor. */
export interface TripStart {
  form: TripForm;
  /**
   * Ids of the photos picked in the Library, so the rest taken on those days start unticked.
   * Null ticks every photo from the dates.
   */
  picked: number[] | null;
}

export const EMPTY_FORM: TripForm = {
  name: "",
  startDate: "",
  endDate: "",
};

/**
 * Tailwind needs whole class names in the source, so each trip colour is spelt out.
 * Index 0 is unused: colours run 1 to 6 (trips.rs `colour`).
 */
const TAG_BG = ["bg-tag-1", "bg-tag-1", "bg-tag-2", "bg-tag-3", "bg-tag-4", "bg-tag-5", "bg-tag-6"];

/**
 * Background class for a trip colour.
 * @param colour - 1 to 6
 * @returns e.g. "bg-tag-3"
 */
export function tripBg(colour: number): string {
  return TAG_BG[colour] ?? TAG_BG[1];
}

/** Fixed English abbreviations, so the text matches the backend's on every locale. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Short date range, worded the same as `range_text` in trips.rs.
 * @param startAt - "YYYY-MM-DD..." start
 * @param endAt - "YYYY-MM-DD..." end
 * @returns e.g. "12 Mar 2025", "12-18 Mar 2025", "28 Feb - 3 Mar 2025",
 *   "30 Dec 2024 - 2 Jan 2025"
 */
export function rangeText(startAt: string, endAt: string): string {
  const [sy, sm, sd] = startAt.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = endAt.slice(0, 10).split("-").map(Number);
  const end = `${ed} ${MONTHS[em - 1]} ${ey}`;
  if (sy === ey && sm === em && sd === ed) return end;
  if (sy === ey && sm === em) return `${sd}-${end}`;
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} - ${end}`;
  return `${sd} ${MONTHS[sm - 1]} ${sy} - ${end}`;
}

/**
 * True when the form has both dates and the end isn't before the start.
 * @param form - the trip form
 * @returns whether the range can be checked against the library
 */
export function hasValidRange(form: TripForm): boolean {
  if (!form.startDate || !form.endDate) return false;
  const { startAt, endAt } = toDraft(form);
  return startAt <= endAt;
}

/**
 * The inclusive range the form describes: from the start of the first day to the last second of
 * the last.
 * @param form - the trip form
 * @returns the draft to send to the backend
 */
export function toDraft(form: TripForm): TripDraft {
  return {
    name: form.name.trim(),
    startAt: `${form.startDate}T00:00:00`,
    endAt: `${form.endDate}T23:59:59`,
  };
}

/**
 * The form for editing a saved trip. Only the days are kept, so a trip saved with times becomes
 * whole days once it's saved again.
 * @param trip - the saved trip
 * @returns the form values
 */
export function formFromTrip(trip: TripInfo): TripForm {
  return {
    name: trip.name,
    startDate: trip.startAt.slice(0, 10),
    endDate: trip.endAt.slice(0, 10),
  };
}

/**
 * The whole days spanned by some photos.
 * @param tiles - selected tiles (any order, at least one)
 * @returns first and last day
 */
export function rangeOfTiles(tiles: Tile[]): TripRange {
  const days = tiles.map((t) => t.takenAt.slice(0, 10)).sort();
  return { startDate: days[0], endDate: days[days.length - 1] };
}

/**
 * `count` items spread evenly through `items`, keeping the first and last when there's room.
 * @param items - the items, in order
 * @param count - how many to keep
 * @returns the kept items, in order
 */
export function spreadPick<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  if (count <= 1) return items.slice(0, Math.max(0, count));
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))],
  );
}
