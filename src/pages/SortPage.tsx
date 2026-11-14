import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { Button, EmptyState, PageHeader, Progress } from "../components/ui";
import {
  api,
  errorText,
  thumbUrl,
  type ApplySummary,
  type Preview,
  type PreviewItem,
} from "../lib/api";
import { count, monthLabel, splitPath } from "../lib/format";
import { useJobDone, useJobs } from "../lib/useJobs";

const ROW_HEIGHT = 60;

/**
 * Sort the library into year and month folders: review every move first, then apply it as
 * one change that can be undone.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function SortPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { running } = useJobs();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);

  const load = useCallback(() => {
    api.planOrganise().then(
      (loaded) => {
        setPreview(loaded);
        setError(null);
        setChecking(false);
      },
      (err) => {
        setError(errorText(err));
        setChecking(false);
      },
    );
  }, []);

  useEffect(load, [load]);
  useJobDone("index", load);
  useJobDone("apply", (done) => {
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setError(done.error);
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  function checkAgain() {
    setChecking(true);
    load();
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const moving = running?.kind === "apply" || running?.kind === "undo";
  const ready = preview !== null && preview.files > 0 && !moving;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sort"
        detail={
          <>
            Every photo and video goes in a folder for the month it was taken, like{" "}
            <span className="text-paper">2025\2025-03</span>.
          </>
        }
        actions={
          ready && (
            <>
              <Button onClick={checkAgain} disabled={checking || running !== null}>
                <Icon name="refresh" size={16} />
                Check again
              </Button>
              <Button
                variant="primary"
                onClick={() => run(() => api.applyPlan(preview.id))}
                disabled={checking || running !== null}
              >
                Move {count(preview.files, "file", "files")}
              </Button>
            </>
          )
        }
      />
      {error && (
        <p role="alert" className="mx-8 mt-4 text-danger">
          {error}
        </p>
      )}
      {result && !moving && (
        <ResultBanner
          result={result}
          busy={running !== null}
          onUndo={() => run(() => api.undoBatch(result.batchId))}
          onHistory={() => onNavigate("history")}
        />
      )}

      {moving && running && (
        <div className="max-w-xl px-8 py-8">
          <p className="mb-4 font-display text-[26px] leading-none font-semibold">
            {running.kind === "apply" ? "Moving files" : "Putting files back"}
          </p>
          <Progress done={running.done} total={running.total} label={running.stage} />
          <p className="mt-4 text-[13px] text-muted">
            You can close this window. Photo Trips keeps going in the tray.
          </p>
        </div>
      )}
      {!moving && preview === null && !error && (
        <p className="px-8 py-6 text-muted">Working out where everything goes</p>
      )}
      {!moving && preview !== null && preview.files === 0 && <NothingToDo preview={preview} />}
      {ready && <PlanView preview={preview} />}
    </div>
  );
}

function NothingToDo({ preview }: { preview: Preview }) {
  if (preview.inPlace === 0) {
    return (
      <EmptyState title="Nothing to sort">
        <p>Your library folder has no photos or videos yet.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Everything is in its folder">
      <p>
        {preview.inPlace === 1
          ? "Your one photo is already in its year and month folder."
          : `All ${count(preview.inPlace, "photo", "photos and videos")} are already in their year and month folders.`}
      </p>
      {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
    </EmptyState>
  );
}

function LeftAlone({ files }: { files: number }) {
  return (
    <p className="mt-2">
      {count(files, "sidecar file stays", "sidecar files stay")} where{" "}
      {files === 1 ? "it is" : "they are"} because the photo{" "}
      {files === 1 ? "it belongs to is" : "they belong to is"} missing.
    </p>
  );
}

function ResultBanner({
  result,
  busy,
  onUndo,
  onHistory,
}: {
  result: ApplySummary;
  busy: boolean;
  onUndo: () => void;
  onHistory: () => void;
}) {
  const moved = count(result.moved, "file", "files");
  const headline = result.cancelled ? `Stopped after moving ${moved}.` : `Moved ${moved}.`;
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
        {headline}
        {problem &&
          ` ${count(result.failed, "file", "files")} couldn't be moved and stayed where ${
            result.failed === 1 ? "it was" : "they were"
          }. History says why.`}
      </p>
      {result.moved > 0 && (
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

function PlanView({ preview }: { preview: Preview }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <section className="px-8 pt-6 pb-5">
        <p className="font-display text-[30px] leading-none font-semibold">
          {count(preview.files, "file moves", "files move")} into{" "}
          {count(preview.folders.length, "folder", "folders")}
        </p>
        <div className="mt-3 flex max-w-3xl flex-col gap-1 text-muted">
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
          <p>No file is ever replaced, and the whole move can be undone from History.</p>
        </div>
      </section>
      <div className="flex min-h-0 flex-1 gap-6 border-t border-line">
        <FolderList folders={preview.folders} />
        <MoveList items={preview.items} />
      </div>
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
          const month = splitPath(folder).name;
          return (
            <li key={folder} className="flex items-baseline justify-between gap-3 py-1.5 pr-5">
              <span className="min-w-0">
                <span className="block truncate">
                  {/^\d{4}-\d{2}$/.test(month) ? monthLabel(month) : month}
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
