// Back and forward through the places visited, the way a browser keeps its history. A place is a
// page and the Library's filter, which also holds the trip on show.

import { sameFilter, type LibraryFilter } from "./libraryFilter";

/** One place visited. */
export interface NavEntry<P extends string = string> {
  page: P;
  filter: LibraryFilter;
}

/** The places visited, oldest first, and which one is current. */
export interface NavHistory<P extends string = string> {
  entries: readonly NavEntry<P>[];
  at: number;
}

/** The most places kept; older ones drop off the back. */
export const HISTORY_LIMIT = 50;

/**
 * A history holding only the place the app starts at.
 * @param entry - the starting place
 * @returns the history
 */
export function startHistory<P extends string>(entry: NavEntry<P>): NavHistory<P> {
  return { entries: [entry], at: 0 };
}

/**
 * Whether two entries are the same place.
 * @param a - one entry
 * @param b - the other
 * @returns true for the same page and an equal filter
 */
export function sameEntry<P extends string>(a: NavEntry<P>, b: NavEntry<P>): boolean {
  return a.page === b.page && sameFilter(a.filter, b.filter);
}

/**
 * Whether there is a place to go back to.
 * @param history - the history
 * @returns true unless at the oldest entry
 */
export function canBack<P extends string>(history: NavHistory<P>): boolean {
  return history.at > 0;
}

/**
 * Whether there is a place to go forward to.
 * @param history - the history
 * @returns true unless at the newest entry
 */
export function canForward<P extends string>(history: NavHistory<P>): boolean {
  return history.at < history.entries.length - 1;
}

/**
 * The history with its current entry swapped for where the app is now, so a filter changed on
 * the page since the entry was made comes back as it was left.
 * @param history - the history
 * @param here - the place on show
 * @returns the entries with the current one replaced
 */
function withHere<P extends string>(history: NavHistory<P>, here: NavEntry<P>): NavEntry<P>[] {
  return history.entries.map((entry, i) => (i === history.at ? here : entry));
}

/**
 * Go somewhere new. The places ahead are dropped, as in a browser, unless the new place is
 * where the app already is, which adds nothing.
 * @param history - the history
 * @param here - the place on show, which becomes the current entry
 * @param next - the place being opened
 * @returns the history with `next` current
 */
export function pushEntry<P extends string>(
  history: NavHistory<P>,
  here: NavEntry<P>,
  next: NavEntry<P>,
): NavHistory<P> {
  const entries = withHere(history, here);
  if (sameEntry(here, next)) return { entries, at: history.at };
  const kept = [...entries.slice(0, history.at + 1), next].slice(-HISTORY_LIMIT);
  return { entries: kept, at: kept.length - 1 };
}

/**
 * Step back one place, if there is one.
 * @param history - the history
 * @param here - the place on show, kept so forward returns to it as it was left
 * @returns the history with the previous entry current
 */
export function stepBack<P extends string>(
  history: NavHistory<P>,
  here: NavEntry<P>,
): NavHistory<P> {
  return { entries: withHere(history, here), at: canBack(history) ? history.at - 1 : history.at };
}

/**
 * Step forward one place, if there is one.
 * @param history - the history
 * @param here - the place on show, kept so back returns to it as it was left
 * @returns the history with the next entry current
 */
export function stepForward<P extends string>(
  history: NavHistory<P>,
  here: NavEntry<P>,
): NavHistory<P> {
  return {
    entries: withHere(history, here),
    at: canForward(history) ? history.at + 1 : history.at,
  };
}
