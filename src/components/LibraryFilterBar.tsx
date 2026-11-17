import { useMemo, type ReactElement, type ReactNode } from "react";
import type { Tile } from "../lib/api";
import { filterChoices, isFiltered, NO_FILTER, type LibraryFilter } from "../lib/libraryFilter";
import { Icon } from "./Icon";
import { Button } from "./ui";

/** A compact drop-down, styled to sit in a toolbar. */
const SELECT =
  "min-h-9 rounded-md border border-line-strong/60 bg-raised px-2 py-1 text-[14px] text-ink hover:border-line-strong";

/**
 * A toolbar control with its name to its left.
 * @param props - Component props.
 * @param props.label - what the control is for
 * @param props.children - the control
 * @returns the label wrapping both
 */
function Inline({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex items-center gap-2 text-[14px] text-faint">
      {label}
      {children}
    </label>
  );
}

/**
 * The menus above the Library timeline that narrow it to a trip, a year, photos or videos, or
 * dates that may be wrong, and a box for finding files by name. Menus with only one sensible
 * choice are left out.
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
      aria-label="Filters"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface px-5 py-1.5"
    >
      <input
        type="search"
        value={filter.name}
        onChange={(e) => onChange({ ...filter, name: e.target.value })}
        placeholder="File name"
        aria-label="Find by file name"
        spellCheck={false}
        className={`${SELECT} w-40 placeholder:text-faint`}
      />
      {(choices.trips.length > 0 || filter.trip !== "any") && (
        <Inline label="Trip">
          <select
            value={tripValue}
            onChange={(e) => chooseTrip(e.target.value)}
            className={`${SELECT} max-w-60`}
          >
            <option value="any">All</option>
            <option value="none">No trip</option>
            {choices.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name}
              </option>
            ))}
          </select>
        </Inline>
      )}
      {(choices.years.length > 1 || filter.year !== "any") && (
        <Inline label="Year">
          <select
            value={filter.year}
            onChange={(e) => onChange({ ...filter, year: e.target.value })}
            className={SELECT}
          >
            <option value="any">All</option>
            {choices.years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </Inline>
      )}
      {(choices.videos || filter.kind !== "all") && (
        <Inline label="Type">
          <select
            value={filter.kind}
            onChange={(e) => onChange({ ...filter, kind: e.target.value as LibraryFilter["kind"] })}
            className={SELECT}
          >
            <option value="all">All</option>
            <option value="photos">Photos</option>
            <option value="videos">Videos</option>
          </select>
        </Inline>
      )}
      {(choices.uncertain || filter.uncertain) && (
        <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[14px] text-muted">
          <input
            type="checkbox"
            checked={filter.uncertain}
            onChange={(e) => onChange({ ...filter, uncertain: e.target.checked })}
            className="size-4 accent-accent"
          />
          Uncertain dates
        </label>
      )}
      {isFiltered(filter) && (
        <Button variant="ghost" className="ml-auto" onClick={() => onChange(NO_FILTER)}>
          <Icon name="close" size={16} />
          Clear filters
        </Button>
      )}
    </div>
  );
}
