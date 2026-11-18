import { useEffect, useRef, type ReactElement } from "react";
import { api } from "../lib/api";
import { JOB_NAMES, useJobs } from "../lib/useJobs";
import { Icon } from "./Icon";
import { Progress } from "./ui";

/**
 * Sidebar footer: progress of the running job, or the error from the last one. In a narrow
 * sidebar the job shows as a bar and a percentage, and an error as a warning button that widens
 * the sidebar to show it.
 * @param props - Component props.
 * @param props.narrow - the sidebar shows icons only
 * @param props.onWiden - widen the sidebar
 * @returns the footer, or nothing when there's nothing to say
 */
export function JobStatus({
  narrow = false,
  onWiden,
}: {
  narrow?: boolean;
  onWiden?: () => void;
}): ReactElement | null {
  const { running, lastDone, clearLastDone } = useJobs();
  // Set when the narrow warning button widens the menu, so focus lands on the message it
  // replaced rather than dropping to the page.
  const focusHide = useRef(false);
  const hideRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!narrow && focusHide.current) {
      focusHide.current = false;
      hideRef.current?.focus();
    }
  }, [narrow]);

  if (running && narrow) {
    const name = JOB_NAMES[running.kind] ?? "Working";
    const pct =
      running.total > 0 ? Math.min(100, Math.round((running.done / running.total) * 100)) : null;
    // No live region: the percentage changes on every tick and a screen reader would read each
    // one. The progress bar role lets it be asked for instead.
    return (
      <div
        title={`${name}: ${running.stage}`}
        className="flex flex-col items-center gap-1.5 rounded-md border border-line bg-surface/60 px-1 py-2"
      >
        <span aria-hidden className="text-[14px] font-semibold">
          {pct === null ? "..." : `${pct}%`}
        </span>
        <div
          role="progressbar"
          aria-label={name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? undefined}
          className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
        >
          <div
            className={`h-full bg-accent ${pct === null ? "w-1/3 animate-pulse" : ""}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => api.cancelJob()}
          aria-label={`Stop ${name.toLowerCase()}`}
          title="Stop"
          className="flex min-h-8.5 w-full items-center justify-center rounded-md text-ink hover:bg-raised"
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    );
  }

  if (running) {
    return (
      <div className="px-2.5 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-[14px] font-semibold">
            {JOB_NAMES[running.kind] ?? "Working"}
          </span>
          <button
            type="button"
            onClick={() => api.cancelJob()}
            aria-label={`Stop ${(JOB_NAMES[running.kind] ?? "working").toLowerCase()}`}
            title="Stop"
            className="-mr-1.5 flex size-8.5 shrink-0 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-ink"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="mt-1">
          <Progress done={running.done} total={running.total} label={running.stage} />
        </div>
      </div>
    );
  }

  const failed = lastDone && !lastDone.done.ok && !lastDone.done.cancelled;
  if (!failed) return null;
  if (narrow) {
    return (
      <div role="alert" className="flex">
        <button
          type="button"
          onClick={() => {
            focusHide.current = true;
            onWiden?.();
          }}
          title={lastDone.done.error ?? undefined}
          aria-label="Something went wrong. Widen the menu to read it."
          className="flex min-h-8.5 flex-1 items-center justify-center rounded-md border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
        >
          <Icon name="warn" size={20} />
        </button>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
      <div className="flex gap-2">
        <Icon name="warn" size={18} className="mt-0.5 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-[14px] wrap-break-word text-ink">{lastDone.done.error}</p>
      </div>
      <button
        ref={hideRef}
        type="button"
        onClick={clearLastDone}
        className="mt-2 min-h-8.5 rounded-md bg-raised px-3 text-[14px] font-semibold text-ink hover:bg-line"
      >
        Dismiss
      </button>
    </div>
  );
}
