import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { InboxSettings } from "../components/InboxSettings";
import { Row, SavedText, Section, Toggle } from "../components/SettingParts";
import { SuggestionSettings } from "../components/SuggestionSettings";
import { Button, PageHeader } from "../components/ui";
import { normaliseExtensions } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useSettings } from "../lib/useSettings";

/** App settings: library, inbox folders, suggestions, file types and window behaviour. */
export function SettingsPage() {
  const { settings, save } = useSettings();
  const library = useAction();
  const types = useAction();
  const windowing = useAction();
  const [autostart, setAutostart] = useState<boolean | null>(null);

  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
  }, []);

  async function changeLibrary() {
    const picked = await open({ directory: true, title: "Choose your photo library folder" });
    if (typeof picked === "string") await library.run(() => save("library_root", picked));
  }

  const closeToTray = settings?.close_to_tray !== "false";

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl px-8 py-8">
        <Section title="Library" error={library.error}>
          <Row
            title="Library folder"
            detail={<span className="selectable">{settings?.library_root}</span>}
          >
            <Button onClick={changeLibrary}>Change folder</Button>
          </Row>
        </Section>

        <InboxSettings />
        <SuggestionSettings />

        <Section
          title="File types"
          error={types.error}
          detail="The usual photo, RAW and video types are already known. Add any others by their extension, like xyz, abc. Files of unknown types are never moved."
        >
          <Row title="Extra photo types">
            <SavedText
              value={settings?.extra_photo_exts ?? ""}
              label="Extra photo types"
              placeholder="None"
              className="w-52"
              tidy={normaliseExtensions}
              onRevert={types.clear}
              onSave={(text) => types.run(() => save("extra_photo_exts", text))}
            />
          </Row>
          <Row title="Extra video types">
            <SavedText
              value={settings?.extra_video_exts ?? ""}
              label="Extra video types"
              placeholder="None"
              className="w-52"
              tidy={normaliseExtensions}
              onRevert={types.clear}
              onSave={(text) => types.run(() => save("extra_video_exts", text))}
            />
          </Row>
        </Section>

        <Section title="Window" error={windowing.error}>
          <Row
            title="Keep running in the tray"
            detail="Closing the window leaves Photo Trips in the system tray so it can watch for new photos and devices."
          >
            <Toggle
              checked={closeToTray}
              label="Keep running in the tray"
              onChange={(on) => windowing.run(() => save("close_to_tray", on ? "true" : "false"))}
            />
          </Row>
          <Row title="Start with Windows" detail="Opens quietly in the tray when you sign in.">
            <Toggle
              checked={autostart ?? false}
              disabled={autostart === null}
              label="Start with Windows"
              onChange={(on) =>
                windowing.run(async () => {
                  await (on ? enable() : disable());
                  setAutostart(on);
                })
              }
            />
          </Row>
        </Section>
      </div>
    </>
  );
}
