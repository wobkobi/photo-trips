import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Icon } from "../components/Icon";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { api, errorText, type BatchEntry, type BatchInfo, type EntryStatus } from "../lib/api";
import { count, formatWhen } from "../lib/format";
import { useJobDone, useJobs } from "../lib/useJobs";

/** Files listed per batch by the backend (history.rs ENTRY_LIMIT). */
const ENTRY_LIMIT = 2000;

/**
 * Every change Pic Cabinet made to the library, newest first, each with undo.
 * @returns the page
 */
export function HistoryPage(): ReactElement {
  const { running } = useJobs();
  const [batches, setBatches] = useState<BatchInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  const load = useCallback(() => {
    api.listBatches().then(
      (loaded) => {
        setBatches(loaded);
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  useEffect(load, [load]);
  useJobDone(["apply", "undo", "remove", "import", "inbox"], load);

  /**
   * Undo a batch and reload the list, showing any failure as the page error.
   * @param batchId - the batch to undo
   */
  async function undo(batchId: number): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      await api.undoBatch(batchId);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <>
      <PageHeader
        title="History"
        detail="Every change Pic Cabinet makes to your files. Undo puts them back where they were."
      />
      {error && (
        <p role="alert" className="mx-8 mt-4 text-danger">
          {error}
        </p>
      )}
      {batches !== null && batches.length === 0 && (
        <EmptyState title="No changes yet">
          <p>When Pic Cabinet moves files, each change is listed here so you can undo it.</p>
        </EmptyState>
      )}
      {batches !== null && batches.length > 0 && (
        <ol className="flex max-w-3xl flex-col gap-3 px-8 py-6">
          {batches.map((batch) => (
            <BatchRow
              key={batch.id}
              batch={batch}
              busy={running !== null}
              expanded={expanded === batch.id}
              confirming={confirming === batch.id}
              onToggle={() => setExpanded(expanded === batch.id ? null : batch.id)}
              onAskUndo={() => setConfirming(batch.id)}
              onCancelUndo={() => setConfirming(null)}
              onUndo={() => undo(batch.id)}
            />
          ))}
        </ol>
      )}
    </>
  );
}

/**
 * One batch: what it did, where it stands, and its undo with a confirm step.
 * @param props - Component props.
 * @param props.batch - the batch shown
 * @param props.busy - a job is running, so undo is disabled
 * @param props.expanded - its file list is open
 * @param props.confirming - the undo question is showing
 * @param props.onToggle - open or close the file list
 * @param props.onAskUndo - show the undo question
 * @param props.onCancelUndo - dismiss the undo question
 * @param props.onUndo - undo the batch
 * @returns the row
 */
function BatchRow({
  batch,
  busy,
  expanded,
  confirming,
  onToggle,
  onAskUndo,
  onCancelUndo,
  onUndo,
}: {
  batch: BatchInfo;
  busy: boolean;
  expanded: boolean;
  confirming: boolean;
  onToggle: () => void;
  onAskUndo: () => void;
  onCancelUndo: () => void;
  onUndo: () => void;
}): ReactElement {
  const trouble = batch.failed > 0 || batch.status === "interrupted";
  return (
    <li className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <div className="min-w-0 flex-1">
          {/* Labels can hold a whole folder path, which has nowhere else to break. */}
          <p className="font-semibold wrap-anywhere">{batch.label}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-[15px] text-muted">
            <span>{formatWhen(batch.createdAt)}</span>
            <span className={trouble ? "text-warn" : undefined}>{statusText(batch)}</span>
          </p>
        </div>
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px]">{confirmText(batch)}</span>
            <Button variant="primary" onClick={onUndo} disabled={busy}>
              Put back
            </Button>
            <Button variant="ghost" onClick={onCancelUndo}>
              Keep
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {batch.total > 0 && (
              <Button variant="ghost" onClick={onToggle} aria-expanded={expanded}>
                {expanded ? "Hide files" : "Show files"}
              </Button>
            )}
            {batch.canUndo && (
              <Button onClick={onAskUndo} disabled={busy}>
                <Icon name="undo" size={16} />
                Undo
              </Button>
            )}
          </div>
        )}
      </div>
      {expanded && <Entries batch={batch} />}
    </li>
  );
}

/**
 * The question before undoing. A trip change also puts the trip back as it was; undoing a
 * copied-in import sends the copies to the Recycle Bin, since the originals are still there.
 * @param batch - the batch
 * @returns the question
 */
function confirmText(batch: BatchInfo): string {
  const files = count(batch.done, "file", "files");
  switch (batch.kind) {
    case "duplicates":
      return `Take ${files} out of the Recycle Bin?`;
    case "import":
      return `Move the ${files} copied in to the Recycle Bin? The originals stay where they are.`;
    case "import_move":
      return `Put ${files} back where they came from?`;
    case "trip":
      return batch.done > 0 ? `Undo this and put ${files} back?` : "Undo this trip change?";
    default:
      return `Put ${files} back?`;
  }
}

/** What a batch did to its files, by batch kind. */
const DID_TEXT: Record<string, string> = {
  duplicates: "sent to the Recycle Bin",
  import: "copied in",
  import_move: "moved in",
};

/**
 * One line on what a batch did and where it stands now.
 * @param batch - the batch
 * @returns the sentence
 */
function statusText(batch: BatchInfo): string {
  const did = DID_TEXT[batch.kind] ?? "moved";
  const moved = `${count(batch.done, "file", "files")} ${did}`;
  switch (batch.status) {
    case "running":
    case "undoing":
      return "In progress";
    case "done":
      return batch.total === 0 ? "No files needed to move" : moved;
    case "partial":
      return `${moved}, ${count(batch.failed, "file", "files")} couldn't be`;
    case "failed":
      if (batch.kind === "duplicates") return "Every copy was kept";
      return batch.kind.startsWith("import")
        ? "Nothing could be brought in"
        : "Nothing could be moved";
    case "cancelled":
      return `Stopped part-way, ${moved}`;
    case "interrupted":
      return `Stopped when Pic Cabinet closed, ${moved}`;
    case "undone":
      return batch.undoneAt ? `Undone ${formatWhen(batch.undoneAt)}` : "Undone";
    case "partly_undone":
      return `${count(batch.undone, "file", "files")} put back, ${count(batch.done, "file", "files")} couldn't be`;
  }
}

const ENTRY_TEXT: Record<EntryStatus, string> = {
  pending: "Waiting",
  done: "Moved",
  failed: "Not moved",
  skipped: "Not moved",
  undoing: "Putting back",
  undone: "Put back",
};

/** The same states for a file sent to the Recycle Bin. */
const TRASH_TEXT: Record<EntryStatus, string> = {
  ...ENTRY_TEXT,
  done: "In the bin",
  failed: "Kept",
  skipped: "Kept",
};

/** The same states for a file copied in; undoing one sends the copy to the Recycle Bin. */
const COPY_TEXT: Record<EntryStatus, string> = {
  ...ENTRY_TEXT,
  done: "Copied in",
  failed: "Not copied",
  skipped: "Not copied",
  undoing: "Removing",
  undone: "In the bin",
};

const OP_TEXT: Record<BatchEntry["op"], Record<EntryStatus, string>> = {
  move: ENTRY_TEXT,
  import: ENTRY_TEXT,
  trash: TRASH_TEXT,
  copy: COPY_TEXT,
};

/**
 * The files in a batch and what happened to each, reloaded as the batch progresses.
 * @param props - Component props.
 * @param props.batch - the batch whose files are listed
 * @returns the file list
 */
function Entries({ batch }: { batch: BatchInfo }): ReactElement {
  const [entries, setEntries] = useState<BatchEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.batchEntries(batch.id).then(setEntries, (err) => setError(errorText(err)));
  }, [batch.id, batch.status, batch.done]);

  if (error) return <p className="border-t border-line px-4 py-3 text-danger">{error}</p>;
  if (!entries) return <p className="border-t border-line px-4 py-3 text-muted">Loading files</p>;

  return (
    <div className="border-t border-line">
      <ul className="max-h-[50vh] overflow-y-auto px-4 py-2">
        {entries.map((entry) => (
          <li key={entry.seq} className="flex gap-3 py-1.5 text-[15px]">
            <span
              className={`w-24 shrink-0 ${entry.error ? "text-warn" : "text-muted"}`}
              title={entry.error ?? undefined}
            >
              {OP_TEXT[entry.op][entry.status]}
            </span>
            <span className="min-w-0 flex-1">
              {/* Full paths, wrapping as needed: where a file went is what this list is for. */}
              <span className="selectable flex min-w-0 flex-wrap items-center gap-x-1.5">
                <span className="min-w-0 break-all text-muted">{entry.from}</span>
                <Icon name="chevron" size={12} className="shrink-0 text-faint" />
                <span className="min-w-0 break-all">
                  {entry.op === "trash" ? "Recycle Bin" : entry.to}
                </span>
              </span>
              {entry.error && (
                <span className="selectable block text-[14px] text-warn">{entry.error}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {batch.total > ENTRY_LIMIT && (
        <p className="border-t border-line px-4 py-2 text-[14px] text-faint">
          Showing the first {ENTRY_LIMIT.toLocaleString()} of {batch.total.toLocaleString()} files.
        </p>
      )}
    </div>
  );
}
