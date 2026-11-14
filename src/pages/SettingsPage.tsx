import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { isEnabled } from "@tauri-apps/plugin-autostart";
import { BrandMark } from "../components/BrandMark";
import { InboxSettings } from "../components/InboxSettings";
import { LegalLinks } from "../components/LegalLinks";
import { Row, SavedText, Section, Toggle } from "../components/SettingParts";
import { SuggestionSettings } from "../components/SuggestionSettings";
import { Button, PageHeader } from "../components/ui";
import { UpdateCheck } from "../components/UpdateCheck";
import { api, AUTOSTART_CHANGED } from "../lib/api";
import { normaliseExtensions } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useSettings } from "../lib/useSettings";

/**
 * App settings (library, inbox folders, suggestions, file types and window behaviour), then
 * the app's version, maker and updates.
 * @param props.showAbout - Help > About or Check for updates was picked; scroll to the About
 * section on opening
 * @param props.onAboutShown - called once About has been scrolled into view
 * @returns the page
 */
export function SettingsPage({
  showAbout,
  onAboutShown,
}: {
  showAbout: boolean;
  onAboutShown: () => void;
}) {
  const { settings, save } = useSettings();
  const library = useAction();
  const types = useAction();
  const windowing = useAction();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const about = useRef<HTMLDivElement>(null);

  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
    getVersion().then(setVersion, () => setVersion(null));
    // The menu bar's Start with Windows tick changes it too.
    const unlisten = listen<boolean>(AUTOSTART_CHANGED, ({ payload }) => setAutostart(payload));
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

  useEffect(() => {
    if (!showAbout) return;
    about.current?.scrollIntoView({ block: "start" });
    onAboutShown();
  }, [showAbout, onAboutShown]);

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
            detail="Closing the window leaves Pic Cabinet in the system tray so it can watch for new photos and devices."
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
              onChange={(on) => windowing.run(() => api.setAutostart(on))}
            />
          </Row>
        </Section>

        <div ref={about} className="mt-12">
          <Section title="About">
            <div className="flex items-center gap-4">
              <BrandMark size={48} className="shrink-0 text-brand" />
              <div>
                <p className="text-[17px] leading-tight font-extrabold">Pic Cabinet</p>
                {version && <p className="mt-1 text-[13px] text-muted">Version {version}</p>}
                <p className="mt-0.5 text-[13px] text-muted">
                  © 2026 To the Point Tech. All rights reserved.
                </p>
                <LegalLinks />
              </div>
            </div>
            <UpdateCheck />
          </Section>
        </div>
      </div>
    </>
  );
}
