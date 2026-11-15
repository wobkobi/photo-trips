import { useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { api } from "../lib/api";
import { folderName } from "../lib/format";
import { useMediaQuery } from "../lib/useMediaQuery";
import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./Icon";
import { JobStatus } from "./JobStatus";

const NAV: { id: PageId; label: string; icon: IconName }[] = [
  { id: "library", label: "Library", icon: "library" },
  { id: "sort", label: "Sort", icon: "sort" },
  { id: "trips", label: "Trips", icon: "trips" },
  { id: "suggestions", label: "Suggestions", icon: "suggest" },
  { id: "import", label: "Import", icon: "import" },
  { id: "duplicates", label: "Duplicates", icon: "duplicates" },
  { id: "history", label: "History", icon: "history" },
  { id: "settings", label: "Settings", icon: "settings" },
];

/**
 * Below this width (in CSS pixels, so a larger text size reaches it sooner) the menu goes narrow
 * on its own, leaving the page at least about 560px.
 */
const CRAMPED = "(max-width: 800px)";

/**
 * The menu down the left of the window. Narrow, it shows only icons, each named in a tooltip and
 * to screen readers, so the pages get more room.
 *
 * The menu is narrow when the saved choice says so, or when the window is cramped. While cramped,
 * widening it lasts until the window has room again and isn't saved, since the saved choice is
 * about roomy windows.
 * @param props - Component props.
 * @param props.page - the page on show
 * @param props.onPage - switch page
 * @param props.libraryRoot - the library folder's full path
 * @param props.narrow - the saved choice to show icons only
 * @param props.onNarrow - called with the new width choice to save
 * @returns the sidebar
 */
export function Sidebar({
  page,
  onPage,
  libraryRoot,
  narrow,
  onNarrow,
}: {
  page: PageId;
  onPage: (page: PageId) => void;
  libraryRoot: string;
  narrow: boolean;
  onNarrow: (narrow: boolean) => void;
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
      className={`on-brand flex shrink-0 flex-col overflow-hidden pb-5 ${
        iconsOnly ? "w-20 px-2" : "w-60 px-3"
      }`}
    >
      <div
        className={`mb-4 flex shrink-0 items-center gap-3 border-b border-line pt-5 pb-4 ${
          iconsOnly ? "justify-center" : "px-2"
        }`}
        title={iconsOnly ? "Pic Cabinet, by To the Point Tech" : undefined}
      >
        <BrandMark size={34} className="shrink-0" />
        {!iconsOnly && (
          <div className="min-w-0">
            <p className="text-[19px] leading-none font-extrabold tracking-tight">Pic Cabinet</p>
            <p className="mt-1.5 text-[14px] leading-none font-semibold text-accent">
              To the Point Tech
            </p>
          </div>
        )}
      </div>
      {/* The side padding moves inside the scroller, so focus rings aren't clipped by it. */}
      <ul
        className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1 ${
          iconsOnly ? "-mx-2 px-2" : "-mx-3 px-3"
        }`}
      >
        {NAV.map((item) => (
          <li key={item.id}>
            {/* The active page gets a moonstone rule on its left edge, as on the website's
                admin sidebar; it's a pseudo-element so the label doesn't shift. */}
            <button
              type="button"
              onClick={() => onPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              title={iconsOnly ? item.label : undefined}
              className={`relative flex min-h-12 w-full items-center rounded-lg py-2.5 text-[18px] font-semibold transition-colors ${
                iconsOnly ? "justify-center px-0" : "gap-3 px-3 text-left"
              } ${
                page === item.id
                  ? "bg-raised text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-accent"
                  : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Icon name={item.icon} size={iconsOnly ? 22 : 18} />
              <span className={iconsOnly ? "sr-only" : undefined}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex shrink-0 flex-col gap-3 pt-4">
        <JobStatus narrow={iconsOnly} onWiden={widen} />
        {/* The folder's own name, since the full path rarely fits; it opens in Explorer. */}
        <button
          type="button"
          onClick={() => api.menuAction("menu-open-library").catch(() => undefined)}
          title={`${libraryRoot}\nClick to open it in File Explorer.`}
          aria-label={`Open the library folder, ${folder}, in File Explorer`}
          className={`flex min-h-11 items-center gap-2 rounded-lg text-[14px] text-faint hover:bg-raised hover:text-ink ${
            iconsOnly ? "justify-center" : "px-3 text-left"
          }`}
        >
          <Icon name="folder" size={iconsOnly ? 20 : 16} className="shrink-0" />
          {!iconsOnly && <span className="truncate">{folder}</span>}
        </button>
        <button
          type="button"
          onClick={iconsOnly ? widen : narrowIt}
          title={iconsOnly ? "Widen the menu" : undefined}
          aria-expanded={!iconsOnly}
          className={`flex min-h-11 items-center gap-2 rounded-lg text-[15px] text-muted hover:bg-raised hover:text-ink ${
            iconsOnly ? "justify-center" : "px-3 text-left"
          }`}
        >
          <Icon
            name={iconsOnly ? "chevron" : "back"}
            size={iconsOnly ? 20 : 16}
            className="shrink-0"
          />
          <span className={iconsOnly ? "sr-only" : undefined}>
            {iconsOnly ? "Widen the menu" : "Narrow the menu"}
          </span>
        </button>
      </div>
    </nav>
  );
}
