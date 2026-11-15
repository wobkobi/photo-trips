import { useMemo, type ReactElement } from "react";
import type { Tile } from "../lib/api";
import { filterChoices, isFiltered, NO_FILTER, type LibraryFilter } from "../lib/libraryFilter";
import { Field, INPUT } from "./Field";
import { Icon } from "./Icon";
import { Button } from "./ui";

/**
 * The menus above the Library timeline that narrow it to a trip, a year, photos or videos, or
 * dates that may be wrong. Menus with only one sensible choice are left out.
 * @param props - Component props.
 * @param props.tiles - every tile in the library, newest first
 * @param props.filter - the current filter
 * @param props.onChange - called with the new filter
 * @returns the bar
 */
export function LibraryFilterBar({
  tiles,
  filter,
  onChange,
}: {
  tiles: Tile[];
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
}): ReactElement {
  const choices = useMemo(() => filterChoices(tiles, filter), [tiles, filter]);
  const tripValue = typeof filter.trip === "object" ? String(filter.trip.id) : filter.trip;

  /**
   * Apply the trip menu's choice. A trip id that no longer matches a trip falls back to "any".
   * @param value - "any", "none", or a trip's id as a string
   */
  function chooseTrip(value: string): void {
    if (value === "any" || value === "none") onChange({ ...filter, trip: value });
    else onChange({ ...filter, trip: choices.trips.find((t) => String(t.id) === value) ?? "any" });
  }

  return (
    <div
      role="group"
      aria-label="Show only some photos"
      className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-line px-8 py-4"
    >
      {(choices.trips.length > 0 || filter.trip !== "any") && (
        <Field label="Trip">
          <select
            value={tripValue}
            onChange={(e) => chooseTrip(e.target.value)}
            className={`${INPUT} max-w-72`}
          >
            <option value="any">Any trip or none</option>
            <option value="none">Not on a trip</option>
            {choices.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(choices.years.length > 1 || filter.year !== "any") && (
        <Field label="Year">
          <select
            value={filter.year}
            onChange={(e) => onChange({ ...filter, year: e.target.value })}
            className={INPUT}
          >
            <option value="any">Every year</option>
            {choices.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(choices.videos || filter.kind !== "all") && (
        <Field label="Type">
          <select
            value={filter.kind}
            onChange={(e) => onChange({ ...filter, kind: e.target.value as LibraryFilter["kind"] })}
            className={INPUT}
          >
            <option value="all">Photos and videos</option>
            <option value="photos">Photos only</option>
            <option value="videos">Videos only</option>
          </select>
        </Field>
      )}
      {(choices.uncertain || filter.uncertain) && (
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[16px]">
          <input
            type="checkbox"
            checked={filter.uncertain}
            onChange={(e) => onChange({ ...filter, uncertain: e.target.checked })}
            className="size-5 accent-brand"
          />
          Only dates that may be wrong
        </label>
      )}
      {isFiltered(filter) && (
        <Button variant="ghost" onClick={() => onChange(NO_FILTER)}>
          <Icon name="close" size={16} />
          Show everything
        </Button>
      )}
    </div>
  );
}
