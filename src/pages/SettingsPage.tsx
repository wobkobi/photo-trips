import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { AppIcon } from "../components/AppIcon";
import { BrandMark } from "../components/BrandMark";
import { FolderNames } from "../components/FolderNames";
import { InboxSettings } from "../components/InboxSettings";
import { LegalLinks } from "../components/LegalLinks";
import { MovingProgress, PlanView } from "../components/PlanPreview";
import { Choices, Row, SavedText, Section, Toggle } from "../components/SettingParts";
import { SuggestionSettings } from "../components/SuggestionSettings";
import { Button, PageHeader } from "../components/ui";
import { UpdateCheck } from "../components/UpdateCheck";
import { api, AUTOSTART_CHANGED, errorText, type Preview } from "../lib/api";
import { PHOTO_SIZES, photoSizeOf, TEXT_SIZES, textSizeOf, themeOf, THEMES } from "../lib/display";
import { count } from "../lib/format";
import { normaliseExtensions } from "../lib/settingValues";
import { useAction } from "../lib/useAction";
import { useJobDone, useJobs } from "../lib/useJobs";
import { usePageMemory } from "../lib/usePageMemory";
import { useSettings } from "../lib/useSettings";
import { useToasts } from "../lib/useToasts";

/** The groups of settings, one shown at a time, in the order the list shows them. */
const TABS = [
  { id: "display", label: "Display" },
  { id: "library", label: "Library" },
  { id: "inbox", label: "Inbox" },
  { id: "suggestions", label: "Suggestions" },
  { id: "types", label: "File types" },
  { id: "window", label: "Window" },
  { id: "about", label: "About" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * App settings in groups, picked from a list down the left (a row along the top on a narrow
 * window): display, library and folder names, inbox folders, suggestions, file types, window
 * behaviour, and the app's version, maker and updates. A folder name change swaps the page for
 * its preview of the renames until it's applied or abandoned; the result shows as a toast.
 * @param props - Component props.
 * @param props.showAbout - Help > About or Check for updates was picked; open at About
 * @param props.onAboutShown - called once About is showing
 * @returns the page
 */
export function SettingsPage({
  showAbout,
  onAboutShown,
}: {
  showAbout: boolean;
  onAboutShown: () => void;
}): ReactElement {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const { expectJob } = useToasts();
  const [review, setReview] = useState<Preview | null>(null);
  const [applying, setApplying] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const display = useAction();
  const library = useAction();
  const types = useAction();
  const windowing = useAction();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  // Opens on the tab last shown; a request for About (below) still wins.
  const [tab, setTab] = usePageMemory<TabId>("settings.tab", showAbout ? "about" : "display");
  /** A new library folder picked and waiting for the user to confirm it. */
  const [newRoot, setNewRoot] = useState<string | null>(null);

  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
    getVersion().then(setVersion, () => setVersion(null));
    // The menu bar's Start with Windows tick changes it too.
    const unlisten = listen<boolean>(AUTOSTART_CHANGED, ({ payload }) => setAutostart(payload));
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Also over a remembered tab, and while the page is already open when the menu asks for About
  // again. Switched while rendering, so About shows in the same paint; the effect then marks the
  // request done.
  if (showAbout && tab !== "about") setTab("about");
  useEffect(() => {
    if (showAbout) onAboutShown();
  }, [showAbout, onAboutShown]);

  useJobDone("apply", (done) => {
    if (!applying) return;
    if (!done.ok && done.error) setRenameError(done.error);
    setApplying(false);
    setReview(null);
  });

  /**
   * Apply the reviewed folder renames; the apply job's end clears the review and shows a toast.
   * @param preview - the reviewed plan
   */
  async function rename(preview: Preview): Promise<void> {
    setRenameError(null);
    setApplying(true);
    const forget = expectJob("apply", { intro: "Changed the folder names.", undoable: true });
    try {
      await api.applyPlan(preview.id);
    } catch (err) {
      forget();
      setApplying(false);
      setRenameError(errorText(err));
    }
  }

  /** Ask for a new library folder, held for the user to confirm before it's saved. */
  async function changeLibrary(): Promise<void> {
    const picked = await open({ directory: true, title: "Choose your photo library folder" });
    if (typeof picked === "string" && picked !== settings?.library_root) setNewRoot(picked);
  }

  /** Save the confirmed library folder; saving it reads the new folder for photos. */
  async function confirmRoot(): Promise<void> {
    if (newRoot === null) return;
    const root = newRoot;
    setNewRoot(null);
    await library.run(() => save("library_root", root));
  }

  const closeToTray = settings?.close_to_tray !== "false";
  const errorLine = renameError && (
    <p role="alert" className="mx-5 mt-3 text-danger">
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
          onBack={applying ? undefined : () => setReview(null)}
          actions={
            !moving && (
              <Button
                variant="primary"
                onClick={() => rename(review)}
                disabled={applying}
                busy={running !== null}
              >
                {review.files > 0
                  ? `Rename folders and move ${count(review.files, "file", "files")}`
                  : "Save folder names"}
              </Button>
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
      <SettingsTabs tab={tab} onTab={setTab}>
        {tab === "display" && (
          <>
            <Section title="Display" detail="Changes show straight away." error={display.error}>
              <Choices
                title="Theme"
                detail="System follows Windows."
                value={themeOf(settings)}
                options={THEMES.map((theme) => ({
                  ...theme,
                  sample: <ThemeSample theme={theme.value} />,
                }))}
                onChange={(value) => display.run(() => save("theme", value))}
              />
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
          </>
        )}
        {tab === "library" && (
          <>
            <Section title="Library" error={library.error}>
              <Row
                title="Library folder"
                detail={<span className="selectable">{settings?.library_root}</span>}
              >
                <div className="flex flex-wrap gap-2">
                  {settings?.library_root && (
                    <Button onClick={() => library.run(api.openLibrary)}>Open</Button>
                  )}
                  <Button onClick={changeLibrary} disabled={newRoot !== null}>
                    Change folder
                  </Button>
                </div>
              </Row>
              {newRoot !== null && (
                <div className="mb-4 rounded-md border border-line bg-raised p-4">
                  <p>
                    Use <span className="selectable font-semibold break-all">{newRoot}</span>? The
                    Library will show the photos in it instead. Nothing is moved.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="primary" onClick={confirmRoot} busy={running !== null}>
                      Use this folder
                    </Button>
                    <Button variant="ghost" onClick={() => setNewRoot(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </Section>

            <FolderNames
              busy={running !== null}
              onReview={(preview) => {
                setRenameError(null);
                setReview(preview);
              }}
            />
          </>
        )}
        {tab === "inbox" && <InboxSettings />}
        {tab === "suggestions" && <SuggestionSettings />}
        {tab === "types" && (
          <>
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
              {settings?.codec_hint_dismissed === "true" && (
                <Row
                  title="Missing extension tip"
                  detail="Hidden. It names the Windows extension a photo needs when its thumbnail won't show."
                >
                  <Button onClick={() => types.run(() => save("codec_hint_dismissed", "false"))}>
                    Show again
                  </Button>
                </Row>
              )}
            </Section>
          </>
        )}
        {tab === "window" && (
          <>
            <Section title="Window" error={windowing.error}>
              <Row
                title="Keep running in the tray"
                detail="Closing the window leaves Pic Cabinet in the system tray so it can watch for new photos and devices."
              >
                <Toggle
                  checked={closeToTray}
                  label="Keep running in the tray"
                  onChange={(on) =>
                    windowing.run(() => save("close_to_tray", on ? "true" : "false"))
                  }
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
          </>
        )}
        {tab === "about" && (
          <>
            <Section title="About">
              <div className="flex items-center gap-4">
                <AppIcon size={56} className="shrink-0" />
                <div>
                  <p className="font-brand text-[17px] leading-tight font-bold">Pic Cabinet</p>
                  {version && <p className="mt-1 text-[15px] text-muted">Version {version}</p>}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-muted">
                    <BrandMark size={16} className="shrink-0 text-logo" />© 2026 To the Point Tech.
                    All rights reserved.
                  </p>
                  <LegalLinks />
                </div>
              </div>
              <UpdateCheck />
            </Section>
          </>
        )}
      </SettingsTabs>
    </>
  );
}

/**
 * The list of settings groups beside the chosen group. Up and Down (or Left and Right) move
 * through the list, as in other tab lists.
 * @param props - Component props.
 * @param props.tab - the group showing
 * @param props.onTab - show another group
 * @param props.children - the chosen group's settings
 * @returns the list and the group
 */
function SettingsTabs({
  tab,
  onTab,
  children,
}: {
  tab: TabId;
  onTab: (tab: TabId) => void;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys, Home and End move to another group and focus its tab.
   * @param event - the key press on a tab
   */
  function onKey(event: KeyboardEvent): void {
    // Alt+arrows are the app's Back and Forward.
    if (event.altKey) return;
    const at = TABS.findIndex((t) => t.id === tab);
    const steps: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowRight: at + 1,
      ArrowUp: at - 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: TABS.length - 1,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    const next = (steps[event.key] + TABS.length) % TABS.length;
    onTab(TABS[next].id);
    list.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  return (
    <div className="flex flex-col md:flex-row">
      {/* Beside the settings on a wide window, staying in view under the toolbar as they
          scroll; a wrapping row above them on a narrow one. */}
      <div
        ref={list}
        role="tablist"
        aria-label="Settings"
        aria-orientation="vertical"
        className="flex shrink-0 flex-wrap gap-0.5 border-b border-line px-3 py-2 md:sticky md:top-14 md:w-48 md:flex-col md:self-start md:border-b-0 md:py-4"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${id}-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`${id}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={onKey}
            className={`flex min-h-8.5 items-center rounded-md px-3 text-left text-[15px] transition-colors ${
              tab === t.id
                ? "bg-raised font-semibold text-ink"
                : "text-muted hover:bg-raised/60 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
        className="max-w-2xl min-w-0 flex-1 px-6 py-5 md:min-h-[calc(100vh-3.5rem)] md:border-l md:border-line"
      >
        {children}
      </div>
    </div>
  );
}

/** Seasalt and the dark ground, as in index.css, so each sample shows its theme in either one. */
const LIGHT = "#f6f7f8";
const DARK = "#121417";

/**
 * A small swatch for a theme choice: pale, dark, or split across the diagonal for System.
 * @param props - Component props.
 * @param props.theme - the theme's stored value
 * @returns the swatch, hidden from screen readers since the label names it
 */
function ThemeSample({ theme }: { theme: string }): ReactElement {
  const background =
    theme === "light"
      ? LIGHT
      : theme === "dark"
        ? DARK
        : `linear-gradient(135deg, ${LIGHT} 50%, ${DARK} 50%)`;
  return (
    <span
      aria-hidden="true"
      className="size-6 rounded-full border border-line-strong"
      style={{ background }}
    />
  );
}
