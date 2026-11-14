import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, type Settings } from "./api";
import { SettingsContext } from "./useSettings";

/**
 * Loads settings once and shares them with the whole app.
 * @param props.children - app content
 * @returns the provider element
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings, () => setSettings({}));
  }, []);

  const save = useCallback(async (key: string, value: string) => {
    await api.setSetting(key, value);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return <SettingsContext.Provider value={{ settings, save }}>{children}</SettingsContext.Provider>;
}
