import { api } from "../lib/api";
import { JOB_NAMES, useJobs } from "../lib/useJobs";
import { Icon } from "./Icon";
import { Progress } from "./ui";

/** Sidebar footer: progress of the running job, or the error from the last one. */
export function JobStatus() {
  const { running, lastDone, clearLastDone } = useJobs();

  if (running) {
    return (
      <div className="rounded-md border border-line bg-surface/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">
            {JOB_NAMES[running.kind] ?? "Working"}
          </span>
          <button
            type="button"
            onClick={() => api.cancelJob()}
            className="min-h-11 shrink-0 rounded-md px-2 text-[15px] text-ink underline underline-offset-4 hover:bg-raised"
          >
            Stop
          </button>
        </div>
        <div className="mt-2">
          <Progress done={running.done} total={running.total} label={running.stage} />
        </div>
      </div>
    );
  }

  const failed = lastDone && !lastDone.done.ok && !lastDone.done.cancelled;
  if (!failed) return null;
  return (
    <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3">
      <div className="flex gap-2">
        <Icon name="warn" size={18} className="mt-0.5 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-[15px] break-words text-ink">{lastDone.done.error}</p>
      </div>
      <button
        type="button"
        onClick={clearLastDone}
        className="mt-2 min-h-11 rounded-md px-2 text-[15px] text-ink underline underline-offset-4 hover:bg-raised"
      >
        Hide this message
      </button>
    </div>
  );
}
