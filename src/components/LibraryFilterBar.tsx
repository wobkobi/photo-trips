import { useMemo, type ReactElement, type ReactNode, type RefObject } from "react";
import type { Tile } from "../lib/api";
import {
  clearFilters,
  filterChoices,
  isFilteredBesidesTrip,
  tripOf,
  type LibraryFilter,
} from "../lib/libraryFilter";
import { Icon } from "./Icon";
import { Button } from "./ui";

/** A compact drop-down, styled to sit in a toolbar. */
const SELECT =
  "min-h-8.5 rounded-md border border-line-strong/60 bg-raised px-2 py-1 text-[14px] text-ink hover:border-line-strong";

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
 * The menus above the Library timeline that narrow it to a year, photos or videos, photos on no
 * trip, or dates that may be wrong, and a box for finding files by name. Menus with only one
 * sensible choice are left out. A trip is a place rather than a filter here: Clear filters keeps
 * it, and "Not on a trip" isn't offered inside one.
 * @param props - Component props.
 * @param props.tiles - every tile on show (the library's, or the open trip's), newest first
 * @param props.filter - the current filter
 * @param props.onChange - called with the new filter
 * @param props.searchBox - set to the file name box, so Find (Ctrl+F) can focus it
 * @returns the bar
 */
export function LibraryFilterBar({
  tiles,
  filter,
  onChange,
  searchBox,
}: {
  tiles: Tile[];
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
  searchBox?: RefObject<HTMLInputElement | null>;
}): ReactElement {
  const choices = useMemo(() => filterChoices(tiles, filter), [tiles, filter]);

  return (
    <div
      role="group"
      aria-label="Filters"
      className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-surface px-5 py-1.5"
    >
      <input
        ref={searchBox}
        type="search"
        value={filter.name}
        onChange={(e) => onChange({ ...filter, name: e.target.value })}
        placeholder="File name"
        aria-label="Find by file name"
        spellCheck={false}
        className={`${SELECT} w-40 placeholder:text-faint`}
      />
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
        <label className="flex min-h-8.5 cursor-pointer items-center gap-2 text-[14px] text-muted">
          <input
            type="checkbox"
            checked={filter.uncertain}
            onChange={(e) => onChange({ ...filter, uncertain: e.target.checked })}
            className="size-4 accent-accent"
          />
          Uncertain dates
        </label>
      )}
      {tripOf(filter) === null && (choices.onTrip || filter.trip === "none") && (
        <label className="flex min-h-8.5 cursor-pointer items-center gap-2 text-[14px] text-muted">
          <input
            type="checkbox"
            checked={filter.trip === "none"}
            onChange={(e) => onChange({ ...filter, trip: e.target.checked ? "none" : "any" })}
            className="size-4 accent-accent"
          />
          Not on a trip
        </label>
      )}
      {isFilteredBesidesTrip(filter) && (
        <Button variant="ghost" className="ml-auto" onClick={() => onChange(clearFilters(filter))}>
          <Icon name="close" size={16} />
          Clear filters
        </Button>
      )}
    </div>
  );
}
