import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { api, SETTING_CHANGED, type SettingChange, type Settings } from "./api";
import { SettingsContext } from "./useSettings";

/**
 * Loads settings once and shares them with the whole app.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function SettingsProvider({ children }: { children: ReactNode }): ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);

  const reload = useCallback(() => {
    api.getSettings().then(setSettings, () => setSettings((prev) => prev ?? {}));
  }, []);

  useEffect(() => {
    reload();
    // The menu bar saves some settings itself.
    const unlisten = listen<SettingChange>(SETTING_CHANGED, ({ payload }) =>
      setSettings((prev) => ({ ...prev, [payload.key]: payload.value })),
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, [reload]);

  const save = useCallback(async (key: string, value: string) => {
    await api.setSetting(key, value);
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, save, reload }}>
      {children}
    </SettingsContext.Provider>
  );
}
