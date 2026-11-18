import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type ReactElement } from "react";
import { api, WATCH_CHANGED, type WatchStatus } from "../lib/api";
import { folderName, parseFolders, samePath, watchSummary } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useSettings } from "../lib/useSettings";
import { Icon } from "./Icon";
import { Row, Section, Toggle } from "./SettingParts";
import { Button } from "./ui";

/**
 * Inbox folders: the list, adding and removing, and pausing the watcher.
 * @returns the settings section
 */
export function InboxSettings(): ReactElement {
  const { settings, save } = useSettings();
  const { error, run } = useAction();
  const [status, setStatus] = useState<WatchStatus | null>(null);
  const folders = parseFolders(settings?.inbox_folders);

  // The tray can pause watching and files arriving change the waiting count, so follow events.
  useEffect(() => {
    let live = true;
    api.watchStatus().then(
      (first) => live && setStatus((current) => current ?? first),
      () => {},
    );
    const unlisten = listen<WatchStatus>(WATCH_CHANGED, (event) => setStatus(event.payload));
    return () => {
      live = false;
      void unlisten.then((off) => off());
    };
  }, []);

  /**
   * Save the inbox folder list; a failure shows as the section's error.
   * @param next - the full list of folders to watch
   * @returns resolves true once saved, false if the save failed
   */
  const saveFolders = (next: string[]): Promise<boolean> =>
    run(() => save("inbox_folders", JSON.stringify(next)));

  /** Ask for a folder and add it to the list, unless the picker was cancelled. */
  async function addFolder(): Promise<void> {
    const picked = await open({ directory: true, title: "Choose an inbox folder" });
    if (typeof picked === "string") await saveFolders([...folders, picked]);
  }

  /**
   * Whether the watcher reported this folder as missing, e.g. on a drive that's unplugged.
   * @param folder - a folder from the list
   * @returns true when it can't be found
   */
  const isMissing = (folder: string): boolean =>
    status?.missing.some((path) => samePath(path, folder)) ?? false;

  return (
    <Section
      title="Inbox folders"
      error={error}
      detail={
        <>
          <p>New photos and videos put here move into the library, and can be undone in History.</p>
          <p>
            Files are moved, not copied, so in a OneDrive or Dropbox folder they leave the cloud.
          </p>
        </>
      }
    >
      {folders.length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-md border border-line bg-surface">
          {folders.map((folder) => {
            const missing = isMissing(folder);
            return (
              <li key={folder} className="flex items-center gap-3 py-2 pr-2 pl-3">
                <Icon
                  name={missing ? "warn" : "folder"}
                  className={`shrink-0 ${missing ? "text-warn" : "text-muted"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{folderName(folder)}</p>
                  <p className="selectable truncate text-[14px] text-muted" title={folder}>
                    {folder}
                  </p>
                  {missing && (
                    <p className="text-[14px] text-warn">
                      Can't be found. Reconnect its drive, or remove it here.
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Stop watching ${folder}`}
                  onClick={() => saveFolders(folders.filter((other) => other !== folder))}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mb-4">
        <Button onClick={addFolder}>
          <Icon name="folder" size={16} />
          Add folder
        </Button>
      </div>
      {folders.length > 0 && status && (
        <Row title="Watch inbox folders" detail={watchSummary(status)}>
          <Toggle
            checked={!status.paused}
            label="Watch inbox folders"
            onChange={(on) => run(async () => setStatus(await api.setWatchPaused(!on)))}
          />
        </Row>
      )}
    </Section>
  );
}
