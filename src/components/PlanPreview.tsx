// Review screen pieces shared by every change that moves files (Sort, Trips): the summary,
// destination folders, the list of moves, progress while moving, and the result with Undo.

import { useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  thumbUrl,
  type ApplySummary,
  type JobProgress,
  type Preview,
  type PreviewItem,
} from "../lib/api";
import { count, monthLabel, splitPath } from "../lib/format";
import { JOB_NAMES } from "../lib/useJobs";
import { Icon } from "./Icon";
import { Button, Progress } from "./ui";

const ROW_HEIGHT = 60;

/**
 * Everything a previewed change will do: a headline count, notes, the folders receiving files
 * and every move.
 * @param props.preview - the previewed plan
 * @param props.note - extra lines for the notes under the headline
 * @returns the plan view, filling the remaining height
 */
export function PlanView({ preview, note }: { preview: Preview; note?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="px-8 pt-6 pb-5">
        <p className="font-display text-[30px] leading-none font-semibold">
          {preview.files === 0
            ? "No files move"
            : `${count(preview.files, "file moves", "files move")} into ${count(
                preview.folders.length,
                "folder",
                "folders",
              )}`}
        </p>
        <div className="mt-3 flex max-w-3xl flex-col gap-1 text-muted">
          {note}
          {preview.renamed > 0 && (
            <p>
              {count(preview.renamed, "photo gets", "photos get")} a number added to the name, like
              IMG_1 (1).jpg, because a file with that name is already there.
            </p>
          )}
          {preview.inPlace > 0 && (
            <p>
              {count(preview.inPlace, "photo is", "photos and videos are")} already in the right
              folder.
            </p>
          )}
          {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
          {preview.files > 0 && (
            <p>No file is ever replaced, and the whole move can be undone from History.</p>
          )}
        </div>
      </section>
      {preview.files > 0 && (
        <div className="flex min-h-0 flex-1 gap-6 border-t border-line">
          <FolderList folders={preview.folders} />
          <MoveList items={preview.items} />
        </div>
      )}
    </div>
  );
}

/**
 * Why some sidecar files never move.
 * @param props.files - how many are left alone
 * @returns one sentence
 */
export function LeftAlone({ files }: { files: number }) {
  return (
    <p className="mt-2">
      {count(files, "sidecar file stays", "sidecar files stay")} where{" "}
      {files === 1 ? "it is" : "they are"} because the photo{" "}
      {files === 1 ? "it belongs to is" : "they belong to is"} missing.
    </p>
  );
}

/**
 * Progress while files move, go to the Recycle Bin or go back.
 * @param props.job - the running job
 * @returns the progress block
 */
export function MovingProgress({ job }: { job: JobProgress }) {
  return (
    <div className="max-w-xl px-8 py-8">
      <p className="mb-4 font-display text-[26px] leading-none font-semibold">
        {JOB_NAMES[job.kind] ?? "Working"}
      </p>
      <Progress done={job.done} total={job.total} label={job.stage} />
      <p className="mt-4 text-[13px] text-muted">
        You can close this window. Photo Trips keeps going in the tray.
      </p>
    </div>
  );
}

/**
 * Outcome of an applied change, with Undo and a link to History.
 * @param props.result - what the apply job reported
 * @param props.intro - sentence before the move count, e.g. "Saved the trip Japan."
 * @param props.destination - where the files went, when that isn't a folder, e.g. "the
 *   Recycle Bin"
 * @param props.undoable - offer Undo even when no file moved (a trip change still can be)
 * @param props.busy - another job is running, so Undo waits
 * @param props.onUndo - undo the whole change
 * @param props.onHistory - open History
 * @returns the banner
 */
export function ResultBanner({
  result,
  intro,
  destination,
  undoable = false,
  busy,
  onUndo,
  onHistory,
}: {
  result: ApplySummary;
  intro?: string;
  destination?: string;
  undoable?: boolean;
  busy: boolean;
  onUndo: () => void;
  onHistory: () => void;
}) {
  const moved = count(result.moved, "file", "files") + (destination ? ` to ${destination}` : "");
  const movedText = result.cancelled
    ? `Stopped after moving ${moved}.`
    : result.moved > 0 || !intro
      ? `Moved ${moved}.`
      : "";
  const problem = result.failed > 0;
  return (
    <div
      role="status"
      className={`mx-8 mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-md border p-4 ${
        problem ? "border-warn/40 bg-warn/10" : "border-line bg-surface"
      }`}
    >
      <Icon name={problem ? "warn" : "check"} className={problem ? "text-warn" : "text-paper"} />
      <p className="min-w-0 flex-1">
        {[intro, movedText].filter(Boolean).join(" ")}
        {problem &&
          ` ${count(result.failed, "file", "files")} couldn't be moved and stayed where ${
            result.failed === 1 ? "it was" : "they were"
          }. History says why.`}
      </p>
      {(result.moved > 0 || undoable) && (
        <Button onClick={onUndo} disabled={busy}>
          <Icon name="undo" size={16} />
          Undo
        </Button>
      )}
      <Button variant="ghost" onClick={onHistory}>
        <Icon name="history" size={16} />
        See history
      </Button>
    </div>
  );
}

function FolderList({ folders }: { folders: Preview["folders"] }) {
  return (
    <aside
      aria-label="Folders receiving files"
      className="hidden w-60 shrink-0 overflow-y-auto border-r border-line py-4 pl-8 lg:block"
    >
      <ul className="flex flex-col">
        {folders.map(({ folder, files }) => {
          const name = splitPath(folder).name;
          return (
            <li key={folder} className="flex items-baseline justify-between gap-3 py-1.5 pr-5">
              <span className="min-w-0">
                <span className="block truncate">
                  {/^\d{4}-\d{2}$/.test(name) ? monthLabel(name) : name}
                </span>
                <span className="block truncate text-[12px] text-faint">{folder}</span>
              </span>
              <span className="shrink-0 text-[13px] text-muted">{files.toLocaleString()}</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function MoveList({ items }: { items: PreviewItem[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Files that will move"
      className="min-w-0 flex-1 overflow-y-auto"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 16 }}>
        {virtualizer.getVirtualItems().map((row) => (
          <MoveRow key={items[row.index].id} item={items[row.index]} top={row.start} />
        ))}
      </div>
    </div>
  );
}

function MoveRow({ item, top }: { item: PreviewItem; top: number }) {
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
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[3px] bg-surface text-[11px] text-faint">
        {failed ? (
          `.${ext.toLowerCase()}`
        ) : (
          <img
            src={thumbUrl(item.id, item.version)}
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
          <span className="selectable truncate">{to.name}</span>
          {item.extra > 0 && (
            <span
              className="shrink-0 text-[12px] text-muted"
              title={`${count(item.extra, "file travels", "files travel")} with this one`}
            >
              +{item.extra}
            </span>
          )}
          {item.renamed && (
            <span className="shrink-0 truncate text-[12px] text-faint">was {from.name}</span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
          <span className="selectable truncate">{from.folder || "Library folder"}</span>
          <Icon name="chevron" size={12} className="shrink-0 text-faint" />
          <span className="selectable shrink-0 text-paper">{to.folder}</span>
        </span>
      </span>
    </div>
  );
}
