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
 * Run `effect` each time a job of `kind` finishes after the calling component mounted.
 * @param kind - job kind, e.g. "index"
 * @param effect - called with the job's outcome
 */
export function useJobDone(kind: string, effect: (done: JobDone) => void): void {
  const { lastDone } = useJobs();
  const effectRef = useRef(effect);
  const seenRef = useRef(lastDone?.seq ?? 0);

  useEffect(() => {
    effectRef.current = effect;
  });

  useEffect(() => {
    if (!lastDone || lastDone.seq <= seenRef.current) return;
    seenRef.current = lastDone.seq;
    if (lastDone.done.kind === kind) effectRef.current(lastDone.done);
  }, [lastDone, kind]);
}
