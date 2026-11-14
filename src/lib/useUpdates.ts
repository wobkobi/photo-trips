import { createContext, useContext } from "react";
import type { UpdateAvailable, UpdateProgress } from "./api";

/** Where a check for updates has got: "latest" once one found nothing newer. */
export type CheckState = "idle" | "checking" | "latest";

export interface UpdatesContextValue {
  check: CheckState;
  /** The newer version found by the last check, the daily one included. */
  update: UpdateAvailable | null;
  /** Set while an update downloads and installs. */
  progress: UpdateProgress | null;
  /** Why the last check or install failed. */
  error: string | null;
  /** Check for a newer version now. */
  runCheck: () => Promise<void>;
  /** Download and install the update found; the app closes and reopens when it works. */
  install: () => Promise<void>;
}

export const UpdatesContext = createContext<UpdatesContextValue | null>(null);

/** Update checks and installs. Must be used under UpdatesProvider. */
export function useUpdates(): UpdatesContextValue {
  const ctx = useContext(UpdatesContext);
  if (!ctx) throw new Error("useUpdates outside UpdatesProvider");
  return ctx;
}
