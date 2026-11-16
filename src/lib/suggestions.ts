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
 * How suggestions were found: what makes a day busy, and where home is.
 * @param found - the settings and home the suggestions came from
 * @returns two or three sentences
 */
export function howFound(found: Pick<Suggestions, "home" | "minPhotos" | "located">): string {
  const busy =
    `A day with ${found.minPhotos.toLocaleString("en-NZ")} or more photos and videos counts as busy. ` +
    "Two or more busy days in a row make a suggestion, even with a quiet day between them.";
  const away =
    `A day spent more than ${AWAY_KM} km from home counts as well, however few photos it has, ` +
    "and a busy one makes a suggestion on its own as a day trip. Busy days at home don't count.";
  const { home } = found;
  if (home?.set) {
    const near = home.place ? `, near ${home.place}` : "";
    return `${busy} Home is set in Settings${near}. ${away}`;
  }
  if (home) {
    const where = home.place ? `near ${home.place}, ` : "";
    return `${busy} Home looks to be ${where}where photos were taken on the most days. ${away}`;
  }
  if (found.located === 0) {
    return `${busy} None of the photos have a location, so only busy days count.`;
  }
  return `${busy} Too few photos have a location to tell where home is, so only busy days count.`;
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
