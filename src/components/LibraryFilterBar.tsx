import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from "react";
import type { Tile } from "../lib/api";
import {
  activeChips,
  clearFilters,
  filterChoices,
  popoverFilterCount,
  tripOf,
  type LibraryFilter,
} from "../lib/libraryFilter";
import { Icon } from "./Icon";
import { Button } from "./ui";

const KINDS: { value: LibraryFilter["kind"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
];

/**
 * The Library toolbar's filters: a search box for file names, All / Photos / Videos, and a Filter
 * button whose popover holds the year, uncertain dates and "Not on a trip". Controls with only one
 * sensible choice are left out. A trip is a place rather than a filter here, so "Not on a trip"
 * isn't offered inside one.
 * @param props - Component props.
 * @param props.tiles - every tile on show (the library's, or the open trip's), newest first
 * @param props.filter - the current filter
 * @param props.onChange - called with the new filter
 * @param props.searchBox - set to the search box, so Find (Ctrl+F) can focus it
 * @returns the controls, to sit among the page header's actions
 */
export function LibraryFilterControls({
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
  const showYears = choices.years.length > 1 || filter.year !== "any";
  const showUncertain = choices.uncertain || filter.uncertain;
  const showNoTrip = tripOf(filter) === null && (choices.onTrip || filter.trip === "none");

  return (
    <>
      <div className="relative flex items-center">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-2.5 text-faint"
        />
        <input
          ref={searchBox}
          type="search"
          value={filter.name}
          onChange={(e) => onChange({ ...filter, name: e.target.value })}
          placeholder="Search"
          aria-label="Search by file name"
          title="Search by file name (Ctrl+F)"
          spellCheck={false}
          className="min-h-8.5 w-44 rounded-md border border-line-strong/60 bg-raised py-1 pr-2 pl-8 text-[15px] text-ink placeholder:text-faint hover:border-line-strong"
        />
      </div>
      {(choices.videos || filter.kind !== "all") && (
        <KindControl value={filter.kind} onChange={(kind) => onChange({ ...filter, kind })} />
      )}
      {(showYears || showUncertain || showNoTrip) && (
        <FilterPopover
          filter={filter}
          onChange={onChange}
          years={showYears ? choices.years : null}
          uncertain={showUncertain}
          noTrip={showNoTrip}
        />
      )}
    </>
  );
}

/**
 * All / Photos / Videos as one segmented control. Arrow keys step along it, stopping at the ends.
 * @param props - Component props.
 * @param props.value - the kind on show
 * @param props.onChange - called with the kind picked
 * @returns the control
 */
function KindControl({
  value,
  onChange,
}: {
  value: LibraryFilter["kind"];
  onChange: (value: LibraryFilter["kind"]) => void;
}): ReactElement {
  /**
   * Arrow keys pick the next kind along and move focus with it.
   * @param event - the key press on the group
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Alt+arrows are the app's Back and Forward.
    if (event.altKey) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const now = KINDS.findIndex((kind) => kind.value === value);
    const at = Math.max(0, Math.min(KINDS.length - 1, now + step));
    onChange(KINDS[at].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[at]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Show"
      onKeyDown={onKeyDown}
      className="flex items-center rounded-md border border-line-strong/60"
    >
      {KINDS.map((kind) => {
        const chosen = kind.value === value;
        return (
          <button
            key={kind.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(kind.value)}
            className={`h-8 rounded-[5px] px-3 text-[15px] font-semibold transition-colors ${
              chosen ? "bg-line text-ink" : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            {kind.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The Filter button and its popover: a small panel under the button, not modal, that closes on
 * Escape, a click outside it, or a pick. The button counts the popover's filters in use.
 *
 * Escape inside it closes only the popover: the key is marked handled and stopped here, so the
 * header's back arrow doesn't also leave a trip, and the panel's role="dialog" keeps the Library's
 * Escape-clears-the-selection away from it.
 * @param props - Component props.
 * @param props.filter - the current filter
 * @param props.onChange - called with the new filter
 * @param props.years - the years to offer, newest first, or null to leave the year out
 * @param props.uncertain - whether to offer "Uncertain dates"
 * @param props.noTrip - whether to offer "Not on a trip"
 * @returns the button, with the panel when open
 */
function FilterPopover({
  filter,
  onChange,
  years,
  uncertain,
  noTrip,
}: {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
  years: string[] | null;
  uncertain: boolean;
  noTrip: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const count = popoverFilterCount(filter);

  // Focus moves into the panel as it opens, onto the year picked if there is one.
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    (first ?? panel.current?.querySelector<HTMLElement>("button, input"))?.focus();
    /**
     * Close on a mouse press outside the button and panel.
     * @param event - the window's mousedown
     */
    const away = (event: MouseEvent): void => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [open]);

  /**
   * Apply a choice and close, handing focus back to the button.
   * @param next - the filter picked
   */
  function pick(next: LibraryFilter): void {
    onChange(next);
    setOpen(false);
    button.current?.focus();
  }

  /**
   * Escape closes the open popover and nothing else.
   * @param event - a key press on the button or inside the panel
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  }

  return (
    <div ref={wrap} className="relative" onKeyDown={onKeyDown}>
      <Button
        ref={button}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count > 0 ? `Filter, ${count} on` : "Filter"}
        onClick={() => setOpen((was) => !was)}
        className={count > 0 ? "border-accent/70!" : ""}
      >
        <Icon name="filter" size={18} />
        Filter
        {count > 0 && (
          <span className="-mr-1 min-w-5 rounded-full bg-accent px-1.5 text-[13px] leading-5 text-surface">
            {count}
          </span>
        )}
      </Button>
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="Filters"
          className="absolute top-full right-0 z-30 mt-1.5 flex w-64 flex-col gap-3 rounded-md border border-line bg-surface p-3 shadow-lg shadow-black/50"
        >
          {years && (
            <div role="group" aria-label="Year">
              <p className="mb-1.5 text-[13px] font-semibold text-faint">Year</p>
              <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                {["any", ...years].map((year) => {
                  const chosen = filter.year === year;
                  return (
                    <button
                      key={year}
                      type="button"
                      aria-pressed={chosen}
                      onClick={() => pick({ ...filter, year })}
                      className={`min-h-8 px-2.5 text-[15px] transition-colors ${
                        chosen
                          ? "bg-line font-semibold text-ink"
                          : "text-muted hover:bg-raised hover:text-ink"
                      }`}
                    >
                      {year === "any" ? "All" : year}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {uncertain && (
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[15px] text-ink">
              <input
                type="checkbox"
                checked={filter.uncertain}
                onChange={(e) => pick({ ...filter, uncertain: e.target.checked })}
                className="size-4 accent-accent"
              />
              Uncertain dates
            </label>
          )}
          {noTrip && (
            <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[15px] text-ink">
              <input
                type="checkbox"
                checked={filter.trip === "none"}
                onChange={(e) => pick({ ...filter, trip: e.target.checked ? "none" : "any" })}
                className="size-4 accent-accent"
              />
              Not on a trip
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A slim row under the toolbar with a chip for each filter in use besides the trip on show and the
 * file name, each with its own remove button, and Clear filters. Nothing shows while none are on.
 * @param props - Component props.
 * @param props.filter - the current filter
 * @param props.onChange - called with the new filter
 * @returns the row, or null with no chips to show
 */
export function LibraryFilterChips({
  filter,
  onChange,
}: {
  filter: LibraryFilter;
  onChange: (filter: LibraryFilter) => void;
}): ReactElement | null {
  const chips = activeChips(filter);
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Filters on"
      className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-5 py-1.5"
    >
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line-strong/60 bg-raised pr-1 pl-3 text-[14px] text-ink"
        >
          {chip.label}
          <button
            type="button"
            onClick={() => onChange(chip.without)}
            aria-label={`Remove ${chip.label}`}
            title="Remove"
            className="inline-flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-line hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      <Button
        variant="ghost"
        className="min-h-7! py-0.5"
        onClick={() => onChange(clearFilters(filter))}
      >
        Clear filters
      </Button>
    </div>
  );
}
