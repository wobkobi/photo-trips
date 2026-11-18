import { useMemo, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { api, type TripInfo } from "../lib/api";
import { folderName } from "../lib/format";
import { tripOf, type FilterTrip } from "../lib/libraryFilter";
import { rangeText, sidebarTrips, tripBg } from "../lib/trips";
import { useLibrary } from "../lib/useLibrary";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useUpdates } from "../lib/useUpdates";
import { Icon, type IconName } from "./Icon";
import { JobStatus } from "./JobStatus";

interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
}

const LIBRARY: NavItem = { id: "library", label: "Library", icon: "library" };
const TRIPS: NavItem = { id: "trips", label: "Trips", icon: "trips" };
const TOOLS: NavItem[] = [
  { id: "import", label: "Import", icon: "import" },
  { id: "sort", label: "Sort", icon: "sort" },
  { id: "suggestions", label: "Suggestions", icon: "suggest" },
  { id: "duplicates", label: "Duplicates", icon: "duplicates" },
];
const FOOTER: NavItem[] = [
  { id: "history", label: "History", icon: "history" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help", label: "Help", icon: "help" },
];

/**
 * Most trips listed under Trips. Five about fill the app's 600px minimum window height with the
 * tools below; on anything shorter (a running job, a larger text size) the trip rows scroll on
 * their own, so the tools stay in view.
 */
const TRIP_ROWS = 5;

/**
 * Below this width (in CSS pixels, so a larger text size reaches it sooner) the menu goes narrow
 * on its own, leaving the page at least about 560px.
 */
const CRAMPED = "(max-width: 800px)";

/** The active row's moonstone rule on its left edge; a pseudo-element, so the label doesn't shift. */
const CURRENT_ROW =
  "bg-raised font-semibold text-ink before:absolute before:inset-y-2.5 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-accent";
const OTHER_ROW = "text-muted hover:bg-raised/60 hover:text-ink";

/**
 * The menu down the left of the window, with the button that narrows it at the top. Library
 * comes first, then Trips with the newest trips listed under it, then the tools; History,
 * Settings and Help sit as small buttons in the footer. Narrow, it shows only icons, each named in
 * a tooltip and to screen readers, and leaves out the trip rows, so the pages get more room. The
 * app's name isn't repeated here; the title bar already shows it.
 *
 * The menu is narrow when the saved choice says so, or when the window is cramped. While cramped,
 * widening it lasts until the window has room again and isn't saved, since the saved choice is
 * about roomy windows.
 * @param props - Component props.
 * @param props.page - the page on show
 * @param props.onPage - switch page
 * @param props.onShowTrip - show one trip in the Library
 * @param props.libraryRoot - the library folder's full path
 * @param props.narrow - the saved choice to show icons only
 * @param props.onNarrow - called with the new width choice to save
 * @param props.highlight - a page the tour is pointing at, ringed so it stands out
 * @returns the sidebar
 */
export function Sidebar({
  page,
  onPage,
  onShowTrip,
  libraryRoot,
  narrow,
  onNarrow,
  highlight = null,
}: {
  page: PageId;
  onPage: (page: PageId) => void;
  onShowTrip: (trip: FilterTrip) => void;
  libraryRoot: string;
  narrow: boolean;
  onNarrow: (narrow: boolean) => void;
  highlight?: PageId | null;
}): ReactElement {
  const folder = folderName(libraryRoot);
  const cramped = useMediaQuery(CRAMPED);
  const [widened, setWidened] = useState(false);
  // Forget a temporary widening once the window has room, so the next squeeze narrows it again.
  const [wasCramped, setWasCramped] = useState(cramped);
  if (cramped !== wasCramped) {
    setWasCramped(cramped);
    setWidened(false);
  }
  const iconsOnly = narrow || (cramped && !widened);

  const { trips, filter } = useLibrary();
  // The Library is a trip's page while its filter holds one; that trip's row is then the current
  // one rather than Library's.
  const shownId = page === "library" ? (tripOf(filter)?.id ?? null) : null;
  const { rows, hidden } = useMemo(() => sidebarTrips(trips, shownId, TRIP_ROWS), [trips, shownId]);
  /** Show labels: clear the saved narrow choice, or widen just while the window is cramped. */
  function widen(): void {
    if (narrow) onNarrow(false);
    if (cramped) setWidened(true);
  }

  /** Go back to icons only, saving the choice unless the window is cramped anyway. */
  function narrowIt(): void {
    setWidened(false);
    if (!cramped) onNarrow(true);
  }

  return (
    // Only the page list scrolls, so the job status and its Stop button stay in view on a short
    // window.
    <nav
      aria-label="Pages"
      className={`flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface px-2 pb-3 transition-[width] duration-200 ease-out motion-reduce:transition-none ${
        iconsOnly ? "w-16" : "w-52"
      }`}
    >
      {/* Every icon keeps its size and place in both widths, so narrowing slides the menu shut
          rather than jumping its icons to the middle. */}
      <div className="flex shrink-0 pt-2 pb-1">
        <button
          type="button"
          onClick={iconsOnly ? widen : narrowIt}
          title={iconsOnly ? "Widen the menu" : "Narrow the menu"}
          aria-label={iconsOnly ? "Widen the menu" : "Narrow the menu"}
          aria-expanded={!iconsOnly}
          className="flex min-h-8.5 items-center px-3.75 text-faint hover:bg-raised/60 hover:text-ink"
        >
          <Icon name="panel" size={18} className="shrink-0" />
        </button>
      </div>
      {/* The side padding moves inside the scroller, so focus rings aren't clipped by it. */}
      <ul className="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2 py-1">
        <li className="shrink-0">
          <PageRow
            item={LIBRARY}
            // The narrow menu has no trip rows, so inside a trip the Library is what's current.
            current={page === "library" && (shownId === null || iconsOnly)}
            iconsOnly={iconsOnly}
            highlight={highlight}
            onPage={onPage}
          />
        </li>
        {/* The one item allowed to shrink: on a short window its trip rows scroll inside it
            before the tools below can be pushed out of view. */}
        <li className="flex min-h-0 flex-col gap-0.5">
          <PageRow
            item={TRIPS}
            current={page === "trips"}
            iconsOnly={iconsOnly}
            highlight={highlight}
            onPage={onPage}
          />
          {!iconsOnly && rows.length > 0 && (
            <ul
              aria-label="Trips"
              className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 py-0.5"
            >
              {rows.map((trip) => (
                <li key={trip.id} className="shrink-0">
                  <TripRow
                    trip={trip}
                    current={trip.id === shownId}
                    onShow={() => onShowTrip({ id: trip.id, name: trip.name })}
                  />
                </li>
              ))}
              {hidden > 0 && (
                <li className="shrink-0">
                  <button
                    type="button"
                    onClick={() => onPage("trips")}
                    className={`flex min-h-7.5 w-full items-center pr-2.5 pl-10 text-left text-[14px] ${OTHER_ROW}`}
                  >
                    All trips
                  </button>
                </li>
              )}
            </ul>
          )}
        </li>
        {TOOLS.map((item, i) => (
          <li
            key={item.id}
            className={`shrink-0 ${i === 0 ? "mt-1 border-t border-line pt-1.5" : ""}`}
          >
            <PageRow
              item={item}
              current={page === item.id}
              iconsOnly={iconsOnly}
              highlight={highlight}
              onPage={onPage}
            />
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 flex-col gap-1 border-t border-line pt-2">
        <UpdateRow iconsOnly={iconsOnly} />
        <JobStatus narrow={iconsOnly} onWiden={widen} />
        <ul className={`flex gap-0.5 ${iconsOnly ? "flex-col" : ""}`}>
          {FOOTER.map((item) => (
            <li key={item.id} className="flex-1">
              <button
                type="button"
                onClick={() => onPage(item.id)}
                aria-current={page === item.id ? "page" : undefined}
                data-nav={item.id}
                title={item.label}
                className={`flex min-h-8.5 w-full items-center justify-center ${
                  page === item.id
                    ? "bg-raised text-ink"
                    : "text-faint hover:bg-raised/60 hover:text-ink"
                } ${highlight === item.id ? "ring-2 ring-accent" : ""}`}
              >
                <Icon name={item.icon} size={18} />
                <span className="sr-only">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
        {/* The folder's own name, since the full path rarely fits; it opens in Explorer. */}
        <button
          type="button"
          onClick={() => api.menuAction("menu-open-library").catch(() => undefined)}
          title={`${libraryRoot}\nClick to open it in File Explorer.`}
          aria-label={`Open the library folder, ${folder}, in File Explorer`}
          className={`flex min-h-8.5 items-center gap-2 text-[14px] text-faint hover:bg-raised/60 hover:text-ink ${
            iconsOnly ? "justify-center" : "px-2.5 text-left"
          }`}
        >
          <Icon name="folder" size={iconsOnly ? 20 : 16} className="shrink-0" />
          {!iconsOnly && <span className="truncate">{folder}</span>}
        </button>
      </div>
    </nav>
  );
}

/**
 * "Update ready" while a newer version waits to install. It opens Settings at About through the
 * Help > About menu item, where the notes and the install button are.
 * @param props - Component props.
 * @param props.iconsOnly - the menu is narrow, so the label goes to a tooltip
 * @returns the row, or nothing when there's no update
 */
function UpdateRow({ iconsOnly }: { iconsOnly: boolean }): ReactElement | null {
  const { update } = useUpdates();
  if (!update) return null;
  const label = `Version ${update.version} is ready to install`;
  return (
    <button
      type="button"
      onClick={() => api.menuAction("menu-about").catch(() => undefined)}
      title={label}
      aria-label={label}
      className={`flex min-h-8.5 items-center gap-2 text-[14px] font-semibold text-accent hover:bg-raised/60 ${
        iconsOnly ? "justify-center" : "px-2.5 text-left"
      }`}
    >
      <Icon name="import" size={iconsOnly ? 20 : 16} className="shrink-0" />
      {!iconsOnly && <span className="truncate">Update ready</span>}
    </button>
  );
}

/**
 * One page in the menu. Its `data-nav` is how the tour finds it.
 * @param props - Component props.
 * @param props.item - the page, its label and icon
 * @param props.current - the page is on show
 * @param props.iconsOnly - the menu is narrow, so the label goes to a tooltip
 * @param props.highlight - a page the tour is pointing at
 * @param props.onPage - switch page
 * @returns the menu row
 */
function PageRow({
  item,
  current,
  iconsOnly,
  highlight,
  onPage,
}: {
  item: NavItem;
  current: boolean;
  iconsOnly: boolean;
  highlight: PageId | null;
  onPage: (page: PageId) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onPage(item.id)}
      aria-current={current ? "page" : undefined}
      data-nav={item.id}
      title={iconsOnly ? item.label : undefined}
      className={`relative flex min-h-8.5 w-full shrink-0 items-center gap-3 overflow-hidden py-1.5 pr-2.5 pl-3.75 text-left text-[15px] transition-colors ${current ? CURRENT_ROW : OTHER_ROW} ${highlight === item.id ? "ring-2 ring-accent" : ""}`}
    >
      <Icon name={item.icon} size={18} className="shrink-0" />
      {/* Faded rather than removed while narrow, so it slides out with the menu and is still read. */}
      <span
        className={`whitespace-nowrap transition-opacity duration-200 motion-reduce:transition-none ${iconsOnly ? "opacity-0" : ""}`}
      >
        {item.label}
      </span>
    </button>
  );
}

/**
 * One trip under Trips: its colour, name and how many photos and videos it holds. The chip sits
 * under the Trips icon, so the rows read as part of it.
 * @param props - Component props.
 * @param props.trip - the trip
 * @param props.current - the Library is showing this trip
 * @param props.onShow - show the trip in the Library
 * @returns the trip row
 */
function TripRow({
  trip,
  current,
  onShow,
}: {
  trip: TripInfo;
  current: boolean;
  onShow: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onShow}
      aria-current={current ? "page" : undefined}
      title={`${trip.name}\n${rangeText(trip.startAt, trip.endAt)}`}
      className={`relative flex min-h-7.5 w-full items-center gap-4 pr-2.5 pl-3.5 text-left text-[14px] transition-colors ${
        current ? CURRENT_ROW : OTHER_ROW
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${tripBg(trip.colour)}`}
      />
      <span className="min-w-0 flex-1 truncate">{trip.name}</span>
      <span className="shrink-0 text-[13px] font-normal text-faint tabular-nums">
        {trip.files.toLocaleString()}
        <span className="sr-only"> items</span>
      </span>
    </button>
  );
}
