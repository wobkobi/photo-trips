import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { MovingProgress, ResultBanner } from "../components/PlanPreview";
import { Button, EmptyState, PageHeader } from "../components/ui";
import {
  api,
  errorText,
  thumbUrl,
  type ApplySummary,
  type DupCopy,
  type DupReport,
  type DupSet,
} from "../lib/api";
import { keeperOf, removalPlan, type Picks } from "../lib/duplicates";
import { count, formatBytes, splitPath } from "../lib/format";
import { useJobDone, useJobs } from "../lib/useJobs";

/** Fixed height of one set in the list: header, a row of copy cards and spacing. */
const SET_HEIGHT = 272;

const KIND_TEXT: Record<DupSet["kind"], [string, string]> = {
  photo: ["photo", "photos"],
  raw: ["RAW photo", "RAW photos"],
  video: ["video", "videos"],
};

/**
 * Photos and videos that are exact copies of each other. One copy of each set stays; the
 * rest go to the Recycle Bin as one change that History can undo.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function DuplicatesPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { running } = useJobs();
  const [report, setReport] = useState<DupReport | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);

  const load = useCallback(() => {
    api.listDuplicates().then(
      (loaded) => {
        setReport(loaded);
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  useEffect(load, [load]);
  // An import check hashes library files, which can turn up sets nobody compared yet.
  useJobDone(["index", "duplicates", "import-scan", "import", "inbox"], load);
  useJobDone("remove", (done) => {
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setError(done.error);
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  async function run(action: () => Promise<void>) {
    setError(null);
    setConfirming(false);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const busy = running !== null;
  const working = running?.kind === "duplicates" || running?.kind === "remove";
  const showProgress = working || running?.kind === "undo";
  const sets = report?.sets ?? [];
  const plan = removalPlan(sets, picks);
  const check = () => run(api.findDuplicates);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Duplicates"
        detail="Photos and videos that are exact copies of each other, byte for byte."
        actions={
          !showProgress &&
          sets.length > 0 &&
          (confirming ? (
            <>
              <span className="text-[13px]">
                Move {count(plan.copies, "copy", "copies")} to the Recycle Bin?
              </span>
              <Button
                variant="primary"
                onClick={() => run(() => api.removeDuplicates(plan.choices))}
                disabled={busy}
              >
                Move to Recycle Bin
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {report !== null && report.unchecked > 0 && (
                <Button onClick={check} disabled={busy}>
                  <Icon name="refresh" size={16} />
                  Check new files
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => setConfirming(true)}
                disabled={busy || plan.copies === 0}
              >
                Move {count(plan.copies, "copy", "copies")} to the Recycle Bin
              </Button>
            </>
          ))
        }
      />
      {error && (
        <p role="alert" className="mx-8 mt-4 text-danger">
          {error}
        </p>
      )}
      {result && !showProgress && (
        <ResultBanner
          result={result}
          destination="the Recycle Bin"
          busy={busy}
          onUndo={() => run(() => api.undoBatch(result.batchId))}
          onHistory={() => onNavigate("history")}
        />
      )}

      {showProgress && running && <MovingProgress job={running} />}
      {!showProgress && report === null && !error && (
        <p className="px-8 py-6 text-muted">Looking for duplicates</p>
      )}
      {!showProgress && report !== null && sets.length === 0 && (
        <NoSets report={report} busy={busy} onCheck={check} />
      )}
      {!showProgress && sets.length > 0 && report !== null && (
        <>
          <Summary report={report} plan={plan} />
          <SetList
            sets={sets}
            picks={picks}
            onPick={(hash, keep) => setPicks((prev) => ({ ...prev, [hash]: keep }))}
          />
        </>
      )}
    </div>
  );
}

function NoSets({
  report,
  busy,
  onCheck,
}: {
  report: DupReport;
  busy: boolean;
  onCheck: () => void;
}) {
  if (report.unchecked === 0) {
    return (
      <EmptyState title="No duplicates">
        <p>No two photos or videos in your library are the same file.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Check for duplicates">
      <p>
        {count(report.unchecked, "photo or video is", "photos and videos are")} the same size as
        another file. Checking compares their contents, and only those files are read.
      </p>
      <Button variant="primary" onClick={onCheck} disabled={busy}>
        Check for duplicates
      </Button>
    </EmptyState>
  );
}

function Summary({
  report,
  plan,
}: {
  report: DupReport;
  plan: { copies: number; bytes: number };
}) {
  return (
    <section className="border-b border-line px-8 pt-6 pb-5">
      <p className="font-display text-[30px] leading-none font-semibold">
        {count(report.extra, "extra copy", "extra copies")} taking up {formatBytes(report.bytes)}
      </p>
      <div className="mt-3 flex max-w-3xl flex-col gap-1 text-muted">
        <p>
          Each set keeps the copy marked Keep: the one already in its folder, otherwise the
          oldest. Click another copy to keep that one instead, or Keep all to leave a set alone.
        </p>
        <p>
          Sidecar files like .aae and .xmp that only belonged to a removed copy go with it. The
          whole clean-up can be undone from History.
        </p>
        {plan.copies !== report.extra && (
          <p className="text-paper">
            {count(plan.copies, "copy goes", "copies go")}, freeing {formatBytes(plan.bytes)}.
          </p>
        )}
        {report.unchecked > 0 && (
          <p>
            {count(report.unchecked, "newer file hasn't", "newer files haven't")} been compared
            yet.
          </p>
        )}
      </div>
    </section>
  );
}

function SetList({
  sets,
  picks,
  onPick,
}: {
  sets: DupSet[];
  picks: Picks;
  onPick: (hash: string, keep: number | null) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sets.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => SET_HEIGHT,
    overscan: 3,
  });

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Duplicate sets"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 16 }}>
        {virtualizer.getVirtualItems().map((row) => {
          const set = sets[row.index];
          return (
            <SetRow
              key={set.hash}
              set={set}
              keep={keeperOf(set, picks)}
              top={row.start}
              onPick={(keep) => onPick(set.hash, keep)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SetRow({
  set,
  keep,
  top,
  onPick,
}: {
  set: DupSet;
  keep: number | null;
  top: number;
  onPick: (keep: number | null) => void;
}) {
  const [one, many] = KIND_TEXT[set.kind];
  return (
    <div
      role="listitem"
      className="absolute left-0 flex w-full flex-col px-8 pt-5"
      style={{ top, height: SET_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-muted">
          {count(set.copies.length, `copy of the same ${one}`, `copies of the same ${one}`)},{" "}
          {formatBytes(set.size)} each
        </p>
        <Button
          variant="ghost"
          onClick={() => onPick(keep === null ? set.copies[0].id : null)}
          aria-pressed={keep === null}
          title={keep === null ? `Remove the extra ${many} in this set` : undefined}
        >
          {keep === null ? "Remove extras" : "Keep all"}
        </Button>
      </div>
      <ul className="mt-2 flex gap-3 overflow-x-auto pb-3">
        {set.copies.map((copy) => (
          <CopyCard
            key={copy.id}
            copy={copy}
            state={keep === null ? "keep-all" : copy.id === keep ? "keep" : "bin"}
            onKeep={() => onPick(copy.id)}
          />
        ))}
      </ul>
    </div>
  );
}

/** One copy: kept, going to the bin, or kept because its whole set is left alone. */
function CopyCard({
  copy,
  state,
  onKeep,
}: {
  copy: DupCopy;
  state: "keep" | "bin" | "keep-all";
  onKeep: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const { folder, name } = splitPath(copy.path);
  const ext = name.split(".").pop() ?? "";
  const going = state === "bin";
  const notes = [
    copy.inPlace && "In its folder",
    copy.extra > 0 && `+${count(copy.extra, "file", "files")} with it`,
  ].filter(Boolean);

  return (
    <li className="w-40 shrink-0">
      <button
        type="button"
        onClick={onKeep}
        aria-pressed={state === "keep"}
        title={going ? "Keep this copy instead" : undefined}
        className="group block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
      >
        <span
          className={`relative block aspect-[4/3] overflow-hidden rounded-[3px] bg-surface ${
            state === "keep" ? "ring-2 ring-paper" : ""
          }`}
        >
          {failed ? (
            <span className="flex h-full items-center justify-center text-[12px] text-faint">
              .{ext.toLowerCase()}
            </span>
          ) : (
            <img
              src={thumbUrl(copy.id, copy.version)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setFailed(true)}
              className={`h-full w-full object-cover transition-opacity ${
                going ? "opacity-40 group-hover:opacity-70" : ""
              }`}
            />
          )}
          <span
            className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium ${
              going ? "bg-ground/85 text-muted" : "bg-paper text-ground"
            }`}
          >
            {going ? (
              "Recycle Bin"
            ) : (
              <>
                <Icon name="check" size={12} />
                Keep
              </>
            )}
          </span>
        </span>
        <span className={`selectable mt-2 block truncate text-[13px] ${going ? "text-muted" : ""}`}>
          {name}
        </span>
        <span className="selectable block truncate text-[12px] text-muted" title={folder}>
          {folder || "Library folder"}
        </span>
        <span className="block h-[18px] truncate text-[12px] text-faint">{notes.join(", ")}</span>
      </button>
    </li>
  );
}
