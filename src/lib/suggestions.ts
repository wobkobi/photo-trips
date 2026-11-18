// Wording for the Suggestions page: why each suggestion was made and how home was found.

import type { Suggestion, Suggestions } from "./api";
import { count } from "./format";
import { EMPTY_FORM, type TripForm } from "./trips";

/** Matches AWAY_KM in suggest.rs. */
const AWAY_KM = 50;

/**
 * Identifies a suggestion across reloads: no two suggestions share a first and last day.
 * @param suggestion - the suggestion
 * @returns e.g. "2025-03-12|2025-03-18"
 */
export function suggestionKey(suggestion: Suggestion): string {
  return `${suggestion.startDay}|${suggestion.endDay}`;
}

/**
 * Days from the first to the last, both included. Parsed as UTC so a daylight saving change
 * inside the range can't shorten or lengthen a day.
 * @param startDay - "YYYY-MM-DD"
 * @param endDay - "YYYY-MM-DD"
 * @returns at least 1 for a valid range
 */
export function daysIn(startDay: string, endDay: string): number {
  const ms = Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${startDay}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Why a stretch of days was suggested: how many photos, and how far away it was.
 * @param suggestion - the suggestion
 * @returns e.g. "184 photos and videos over 6 days. 4 of the days were about 2,150 km from home."
 */
export function reasonText(suggestion: Suggestion): string {
  const days = daysIn(suggestion.startDay, suggestion.endDay);
  const files = count(suggestion.files, "photo or video", "photos and videos");
  const { awayDays, awayKm } = suggestion;
  const far = `about ${count(awayKm ?? 0, "km", "km")} from home.`;
  if (days === 1) return awayKm === null ? `${files} in one day.` : `${files} in one day, ${far}`;
  const photos = `${files} over ${days} days.`;
  if (awayDays === 0 || awayKm === null) return photos;
  if (awayDays >= days) return `${photos} All ${days} days were ${far}`;
  if (awayDays === 1) return `${photos} 1 of the days was ${far}`;
  return `${photos} ${awayDays} of the days were ${far}`;
}

/**
 * How suggestions were found, in one line: what makes a day busy, and where home is.
 * @param found - the settings and home the suggestions came from
 * @returns one sentence
 */
export function howFound(found: Pick<Suggestions, "home" | "minPhotos" | "located">): string {
  const busy = `Made from busy days (${found.minPhotos.toLocaleString("en-NZ")} or more photos and videos)`;
  const away = `${busy} and days more than ${AWAY_KM} km from home`;
  const { home } = found;
  if (home?.set) return `${away}, set in Settings${home.place ? ` near ${home.place}` : ""}.`;
  if (home) {
    return home.place
      ? `${away}, which looks to be near ${home.place}.`
      : `${away}, worked out from your photos.`;
  }
  if (found.located === 0) return `${busy}, as none of the photos have a location.`;
  return `${busy}, as too few photos have a location to find home.`;
}

/**
 * The trip form a suggestion starts as: its name and whole days.
 * @param suggestion - the suggestion
 * @returns the form values
 */
export function formFromSuggestion(suggestion: Suggestion): TripForm {
  return {
    ...EMPTY_FORM,
    name: suggestion.name,
    startDate: suggestion.startDay,
    endDate: suggestion.endDay,
  };
}
