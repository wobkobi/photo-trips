import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { MovingProgress, ResultBanner } from "../components/PlanPreview";
import {
  Button,
  EmptyState,
  HOVER_RING,
  LIST_FILL,
  PageHeader,
  ReviewHead,
} from "../components/ui";
import { Viewer } from "../components/Viewer";
import { useLibrarySource } from "../components/viewSources";
import {
  api,
  errorText,
  thumbUrl,
  type ApplySummary,
  type DupCopy,
  type DupReport,
  type DupSet,
} from "../lib/api";
import { keeperOf, pickWithPartners, prunePicks, removalPlan, type Picks } from "../lib/duplicates";
import { count, formatBytes, splitPath } from "../lib/format";
import { useJobDone, useJobs } from "../lib/useJobs";
import { usePageMemory } from "../lib/usePageMemory";

/**
 * Height of one set in the list (header, a row of copy cards and spacing) when nothing wraps. A
 * set is measured once drawn, so a header that wraps at a large text size makes its row taller
 * instead of running into the next set.
 */
const SET_HEIGHT = 272;

const KIND_TEXT: Record<DupSet["kind"], [string, string]> = {
  photo: ["photo", "photos"],
  raw: ["RAW photo", "RAW photos"],
  video: ["video", "videos"],
};

/**
 * Photos and videos that are exact copies of each other. One copy of each set stays; the
 * rest go to the Recycle Bin as one change that History can undo.
 * @param props - Component props.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function DuplicatesPage({
  onNavigate,
}: {
  onNavigate: (page: PageId) => void;
}): ReactElement {
  const { running } = useJobs();
  const [report, setReport] = useState<DupReport | null>(null);
  // Kept for the next visit. Each read of the sets drops picks for sets or copies that went.
  const [picks, setPicks] = usePageMemory<Picks>("duplicates.picks", {});
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);

  const load = useCallback(() => {
    api.listDuplicates().then(
      (loaded) => {
        setReport(loaded);
        setPicks((prev) => prunePicks(loaded.sets, prev));
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
  }, [setPicks]);

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

  /**
   * Run an action with the confirm closed, showing any failure as the page error.
   * @param action - the API call to make
   */
  async function run(action: () => Promise<void>): Promise<void> {
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
  /**
   * Hash the files not compared yet.
   * @returns resolves once the check is queued
   */
  const check = (): Promise<void> => run(api.findDuplicates);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Duplicates"
        actions={
          !showProgress &&
          sets.length > 0 &&
          (confirming ? (
            <>
              <span className="text-[15px]">
                Move {count(plan.copies, "copy", "copies")} to the Recycle Bin?
              </span>
              <Button
                variant="primary"
                onClick={() => run(() => api.removeDuplicates(plan.choices))}
                busy={busy}
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
                <Button onClick={check} busy={busy}>
                  <Icon name="refresh" size={16} />
                  Check new files
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => setConfirming(true)}
                disabled={plan.copies === 0}
                busy={busy}
              >
                Move {count(plan.copies, "copy", "copies")} to the Recycle Bin
              </Button>
            </>
          ))
        }
      />
      {error && (
        <p role="alert" className="mx-5 mt-3 text-danger">
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
            onPick={(hash, keep) =>
              setPicks((prev) => ({ ...prev, ...pickWithPartners(sets, hash, keep) }))
            }
          />
        </>
      )}
    </div>
  );
}

/**
 * Shown when no sets are left: either nothing is duplicated, or some same-size files still need
 * comparing.
 * @param props - Component props.
 * @param props.report - the latest duplicates report
 * @param props.busy - a job is running, so the check button is disabled
 * @param props.onCheck - compare the files not checked yet
 * @returns the empty state
 */
function NoSets({
  report,
  busy,
  onCheck,
}: {
  report: DupReport;
  busy: boolean;
  onCheck: () => void;
}): ReactElement {
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
        another file. Checking reads only those.
      </p>
      <Button variant="primary" onClick={onCheck} busy={busy}>
        Check for duplicates
      </Button>
    </EmptyState>
  );
}

/**
 * Headline of how much space the extra copies take, and what the clean-up will do.
 * @param props - Component props.
 * @param props.report - the latest duplicates report
 * @param props.plan - what the current picks remove
 * @param props.plan.copies - number of copies going to the bin
 * @param props.plan.bytes - space those copies free
 * @returns the summary section
 */
function Summary({
  report,
  plan,
}: {
  report: DupReport;
  plan: { copies: number; bytes: number };
}): ReactElement {
  return (
    <ReviewHead
      className="border-b border-line"
      title={
        <>
          {count(report.extra, "extra copy", "extra copies")} taking up {formatBytes(report.bytes)}
        </>
      }
      summary={
        <>
          {plan.copies !== report.extra && (
            <p className="text-ink">
              {count(plan.copies, "copy goes", "copies go")}, freeing {formatBytes(plan.bytes)}
            </p>
          )}
          {report.unchecked > 0 && (
            <p>
              {count(report.unchecked, "newer file hasn't", "newer files haven't")} been compared
              yet
            </p>
          )}
          <p>Click a copy to keep it instead</p>
        </>
      }
      notes={
        <>
          <p>
            Each set keeps the copy marked Keep: the one already in its folder, otherwise the
            oldest. Click another copy to keep that one instead, or Keep all to leave a set alone. A
            copied Live Photo or RAW pair shows as two sets, and choosing a copy in one chooses the
            same pair in the other.
          </p>
          <p>
            Sidecar files like .aae and .xmp that only belonged to a removed copy go with it. The
            whole clean-up can be undone from History.
          </p>
        </>
      }
    />
  );
}

/**
 * Virtualised list of duplicate sets, since a big library can have thousands.
 * @param props - Component props.
 * @param props.sets - every duplicate set
 * @param props.picks - the copy chosen to keep per set, where it differs from the default
 * @param props.onPick - choose the copy to keep in a set, or null to keep all
 * @returns the scrolling list
 */
function SetList({
  sets,
  picks,
  onPick,
}: {
  sets: DupSet[];
  picks: Picks;
  onPick: (hash: string, keep: number | null) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: sets.length,
    /**
     * The list's own scroll box.
     * @returns the scrolling element, or null before it mounts
     */
    getScrollElement: () => scrollRef.current,
    /**
     * Unwrapped height, corrected once a set is measured.
     * @returns the estimated row height in pixels
     */
    estimateSize: () => SET_HEIGHT,
    overscan: 3,
  });

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Duplicate sets"
      className={`overflow-y-auto ${LIST_FILL}`}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 16 }}>
        {virtualizer.getVirtualItems().map((row) => {
          const set = sets[row.index];
          return (
            <SetRow
              key={set.hash}
              set={set}
              keep={keeperOf(set, picks)}
              index={row.index}
              top={row.start}
              measureRef={virtualizer.measureElement}
              onPick={(keep) => onPick(set.hash, keep)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * One duplicate set: its copies side by side, with a viewer to compare them bigger.
 * @param props - Component props.
 * @param props.set - the set of identical files
 * @param props.keep - id of the copy kept, or null when the whole set is left alone
 * @param props.index - position in the list, for the virtualiser's measuring
 * @param props.top - offset from the top of the list in pixels
 * @param props.measureRef - lets the virtualiser measure the drawn row
 * @param props.onPick - choose the copy to keep, or null to keep all
 * @returns the set row
 */
function SetRow({
  set,
  keep,
  index,
  top,
  measureRef,
  onPick,
}: {
  set: DupSet;
  keep: number | null;
  index: number;
  top: number;
  measureRef: (element: HTMLElement | null) => void;
  onPick: (keep: number | null) => void;
}): ReactElement {
  const [one, many] = KIND_TEXT[set.kind];
  const [viewing, setViewing] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const ids = useMemo(() => set.copies.map((c) => c.id), [set.copies]);
  const source = useLibrarySource(ids);
  const shown = viewing === null ? null : set.copies[viewing];
  return (
    <div
      ref={measureRef}
      data-index={index}
      role="listitem"
      className="absolute left-0 flex w-full flex-col px-8 pt-5"
      style={{ top, minHeight: SET_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-4">
        <p className="text-[15px] text-muted">
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
      {/* A scrolling row clips everything outside it, so the padding leaves room for the Keep
          ring and the focus outline; the negative margin keeps the photos lined up. */}
      <ul className="-mx-1.5 mt-0.5 flex gap-3 overflow-x-auto px-1.5 pt-1.5 pb-3">
        {set.copies.map((copy, index) => (
          <CopyCard
            key={copy.id}
            copy={copy}
            state={keep === null ? "keep-all" : copy.id === keep ? "keep" : "bin"}
            onKeep={() => onPick(copy.id)}
            onZoom={() => setViewing(index)}
          />
        ))}
      </ul>
      {shown && viewing !== null && (
        <Viewer
          source={source}
          index={viewing}
          onIndex={setViewing}
          onClose={closeViewer}
          steps={["Previous copy", "Next copy"]}
          controls={
            <Button
              variant="primary"
              className="w-full"
              disabled={keep === shown.id}
              onClick={() => onPick(shown.id)}
            >
              <Icon name="check" size={18} />
              {keep === shown.id ? "This is the copy kept" : "Keep this copy"}
            </Button>
          }
        />
      )}
    </div>
  );
}

/**
 * One copy: kept, going to the bin, or kept because its whole set is left alone.
 * @param props - Component props.
 * @param props.copy - the file this card shows
 * @param props.state - whether the copy stays, goes, or stays with its whole set
 * @param props.onKeep - keep this copy instead
 * @param props.onZoom - open the copy in the viewer
 * @returns the card
 */
function CopyCard({
  copy,
  state,
  onKeep,
  onZoom,
}: {
  copy: DupCopy;
  state: "keep" | "bin" | "keep-all";
  onKeep: () => void;
  onZoom: () => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const { folder, name } = splitPath(copy.path);
  const ext = name.split(".").pop() ?? "";
  const going = state === "bin";
  const notes = [
    copy.inPlace && "In its folder",
    copy.extra > 0 && `+${count(copy.extra, "file", "files")} with it`,
  ].filter(Boolean);

  return (
    <li className="group relative w-40 shrink-0">
      <button
        type="button"
        onClick={onKeep}
        aria-pressed={state === "keep"}
        title={going ? "Keep this copy instead" : undefined}
        className="group block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <span
          className={`relative block aspect-4/3 overflow-hidden rounded-[3px] bg-raised ${HOVER_RING} ${
            state === "keep" ? "ring-3 ring-accent" : ""
          }`}
        >
          {failed ? (
            <span className="flex h-full items-center justify-center text-[14px] text-faint">
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
            className={`absolute top-1.5 left-1.5 flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[13px] font-semibold ${
              going ? "on-dark bg-ground/85 text-muted" : "bg-accent text-ground"
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
        <span
          className={`selectable mt-2 block truncate text-[15px] ${going ? "text-muted" : ""}`}
          title={name}
        >
          {name}
        </span>
        <span className="selectable block truncate text-[14px] text-muted" title={folder}>
          {folder || "Library folder"}
        </span>
        <span className="block h-[1.5em] truncate text-[14px] text-faint">{notes.join(", ")}</span>
      </button>
      {/* Beside the card's button, not in it, since a button can't hold another button. */}
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Open ${name}`}
        title="Open"
        className="on-dark absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-ground/70 text-ink opacity-0 group-hover:opacity-100 hover:bg-ground focus-visible:bg-ground focus-visible:opacity-100"
      >
        <Icon name="zoom" size={18} />
      </button>
    </li>
  );
}
