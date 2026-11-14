import { useCallback, useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  errorText,
  UPDATE_AVAILABLE,
  UPDATE_PROGRESS,
  type UpdateAvailable,
  type UpdateProgress,
} from "./api";
import { UpdatesContext, type CheckState } from "./useUpdates";

/**
 * Holds update state for the whole app, so the tray and Help menu can start a check before
 * Settings has opened.
 * @param props.children - app content
 * @returns the provider element
 */
export function UpdatesProvider({ children }: { children: ReactNode }) {
  const [check, setCheck] = useState<CheckState>("idle");
  const [update, setUpdate] = useState<UpdateAvailable | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // The daily check may have found one before the window loaded.
    api.updateStatus().then(
      (found) => {
        if (active && found) setUpdate((current) => current ?? found);
      },
      () => {},
    );
    const subscriptions = [
      listen<UpdateAvailable>(UPDATE_AVAILABLE, ({ payload }) => setUpdate(payload)),
      listen<UpdateProgress>(UPDATE_PROGRESS, ({ payload }) => setProgress(payload)),
    ];
    return () => {
      active = false;
      subscriptions.forEach((subscription) => subscription.then((off) => off()));
    };
  }, []);

  const runCheck = useCallback(async () => {
    setError(null);
    setCheck("checking");
    try {
      const found = await api.checkForUpdate();
      setUpdate(found);
      setCheck(found ? "idle" : "latest");
    } catch (err) {
      setError(errorText(err));
      setCheck("idle");
    }
  }, []);

  const install = useCallback(async () => {
    setError(null);
    setProgress({ stage: "downloading", done: 0, total: null });
    try {
      // Only returns when the install failed: on success the app closes.
      await api.installUpdate();
    } catch (err) {
      setError(errorText(err));
    }
    setProgress(null);
  }, []);

  return (
    <UpdatesContext.Provider value={{ check, update, progress, error, runCheck, install }}>
      {children}
    </UpdatesContext.Provider>
  );
}
