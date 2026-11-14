import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { isEnabled } from "@tauri-apps/plugin-autostart";
import type { PageId } from "../App";
import { BrandMark } from "../components/BrandMark";
import { FolderNames } from "../components/FolderNames";
import { Icon } from "../components/Icon";
import { InboxSettings } from "../components/InboxSettings";
import { LegalLinks } from "../components/LegalLinks";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { Choices, Row, SavedText, Section, Toggle } from "../components/SettingParts";
import { SuggestionSettings } from "../components/SuggestionSettings";
import { Button, PageHeader } from "../components/ui";
import { UpdateCheck } from "../components/UpdateCheck";
import { api, AUTOSTART_CHANGED, errorText, type ApplySummary, type Preview } from "../lib/api";
import { count } from "../lib/format";
import { PHOTO_SIZES, photoSizeOf, TEXT_SIZES, textSizeOf } from "../lib/display";
import { normaliseExtensions } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";

/**
 * App settings (text and photo sizes, library, folder names, inbox folders, suggestions, file
 * types and window behaviour), then the app's version, maker and updates. A folder name change
 * swaps the page for its preview of the renames until it's applied or abandoned.
 * @param props.showAbout - Help > About or Check for updates was picked; scroll to the About
 * section on opening
 * @param props.onAboutShown - called once About has been scrolled into view
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function SettingsPage({
  showAbout,
  onAboutShown,
  onNavigate,
}: {
  showAbout: boolean;
  onAboutShown: () => void;
  onNavigate: (page: PageId) => void;
}) {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const [review, setReview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplySummary | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const display = useAction();
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

  useJobDone("apply", (done) => {
    if (!applying) return;
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setRenameError(done.error);
    setApplying(false);
    setReview(null);
  });
  useJobDone("undo", () => setResult(null));

  async function rename(preview: Preview) {
    setRenameError(null);
    setApplying(true);
    try {
      await api.applyPlan(preview.id);
    } catch (err) {
      setApplying(false);
      setRenameError(errorText(err));
    }
  }

  async function undo(batchId: number) {
    setRenameError(null);
    try {
      await api.undoBatch(batchId);
    } catch (err) {
      setRenameError(errorText(err));
    }
  }

  async function changeLibrary() {
    const picked = await open({ directory: true, title: "Choose your photo library folder" });
    if (typeof picked === "string") await library.run(() => save("library_root", picked));
  }

  const closeToTray = settings?.close_to_tray !== "false";
  const errorLine = renameError && (
    <p role="alert" className="mx-8 mt-4 text-danger">
      {renameError}
    </p>
  );

  if (review !== null) {
    const moving = applying && running !== null;
    return (
      <div className="flex h-full flex-col">
        <PageHeader
          title="Folder names"
          detail="Every sorted folder gets its new name. Files outside them stay where they are."
          actions={
            !moving && (
              <>
                <Button variant="ghost" onClick={() => setReview(null)} disabled={applying}>
                  <Icon name="back" size={16} />
                  Back to Settings
                </Button>
                <Button
                  variant="primary"
                  onClick={() => rename(review)}
                  disabled={applying || running !== null}
                >
                  {review.files > 0
                    ? `Rename folders and move ${count(review.files, "file", "files")}`
                    : "Save folder names"}
                </Button>
              </>
            )
          }
        />
        {errorLine}
        {moving ? <MovingProgress job={running} /> : <PlanView preview={review} />}
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Settings" />
      {errorLine}
      {result && (
        <ResultBanner
          result={result}
          intro="Changed the folder names."
          undoable
          busy={running !== null}
          onUndo={() => undo(result.batchId)}
          onHistory={() => onNavigate("history")}
        />
      )}
      <div className="max-w-2xl px-8 py-8">
        <Section
          title="Display"
          detail="Make the words and photos bigger if they're hard to see. Changes show straight away."
          error={display.error}
        >
          <Choices
            title="Text size"
            detail="Buttons and spacing grow with the words."
            value={textSizeOf(settings)}
            options={TEXT_SIZES.map((size) => ({
              ...size,
              sample: (
                <span
                  aria-hidden="true"
                  className="leading-none font-bold"
                  style={{ fontSize: (18 * Number(size.value)) / 100 }}
                >
                  Aa
                </span>
              ),
            }))}
            onChange={(value) => display.run(() => save("text_size", value))}
          />
          <Choices
            title="Photo size"
            detail="How big photos are in the Library."
            value={photoSizeOf(settings)}
            options={PHOTO_SIZES.map((size) => ({
              ...size,
              sample: (
                <span
                  aria-hidden="true"
                  className="rounded-[3px] border-2 border-current opacity-80"
                  style={{ width: size.tile / 7, height: size.tile / 7 }}
                />
              ),
            }))}
            onChange={(value) => display.run(() => save("photo_size", value))}
          />
        </Section>

        <Section title="Library" error={library.error}>
          <Row
            title="Library folder"
            detail={<span className="selectable">{settings?.library_root}</span>}
          >
            <Button onClick={changeLibrary}>Change folder</Button>
          </Row>
        </Section>

        <FolderNames
          busy={running !== null}
          onReview={(preview) => {
            setResult(null);
            setRenameError(null);
            setReview(preview);
          }}
        />

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
                {version && <p className="mt-1 text-[15px] text-muted">Version {version}</p>}
                <p className="mt-0.5 text-[15px] text-muted">
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
