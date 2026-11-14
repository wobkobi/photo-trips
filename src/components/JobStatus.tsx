import { api } from "../lib/api";
import { useJobs } from "../lib/useJobs";
import { Icon } from "./Icon";
import { Progress } from "./ui";

const JOB_NAMES: Record<string, string> = {
  index: "Updating the library",
};

/** Sidebar footer: progress of the running job, or the error from the last one. */
export function JobStatus() {
  const { running, lastDone, clearLastDone } = useJobs();

  if (running) {
    return (
      <div className="rounded-md border border-line bg-ground/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">
            {JOB_NAMES[running.kind] ?? "Working"}
          </span>
          <button
            type="button"
            onClick={() => api.cancelJob()}
            className="shrink-0 text-[12px] text-muted hover:text-paper"
          >
            Cancel
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
    <div role="alert" className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3">
      <Icon name="warn" size={16} className="mt-0.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-[12px] break-words text-paper">{lastDone.done.error}</p>
      <button
        type="button"
        onClick={clearLastDone}
        aria-label="Dismiss"
        className="shrink-0 self-start text-muted hover:text-paper"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
