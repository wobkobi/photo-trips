import type { PageId } from "../App";
import { api } from "../lib/api";
import { folderName } from "../lib/format";
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
 * The menu down the left of the window. Narrow, it shows only icons, each named in a tooltip and
 * to screen readers, so the pages get more room.
 * @param props.page - the page on show
 * @param props.onPage - switch page
 * @param props.libraryRoot - the library folder's full path
 * @param props.narrow - show icons only
 * @param props.onNarrow - called with the new width choice
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
}) {
  const folder = folderName(libraryRoot);
  return (
    <nav
      aria-label="Pages"
      className={`on-brand flex shrink-0 flex-col overflow-x-hidden overflow-y-auto pb-5 ${
        narrow ? "w-20 px-2" : "w-60 px-3"
      }`}
    >
      <div
        className={`mb-4 flex items-center gap-3 border-b border-line pt-5 pb-4 ${
          narrow ? "justify-center" : "px-2"
        }`}
        title={narrow ? "Pic Cabinet, by To the Point Tech" : undefined}
      >
        <BrandMark size={34} className="shrink-0" />
        {!narrow && (
          <div className="min-w-0">
            <p className="text-[19px] leading-none font-extrabold tracking-tight">Pic Cabinet</p>
            <p className="mt-1.5 text-[14px] leading-none font-semibold text-accent">
              To the Point Tech
            </p>
          </div>
        )}
      </div>
      <ul className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <li key={item.id}>
            {/* The active page gets a moonstone rule on its left edge, as on the website's
                admin sidebar; it's a pseudo-element so the label doesn't shift. */}
            <button
              type="button"
              onClick={() => onPage(item.id)}
              aria-current={page === item.id ? "page" : undefined}
              title={narrow ? item.label : undefined}
              className={`relative flex min-h-12 w-full items-center rounded-lg py-2.5 text-[18px] font-semibold transition-colors ${
                narrow ? "justify-center px-0" : "gap-3 px-3 text-left"
              } ${
                page === item.id
                  ? "bg-raised text-ink before:absolute before:inset-y-2 before:left-0 before:w-0.75 before:rounded-r-sm before:bg-accent"
                  : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Icon name={item.icon} size={narrow ? 22 : 18} />
              <span className={narrow ? "sr-only" : undefined}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <JobStatus narrow={narrow} onWiden={() => onNarrow(false)} />
        {/* The folder's own name, since the full path rarely fits; it opens in Explorer. */}
        <button
          type="button"
          onClick={() => api.menuAction("menu-open-library").catch(() => undefined)}
          title={`${libraryRoot}\nClick to open it in File Explorer.`}
          aria-label={`Open the library folder, ${folder}, in File Explorer`}
          className={`flex min-h-11 items-center gap-2 rounded-lg text-[14px] text-faint hover:bg-raised hover:text-ink ${
            narrow ? "justify-center" : "px-3 text-left"
          }`}
        >
          <Icon name="folder" size={narrow ? 20 : 16} className="shrink-0" />
          {!narrow && <span className="truncate">{folder}</span>}
        </button>
        <button
          type="button"
          onClick={() => onNarrow(!narrow)}
          title={narrow ? "Show the menu's words" : undefined}
          className={`flex min-h-11 items-center gap-2 rounded-lg text-[15px] text-muted hover:bg-raised hover:text-ink ${
            narrow ? "justify-center" : "px-3 text-left"
          }`}
        >
          <Icon name={narrow ? "chevron" : "back"} size={narrow ? 20 : 16} className="shrink-0" />
          <span className={narrow ? "sr-only" : undefined}>
            {narrow ? "Widen the menu" : "Narrow the menu"}
          </span>
        </button>
      </div>
    </nav>
  );
}
