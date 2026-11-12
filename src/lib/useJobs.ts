import { createContext, useContext, useEffect, useRef } from "react";
import type { JobDone, JobProgress } from "./api";

export interface FinishedJob {
  /** Increases with every finished job, so listeners can tell new results from old. */
  seq: number;
  done: JobDone;
}

export interface JobsContextValue {
  running: JobProgress | null;
  lastDone: FinishedJob | null;
  /** Forget the last result (dismisses its error message). */
  clearLastDone: () => void;
}

export const JobsContext = createContext<JobsContextValue | null>(null);

/** Background job state. Must be used under JobsProvider. */
export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs outside JobsProvider");
  return ctx;
}

/**
 * Run `effect` each time a job of one of `kinds` finishes after the calling component mounted.
 * @param kinds - job kind or kinds, e.g. "index" or ["apply", "undo"]
 * @param effect - called with the job's outcome
 */
export function useJobDone(
  kinds: string | readonly string[],
  effect: (done: JobDone) => void,
): void {
  const { lastDone } = useJobs();
  const effectRef = useRef(effect);
  const seenRef = useRef(lastDone?.seq ?? 0);
  // Joined so a fresh array literal each render doesn't re-run the effect below.
  const kindList = typeof kinds === "string" ? kinds : kinds.join(",");

  useEffect(() => {
    effectRef.current = effect;
  });

  useEffect(() => {
    if (!lastDone || lastDone.seq <= seenRef.current) return;
    seenRef.current = lastDone.seq;
    if (kindList.split(",").includes(lastDone.done.kind)) effectRef.current(lastDone.done);
  }, [lastDone, kindList]);
}
