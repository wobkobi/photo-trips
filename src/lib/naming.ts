// Folder name presets, worded the same as naming.rs, so Settings can show what each choice
// makes before anything is renamed.

import type { Naming, Settings } from "./api";

/** Fixed English month names, matching the folders the backend makes on every PC. */
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const MONTH_STYLES: Naming["months"][] = ["year-month", "number-name", "name-year"];
export const TRIP_STYLES: Naming["trips"][] = ["date-name", "name-year", "year-name"];

export const DEFAULT_NAMING: Naming = { months: "year-month", trips: "date-name" };

/**
 * The saved presets. Anything missing or unknown reads as the default, as in naming.rs.
 * @param settings - all settings, or null while loading
 * @returns the presets in use
 */
export function namingOf(settings: Settings | null): Naming {
  const months = settings?.month_folders as Naming["months"] | undefined;
  const trips = settings?.trip_folders as Naming["trips"] | undefined;
  return {
    months: months && MONTH_STYLES.includes(months) ? months : DEFAULT_NAMING.months,
    trips: trips && TRIP_STYLES.includes(trips) ? trips : DEFAULT_NAMING.trips,
  };
}

/**
 * The month folder for a date, inside its year folder.
 * @param style - month folder preset
 * @param date - "YYYY-MM-DD..." taken date
 * @returns e.g. "2026\03 March"
 */
export function monthFolder(style: Naming["months"], date: string): string {
  const year = date.slice(0, 4);
  const month = date.slice(5, 7);
  const name = MONTHS[Number(month) - 1];
  const folder =
    style === "number-name"
      ? `${month} ${name}`
      : style === "name-year"
        ? `${name} ${year}`
        : `${year}-${month}`;
  return `${year}\\${folder}`;
}

/**
 * A trip's folder name inside Trips, before any clash number, as naming.rs makes it. A trip over
 * New Year gives both years ("Tairua 2025-26"), so a trip taken every summer gets a folder of its
 * own each time.
 * @param style - trip folder preset
 * @param start - "YYYY-MM-DD..." first day of the trip
 * @param name - the trip's name
 * @param end - "YYYY-MM-DD..." last day of the trip, the first day when left out
 * @returns e.g. "Japan 2026"
 */
export function tripTitle(
  style: Naming["trips"],
  start: string,
  name: string,
  end: string = start,
): string {
  const [first, last] = [start.slice(0, 4), end.slice(0, 4)];
  const years = last > first ? `${first}-${last.slice(2)}` : first;
  if (style === "name-year") return `${name} ${years}`;
  if (style === "year-name") return `${years} ${name}`;
  return `${start.slice(0, 10)} ${name}`;
}

/**
 * A trip's folder, before any clash number.
 * @param style - trip folder preset
 * @param start - "YYYY-MM-DD..." first day of the trip
 * @param name - the trip's name
 * @param end - "YYYY-MM-DD..." last day of the trip, the first day when left out
 * @returns e.g. "Trips\Japan 2026"
 */
export function tripFolder(
  style: Naming["trips"],
  start: string,
  name: string,
  end: string = start,
): string {
  return `Trips\\${tripTitle(style, start, name, end)}`;
}
