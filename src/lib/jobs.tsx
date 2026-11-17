import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { api, type JobDone, type JobProgress } from "./api";
import { JobsContext, type FinishedJob } from "./useJobs";

/**
 * Tracks the running background job and the last one to finish, from the backend's events.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function JobsProvider({ children }: { children: ReactNode }): ReactElement {
  const [running, setRunning] = useState<JobProgress | null>(null);
  const [lastDone, setLastDone] = useState<FinishedJob | null>(null);
  // Kept apart from lastDone so clearing a result never lets a later job reuse its number: a
  // listener that saw job 3 would otherwise ignore the next job if it came out as 1 again.
  const seqRef = useRef(0);

  useEffect(() => {
    let active = true;
    // A job may have started before the window loaded (the startup index).
    void api.jobStatus().then((progress) => {
      if (active && progress) setRunning((current) => current ?? progress);
    });
    const subscriptions = [
      listen<JobProgress>("job://progress", (event) => setRunning(event.payload)),
      listen<JobDone>("job://done", (event) => {
        setRunning(null);
        seqRef.current += 1;
        setLastDone({ seq: seqRef.current, done: event.payload });
      }),
    ];
    return () => {
      active = false;
      subscriptions.forEach((subscription) => void subscription.then((off) => off()));
    };
  }, []);

  const clearLastDone = useCallback(() => setLastDone(null), []);

  return (
    <JobsContext.Provider value={{ running, lastDone, clearLastDone }}>
      {children}
    </JobsContext.Provider>
  );
}
