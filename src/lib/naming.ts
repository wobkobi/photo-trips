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
 * A trip's folder, before any clash number.
 * @param style - trip folder preset
 * @param start - "YYYY-MM-DD..." first day of the trip
 * @param name - the trip's name
 * @returns e.g. "Trips\Japan 2026"
 */
export function tripFolder(style: Naming["trips"], start: string, name: string): string {
  const year = start.slice(0, 4);
  const folder =
    style === "name-year"
      ? `${name} ${year}`
      : style === "year-name"
        ? `${year} ${name}`
        : `${start.slice(0, 10)} ${name}`;
  return `Trips\\${folder}`;
}
