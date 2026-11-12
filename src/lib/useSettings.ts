import { createContext, useContext } from "react";
import type { Settings } from "./api";

export interface SettingsContextValue {
  settings: Settings | null;
  /** Save one setting and update local state once the backend accepts it. */
  save: (key: string, value: string) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

/** Access the shared settings. Must be used under SettingsProvider. */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings outside SettingsProvider");
  return ctx;
}
