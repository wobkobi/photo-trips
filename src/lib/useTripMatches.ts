import { useEffect, useState } from "react";
import { api, errorText, type TripMatches } from "./api";
import { hasValidRange, toDraft, type TripForm } from "./trips";

/** Wait this long after the last keystroke before counting matching photos. */
const MATCH_DELAY_MS = 250;

/**
 * The photos a form's dates take in, refreshed shortly after the dates change.
 * @param form - the trip form
 * @param editing - id of the trip being edited, so its own dates don't count as an overlap
 * @returns the matches, or null while counting or when the dates are incomplete
 */
export function useTripMatches(form: TripForm, editing: number | null): TripMatches | null {
  const [matches, setMatches] = useState<{ key: string; value: TripMatches } | null>(null);
  const valid = hasValidRange(form);
  const { startAt, endAt } = toDraft(form);
  const key = `${startAt}|${endAt}|${editing}`;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api.tripMatches(startAt, endAt, editing).then(
        (value) => {
          if (live) setMatches({ key, value });
        },
        (err) => {
          if (live) setMatches({ key, value: { tiles: [], problem: errorText(err) } });
        },
      );
    }, MATCH_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [valid, startAt, endAt, editing, key]);

  return matches?.key === key ? matches.value : null;
}
