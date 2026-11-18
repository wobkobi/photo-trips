import { describe, expect, it } from "vitest";
import { NO_FILTER } from "./libraryFilter";
import {
  backReturnsTo,
  canBack,
  canForward,
  HISTORY_LIMIT,
  pushEntry,
  startHistory,
  stepBack,
  stepForward,
  type NavEntry,
  type NavHistory,
} from "./navHistory";

/**
 * A place with no filter, or with the given one.
 * @param page - the page
 * @param filter - parts of the filter to set
 * @returns the entry
 */
function place(page: string, filter: Partial<NavEntry["filter"]> = {}): NavEntry {
  return { page, filter: { ...NO_FILTER, ...filter } };
}

/**
 * The current entry.
 * @param history - the history
 * @returns the entry at `at`
 */
const current = (history: NavHistory): NavEntry => history.entries[history.at];

/**
 * A history built by opening each page in turn from the library.
 * @param pages - pages opened after the library, in order
 * @returns the history, at the last page
 */
function visit(...pages: string[]): NavHistory {
  let history = startHistory(place("library"));
  for (const page of pages) history = pushEntry(history, current(history), place(page));
  return history;
}

describe("navHistory", () => {
  it("starts with nowhere to go", () => {
    const history = startHistory(place("library"));
    expect(canBack(history)).toBe(false);
    expect(canForward(history)).toBe(false);
  });

  it("goes back and forward through the places opened", () => {
    let history = visit("trips", "import");
    expect(current(history).page).toBe("import");
    history = stepBack(history, current(history));
    expect(current(history).page).toBe("trips");
    history = stepBack(history, current(history));
    expect(current(history).page).toBe("library");
    expect(canBack(history)).toBe(false);
    history = stepForward(history, current(history));
    expect(current(history).page).toBe("trips");
    expect(canForward(history)).toBe(true);
  });

  it("stays put at either end", () => {
    const start = startHistory(place("library"));
    expect(stepBack(start, place("library")).at).toBe(0);
    expect(stepForward(start, place("library")).at).toBe(0);
  });

  it("drops the places ahead when going somewhere new", () => {
    let history = visit("trips", "import");
    history = stepBack(history, current(history));
    history = pushEntry(history, current(history), place("help"));
    expect(history.entries.map((entry) => entry.page)).toEqual(["library", "trips", "help"]);
    expect(canForward(history)).toBe(false);
  });

  it("adds nothing for the place already on show, and keeps the places ahead", () => {
    let history = visit("trips", "import");
    history = stepBack(history, current(history));
    history = pushEntry(history, current(history), place("trips"));
    expect(history.entries).toHaveLength(3);
    expect(current(history).page).toBe("trips");
    expect(canForward(history)).toBe(true);
  });

  it("counts a different filter on the same page as a new place", () => {
    let history = startHistory(place("library"));
    history = pushEntry(
      history,
      current(history),
      place("library", { trip: { id: 1, name: "A" } }),
    );
    expect(history.entries).toHaveLength(2);
  });

  it("remembers a filter changed on the page before leaving it", () => {
    let history = startHistory(place("library"));
    const narrowed = place("library", { year: "2024" });
    history = pushEntry(history, narrowed, place("trips"));
    history = stepBack(history, current(history));
    expect(current(history)).toEqual(narrowed);
  });

  it("keeps where a trip's Back returns to through back and forward", () => {
    const inTrip: NavEntry = { ...place("library", { trip: { id: 1, name: "A" } }), from: "trips" };
    let history = pushEntry(visit("trips"), place("trips"), inTrip);
    history = stepBack(history, inTrip);
    history = stepForward(history, current(history));
    expect(current(history).from).toBe("trips");
  });

  it("counts places differing only in where a trip's Back goes as the same", () => {
    const trip = { trip: { id: 1, name: "A" } };
    let history = pushEntry(startHistory(place("trips")), place("trips"), {
      ...place("library", trip),
      from: "trips",
    });
    history = pushEntry(history, current(history), { ...place("library", trip), from: "help" });
    expect(history.entries).toHaveLength(2);
  });

  it("goes back from a trip only to the page it was opened from, with no trip on show", () => {
    const trip = place("library", { trip: { id: 1, name: "A" } });
    const fromTrips = pushEntry(visit("trips"), place("trips"), trip);
    expect(backReturnsTo(fromTrips, "trips")).toBe(true);
    expect(backReturnsTo(fromTrips, "library")).toBe(false);
    const fromTrip = pushEntry(
      startHistory(place("library", { trip: { id: 2, name: "B" } })),
      place("library", { trip: { id: 2, name: "B" } }),
      trip,
    );
    expect(backReturnsTo(fromTrip, "library")).toBe(false);
    expect(backReturnsTo(startHistory(trip), "library")).toBe(false);
  });

  it("keeps only the newest places", () => {
    const pages = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => `page${i}`);
    const history = visit(...pages);
    expect(history.entries).toHaveLength(HISTORY_LIMIT);
    expect(history.at).toBe(HISTORY_LIMIT - 1);
    expect(current(history).page).toBe(pages[pages.length - 1]);
    expect(history.entries[0].page).toBe(pages[10]);
  });
});
