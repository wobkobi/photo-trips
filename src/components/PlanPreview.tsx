// Review screen pieces shared by every change that moves files (Sort, Trips, Import): the
// summary, destination folders, the list of moves, progress while moving, and the result with
// Undo.

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, thumbUrl, type ApplySummary, type JobProgress, type Preview } from "../lib/api";
import { count, monthLabel, splitPath } from "../lib/format";
import type { FolderCount } from "../lib/picker";
import { JOB_NAMES } from "../lib/useJobs";
import { Icon } from "./Icon";
import { Button, LIST_FILL, Progress, ReviewHead } from "./ui";

const ROW_HEIGHT = 60;

/** One row of a move list: a photo (plus companions) and where it goes. */
export interface MoveRowData {
  key: string | number;
  /** Thumbnail URL. */
  thumb: string;
  /** Where it is now and where it goes, relative to their folders. */
  from: string;
  to: string;
  extra: number;
  renamed: boolean;
}

/** Sentence-start, "-ing" and plain forms for the result banner. */
const VERBS = {
  moved: ["Moved", "moving", "moved"],
  copied: ["Copied", "copying", "copied"],
  imported: ["Imported", "importing", "imported"],
} as const;

/**
 * Everything a previewed change will do: a headline count, notes, the folders receiving files
 * and every move.
 * @param props - Component props.
 * @param props.preview - the previewed plan
 * @param props.note - extra lines for the notes under the headline
 * @param props.skipped - photos unticked to stay where they are, when moves can be unticked
 * @param props.onToggle - tick or untick a photo; rows get tick boxes only when this is given
 * @returns the plan view, filling the remaining height
 */
export function PlanView({
  preview,
  note,
  skipped,
  onToggle,
}: {
  preview: Preview;
  note?: ReactNode;
  skipped?: ReadonlySet<number>;
  onToggle?: (id: number) => void;
}): ReactElement {
  return (
    <div className="flex flex-1 flex-col">
      <ReviewHead
        title={
          preview.files === 0
            ? "No files move"
            : `${count(preview.files, "file moves", "files move")} into ${count(
                preview.folders.length,
                "folder",
                "folders",
              )}`
        }
        summary={
          preview.inPlace > 0 &&
          `${count(preview.inPlace, "photo is", "photos and videos are")} already in place`
        }
        notes={
          <>
            {note}
            {preview.renamed > 0 && (
              <p>
                {count(preview.renamed, "photo gets", "photos get")} a number added to the name,
                like IMG_1 (1).jpg, because a file with that name is already there.
              </p>
            )}
            {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
            {preview.files > 0 && (
              <p>No file is ever replaced, and the whole move can be undone from History.</p>
            )}
          </>
        }
      />
      {preview.files > 0 && (
        <div className={`flex border-t border-line ${LIST_FILL}`}>
          <FolderList
            folders={preview.folders.map(({ folder, files }) => ({ folder, count: files }))}
          />
          <MoveList
            label="Files that will move"
            rows={preview.items.map((item) => ({
              ...item,
              key: item.id,
              thumb: thumbUrl(item.id, item.version),
            }))}
            skipped={skipped}
            onToggle={onToggle && ((key) => onToggle(Number(key)))}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Why some sidecar files never move.
 * @param props - Component props.
 * @param props.files - how many are left alone
 * @returns one sentence
 */
export function LeftAlone({ files }: { files: number }): ReactElement {
  return (
    <p className="mt-2">
      {count(files, "sidecar file", "sidecar files")} with no matching photo or video here{" "}
      {files === 1 ? "stays" : "stay"} where {files === 1 ? "it is" : "they are"}.
    </p>
  );
}

/**
 * Progress while files move, go to the Recycle Bin or go back, with a Stop button. Stopping
 * leaves the files already done where they went; the result says how far it got.
 * @param props - Component props.
 * @param props.job - the running job
 * @returns the progress block
 */
export function MovingProgress({ job }: { job: JobProgress }): ReactElement {
  return (
    <div className="max-w-xl px-5 py-5">
      <p className="mb-3 text-[18px] font-semibold">{JOB_NAMES[job.kind] ?? "Working"}</p>
      <Progress done={job.done} total={job.total} label={job.stage} />
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button onClick={() => api.cancelJob().catch(() => undefined)}>Stop</Button>
        <p className="text-[15px] text-muted">
          You can close this window. Pic Cabinet keeps going in the tray.
        </p>
      </div>
    </div>
  );
}

/**
 * Outcome of an applied change, with Undo and a link to History.
 * @param props - Component props.
 * @param props.result - what the apply job reported
 * @param props.intro - sentence before the move count, e.g. "Saved the trip Japan."
 * @param props.destination - where the files went, when that isn't a folder, e.g. "the
 *   Recycle Bin"
 * @param props.verb - what happened to the files (default moved)
 * @param props.undoable - offer Undo even when no file moved (a trip change still can be)
 * @param props.busy - another job is running, so Undo waits
 * @param props.onUndo - undo the whole change
 * @param props.onHistory - open History
 * @param props.onLibrary - open the Library, offered once files have arrived there
 * @returns the banner
 */
export function ResultBanner({
  result,
  intro,
  destination,
  verb = "moved",
  undoable = false,
  busy,
  onUndo,
  onHistory,
  onLibrary,
}: {
  result: ApplySummary;
  intro?: string;
  destination?: string;
  verb?: keyof typeof VERBS;
  undoable?: boolean;
  busy: boolean;
  onUndo: () => void;
  onHistory: () => void;
  onLibrary?: () => void;
}): ReactElement {
  const [past, ing, plain] = VERBS[verb];
  const moved = count(result.moved, "file", "files") + (destination ? ` to ${destination}` : "");
  const movedText = result.cancelled
    ? `Stopped after ${ing} ${moved}.`
    : result.moved > 0 || !intro
      ? `${past} ${moved}.`
      : "";
  const problem = result.failed > 0;
  return (
    <div
      role="status"
      className={`mx-8 mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border p-4 ${
        problem ? "border-warn-line bg-warn-soft" : "border-line bg-surface"
      }`}
    >
      <Icon name={problem ? "warn" : "check"} className={problem ? "text-warn" : "text-accent"} />
      <p className="min-w-0 flex-1">
        {[intro, movedText].filter(Boolean).join(" ")}
        {problem &&
          ` ${count(result.failed, "file", "files")} couldn't be ${plain} and stayed where ${
            result.failed === 1 ? "it was" : "they were"
          }. History says why.`}
      </p>
      {(result.moved > 0 || undoable) && (
        <Button onClick={onUndo} disabled={busy}>
          <Icon name="undo" size={16} />
          Undo
        </Button>
      )}
      {onLibrary && result.moved > 0 && (
        <Button onClick={onLibrary}>
          <Icon name="library" size={16} />
          See in Library
        </Button>
      )}
      <Button variant="ghost" onClick={onHistory}>
        <Icon name="history" size={16} />
        See history
      </Button>
    </div>
  );
}

/**
 * The folders receiving files, with how many each gets. Given `onOpen`, each folder is a button,
 * for jumping to its photos in a grid beside the list.
 * @param props - Component props.
 * @param props.folders - folders relative to the library, with file counts (photo counts when
 *   `onOpen` is given, to match the grid)
 * @param props.onOpen - called with the folder that was clicked
 * @returns the side list (hidden on narrow windows; see {@link FolderJumpList})
 */
export function FolderList({
  folders,
  onOpen,
}: {
  folders: FolderCount[];
  onOpen?: (folder: string) => void;
}): ReactElement {
  return (
    <aside
      aria-label="Folders receiving files"
      className="hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-surface px-2 py-2 lg:block"
    >
      {onOpen && <p className="mb-1 px-2.5 text-[13px] text-faint">Folders</p>}
      <FolderEntries folders={folders} onOpen={onOpen} />
    </aside>
  );
}

/**
 * {@link FolderList} for windows too narrow for the side list (including any window at a large
 * text size): a closed "Where they go" line above the grid that opens to the same buttons.
 * @param props - Component props.
 * @param props.folders - folders relative to the library, with photo counts
 * @param props.onOpen - called with the folder that was clicked
 * @returns the fold-out list (hidden where the side list shows)
 */
export function FolderJumpList({
  folders,
  onOpen,
}: {
  folders: FolderCount[];
  onOpen: (folder: string) => void;
}): ReactElement {
  return (
    <details className="group shrink-0 border-t border-line px-3 lg:hidden">
      {/* A flex summary loses the browser's marker, so the chevron stands in for it. */}
      <summary className="flex min-h-8.5 cursor-pointer list-none items-center gap-2 px-2 text-[14px] text-muted hover:text-ink">
        <Icon
          name="chevron"
          size={16}
          className="shrink-0 transition-transform group-open:rotate-90"
        />
        Where they go: {folders.length.toLocaleString()}{" "}
        {folders.length === 1 ? "folder" : "folders"}
      </summary>
      <div className="max-h-[40vh] overflow-y-auto pb-3">
        <FolderEntries folders={folders} onOpen={onOpen} />
      </div>
    </details>
  );
}

/**
 * The folder rows shared by {@link FolderList} and {@link FolderJumpList}: month folders show
 * their month name, and each row is a button when `onOpen` is given.
 * @param props - Component props.
 * @param props.folders - folders relative to the library, with photo or file counts
 * @param props.onOpen - called with the folder that was clicked; plain rows without it
 * @returns the list of folders
 */
function FolderEntries({
  folders,
  onOpen,
}: {
  folders: FolderCount[];
  onOpen?: (folder: string) => void;
}): ReactElement {
  return (
    <ul className="flex flex-col">
      {folders.map(({ folder, count: n }) => {
        const name = splitPath(folder).name;
        const title = /^\d{4}-\d{2}$/.test(name) ? monthLabel(name) : name;
        const body = (
          <>
            <span className="min-w-0">
              <span className="block truncate" title={title}>
                {title}
              </span>
              <span className="block truncate text-[13px] text-faint" title={folder}>
                {folder}
              </span>
            </span>
            <span className="shrink-0 text-[13px] text-faint">{n.toLocaleString()}</span>
          </>
        );
        return (
          <li key={folder}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(folder)}
                aria-label={`Go to the ${count(n, "photo", "photos")} going into ${title}`}
                className="flex min-h-8.5 w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1 text-left text-[14px] hover:bg-raised"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-baseline justify-between gap-3 px-2.5 py-1 text-[14px]">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Every photo that will move, as a virtual list.
 * @param props - Component props.
 * @param props.rows - the moves
 * @param props.label - accessible name for the list
 * @param props.origin - what an empty `from` folder is called (default "Library folder")
 * @param props.skipped - row keys unticked to stay where they are
 * @param props.onToggle - tick or untick a row; rows get tick boxes only when this is given
 * @returns the list, filling the remaining space
 */
export function MoveList({
  rows,
  label,
  origin = "Library folder",
  skipped,
  onToggle,
}: {
  rows: MoveRowData[];
  label: string;
  origin?: string;
  skipped?: ReadonlySet<MoveRowData["key"]>;
  onToggle?: (key: MoveRowData["key"]) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    /**
     * The element the list scrolls in.
     * @returns the scroll container, or null before it mounts
     */
    getScrollElement: () => scrollRef.current,
    /**
     * Every row is the same height.
     * @returns the row height in pixels
     */
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={scrollRef} role="list" aria-label={label} className="min-w-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 16 }}>
        {virtualizer.getVirtualItems().map((row) => (
          <MoveRow
            key={rows[row.index].key}
            item={rows[row.index]}
            origin={origin}
            top={row.start}
            skipped={skipped?.has(rows[row.index].key) ?? false}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One row of a {@link MoveList}: thumbnail (or the extension when it fails to load), the new
 * name, and the folder it moves from and to.
 * @param props - Component props.
 * @param props.item - the move to show
 * @param props.origin - what an empty `from` folder is called
 * @param props.top - offset from the top of the list, in pixels
 * @param props.skipped - unticked, so it stays where it is
 * @param props.onToggle - tick or untick it; no tick box without it
 * @returns the positioned row
 */
function MoveRow({
  item,
  origin,
  top,
  skipped,
  onToggle,
}: {
  item: MoveRowData;
  origin: string;
  top: number;
  skipped: boolean;
  onToggle?: (key: MoveRowData["key"]) => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const from = splitPath(item.from);
  const to = splitPath(item.to);
  const ext = to.name.split(".").pop() ?? "";

  return (
    <div
      role="listitem"
      className="absolute left-0 flex w-full items-center gap-3 px-6"
      style={{ top, height: ROW_HEIGHT }}
    >
      {onToggle && (
        <input
          type="checkbox"
          checked={!skipped}
          onChange={() => onToggle(item.key)}
          aria-label={`Move ${to.name}`}
          className="size-4 shrink-0 accent-accent"
        />
      )}
      <span className={`flex min-w-0 flex-1 items-center gap-3 ${skipped ? "opacity-40" : ""}`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-raised text-[13px] text-faint">
          {failed ? (
            `.${ext.toLowerCase()}`
          ) : (
            <img
              src={item.thumb}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="selectable min-w-0 truncate" title={to.name}>
              {to.name}
            </span>
            {item.extra > 0 && (
              <span
                className="shrink-0 text-[14px] text-muted"
                title={`${count(item.extra, "file travels", "files travel")} with this one`}
              >
                +{item.extra}
              </span>
            )}
            {item.renamed && (
              // Gives way before the new name does: shrink-4 takes most of any squeeze.
              <span
                className="min-w-0 shrink-4 truncate text-[14px] text-faint"
                title={`was ${from.name}`}
              >
                was {from.name}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-[14px] text-muted">
            <span className="selectable min-w-0 shrink-4 truncate" title={from.folder || origin}>
              {from.folder || origin}
            </span>
            <Icon name="chevron" size={12} className="shrink-0 text-faint" />
            <span className="selectable min-w-0 truncate text-ink" title={to.folder}>
              {to.folder}
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}
