import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { api, errorText, type MediaKind } from "../lib/api";
import { formatTaken } from "../lib/format";
import { isFullscreenKey, useFullscreen } from "../lib/fullscreen";
import { useLayer } from "../lib/layers";
import { keyCommand, type PhotoCommand } from "../lib/photoCommands";
import { useMediaQuery } from "../lib/useMediaQuery";
import { savedPanel, savePanel } from "../lib/viewerPanel";
import {
  MAX_SCALE,
  stepIn,
  stepOut,
  wheelScale,
  zoomLabel,
  zoomLadder,
  zoomPan,
  type Point,
} from "../lib/zoom";
import { MissingExtensions } from "./CodecHint";
import { Icon, type IconName } from "./Icon";
import { TileMenu, type MenuItem } from "./TileMenu";
import { Button } from "./ui";
import { VideoPlayer } from "./VideoPlayer";

/** One file, ready for the viewer to show. */
export interface ViewItem {
  name: string;
  kind: MediaKind;
  /** When it was taken, as the library stores it, for the bar over the photo. */
  takenAt: string;
  /** The original file's URL, when the webview can show (photos) or play (videos) it as it is. */
  original: string | null;
  /** The file has gone from disk, deleted or moved outside Pic Cabinet. */
  missing: boolean;
  /** The file is 0 bytes, so there is nothing to show or open. */
  empty: boolean;
  /**
   * A large image Windows drew: shown instead of a photo without an original, and as a video's
   * poster or a failed file's stand-in.
   */
  preview: string;
  /** The grid tile, usually cached already: shown scaled up until the full picture is ready. */
  thumb: string;
  /** A Live Photo's clip, when the built-in player can try it. */
  live?: string;
  /** Details shown beside the photo, made with {@link Fact}. */
  facts: ReactNode;
}

/** How many loaded files the viewer keeps, so stepping back and forth doesn't load them again. */
const KEEP = 10;
/**
 * Files loaded ahead on each side. Two, because a HEIC's full picture takes Windows over a second
 * to draw, longer than a step usually takes; the four render threads draw them side by side.
 */
const AHEAD = 2;

/**
 * Start fetching a file's picture so it's already decoded when the viewer steps to it. Videos
 * are left alone; they stream when shown.
 * @param item - a neighbouring file
 */
function preload(item: ViewItem): void {
  if (item.kind === "video") return;
  const image = new Image();
  image.src = item.original ?? item.preview;
}

/** How long the pointer can rest, in ms, before the bar and side arrows fade. */
const REST_MS = 2000;

/**
 * Whether an element is part of the viewer's chrome (the bar and side arrows), which stays on
 * show while the pointer is over it.
 * @param target - an event's target
 * @returns true inside an element marked `data-chrome`
 */
function inChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-chrome]") !== null;
}

/** Default app names by extension, looked up once each. Null: Windows has no default. */
const defaultApps = new Map<string, string | null>();

/**
 * What the button that opens a file outside Pic Cabinet says, e.g. "Open in Photos", or "Open in
 * default app" until the name is known or when Windows has none.
 * @param name - the file's name
 * @returns the button text
 */
function useOpenLabel(name: string | undefined): string {
  const dot = name?.lastIndexOf(".") ?? -1;
  const ext = name && dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const [found, setFound] = useState<{ ext: string; app: string | null } | null>(null);

  useEffect(() => {
    if (!ext || defaultApps.has(ext)) return;
    let active = true;
    api.defaultApp(ext).then(
      (app) => {
        defaultApps.set(ext, app);
        if (active) setFound({ ext, app });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [ext]);

  const app = defaultApps.get(ext) ?? (found?.ext === ext ? found.app : null);
  return app ? `Open in ${app}` : "Open in default app";
}

/** Where the viewer's files come from. Callers memoise it, since a new one reloads the file. */
export interface ViewSource {
  count: number;
  /** Changes whenever item `index` would load something else, so stale loads are dropped. */
  key: (index: number) => string;
  load: (index: number) => Promise<ViewItem>;
  /** Open the file in its default Windows app. */
  open: (index: number) => Promise<void>;
  /** Show the file selected in Explorer. Missing when there's no folder to show, e.g. a phone. */
  reveal?: (index: number) => Promise<void>;
  /** Put the file on the clipboard. Missing where there's no file on disk to copy, e.g. a phone. */
  copy?: (index: number) => Promise<void>;
  /** What to do about a file that has gone from disk, shown under the notice. */
  gone: string;
  /** A button under that notice that brings the source up to date, when there's one to offer. */
  refresh?: { label: string; run: () => Promise<void> };
}

/**
 * Full-window view of one file with its details. Arrow keys step through the source.
 *
 * A slim bar over the top of the stage carries Back, the file's name and date, its place in the
 * source and an icon row: the photo's zoom and rotate and a Live Photo's Play, then Show in
 * folder, Copy and Open, built from the source so every caller gets them, then Info, Fullscreen
 * and, where the caller passes a bin command, Bin. The bar and side arrows fade once the pointer
 * has rested for {@link REST_MS}, and stay while the pointer is over them or keyboard focus is
 * inside them. Fullscreen is left when the viewer closes.
 * @param props - Component props.
 * @param props.source - the files
 * @param props.index - which file is open
 * @param props.onIndex - move to another file
 * @param props.onClose - close the viewer
 * @param props.steps - labels for the previous and next buttons (default Previous and Next)
 * @param props.controls - shown above the details, e.g. a tick for the file on show
 * @param props.commands - the commands for the file on show; their shortcuts work while the
 *   viewer is the top layer, and a `bin` command puts Bin in the bar
 * @param props.removed - raise it when the file on show leaves the source from under the viewer,
 *   as to the Recycle Bin, so the file that takes its place slides in
 * @param props.menu - the right-click menu for the file on show, worked out each time it opens;
 *   without it a right-click on the photo does nothing
 * @returns the viewer, drawn over the whole window
 */
export function Viewer({
  source,
  index,
  onIndex,
  onClose,
  steps = ["Previous", "Next"],
  controls,
  commands,
  removed = 0,
  menu,
}: {
  source: ViewSource;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  steps?: [string, string];
  controls?: ReactNode;
  commands?: PhotoCommand[];
  removed?: number;
  menu?: () => MenuItem[];
}): ReactElement {
  const key = source.key(index);
  // Loaded files by key: the one on show and up to AHEAD each side, fetched ahead so the
  // next file is ready the moment it's stepped to. Keys change when a file would load something else, so
  // nothing stale is shown.
  const [items, setItems] = useState<ReadonlyMap<string, ViewItem>>(() => new Map());
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const pending = useRef(new Set<string>());
  const item = items.get(key) ?? null;
  const error = failure?.key === key ? failure.message : null;
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The file on show first, then outwards, next before previous.
    const order = [index];
    for (let step = 1; step <= AHEAD; step++) order.push(index + step, index - step);
    const near = order.filter((i) => i >= 0 && i < source.count);
    const nearKeys = new Set(near.map((i) => source.key(i)));
    for (const i of near) {
      const k = source.key(i);
      if (items.has(k) || pending.current.has(k)) continue;
      pending.current.add(k);
      source.load(i).then(
        (loadedItem) => {
          pending.current.delete(k);
          setItems((prev) => {
            const next = new Map(prev);
            next.set(k, loadedItem);
            // Oldest first, never the file on show or its neighbours.
            for (const old of next.keys()) {
              if (next.size <= KEEP) break;
              if (!nearKeys.has(old)) next.delete(old);
            }
            return next;
          });
        },
        (err) => {
          pending.current.delete(k);
          if (i === index) setFailure({ key: k, message: errorText(err) });
        },
      );
    }
  }, [source, index, items]);

  // The neighbours' pictures are fetched only once the one on show is in. Windows draws them on
  // the same few threads, newest request first, so fetching them straight away would draw all
  // four neighbours before the photo that was opened.
  const [shown, setShown] = useState<string | null>(null);
  const preloaded = useRef(new Set<string>());
  useEffect(() => {
    if (shown !== key) return;
    for (let step = 1; step <= AHEAD; step++) {
      for (const i of [index + step, index - step]) {
        if (i < 0 || i >= source.count) continue;
        const near = items.get(source.key(i));
        if (!near || preloaded.current.has(source.key(i))) continue;
        preloaded.current.add(source.key(i));
        preload(near);
      }
    }
  }, [shown, key, index, items, source]);

  // The details panel follows the last choice made with Info or the I key.
  const [info, setInfo] = useState(savedPanel);

  /** Show or hide the details panel and keep the choice. */
  const toggleInfo = useCallback(() => {
    setInfo((prev) => {
      savePanel(!prev);
      return !prev;
    });
  }, []);

  const fullscreen = useFullscreen();

  // Capture phase, so Escape closes only the viewer, not the selection or menu of the page behind.
  // That also runs before a dialog over the viewer sees the key, so while one is open (the viewer
  // is no longer the top layer) every key is left to the dialog.
  const onTop = useLayer();
  useEffect(() => {
    /**
     * Escape leaves fullscreen, or closes the viewer when not in it; the left and right arrows
     * step through the source, and Home and End go to its first and last; I toggles the details
     * panel and F or F11 fullscreen, and the commands' shortcuts (Delete) run. Keys meant for a
     * focused video's controls or a box in the side panel are left to them.
     * @param event - the window's keydown, caught before the page behind sees it
     */
    function onKey(event: KeyboardEvent): void {
      if (!onTop()) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        // Held down, Escape repeats; one press does one thing, so holding it to leave
        // fullscreen doesn't close the viewer as well.
        if (!event.repeat) {
          if (fullscreen.on) fullscreen.set(false);
          else onClose();
        }
      }
      const command = commands && keyCommand(event, commands);
      if (command) {
        event.preventDefault();
        command.run();
        return;
      }
      // A box being typed in uses the arrows itself.
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < source.count - 1) onIndex(index + 1);
      if (event.target instanceof HTMLMediaElement) return;
      const plainI =
        event.key.toLowerCase() === "i" && !event.ctrlKey && !event.altKey && !event.metaKey;
      // Held down, the key repeats; one press is one toggle.
      if (plainI && !event.repeat) {
        toggleInfo();
      }
      if (isFullscreenKey(event)) {
        event.preventDefault();
        if (!event.repeat) fullscreen.set(!fullscreen.on);
      }
      if (event.key === "Home" && index > 0) onIndex(0);
      if (event.key === "End" && index < source.count - 1) onIndex(source.count - 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, source.count, onIndex, onClose, toggleInfo, onTop, fullscreen, commands]);

  // Focus moves into the viewer, and back to whatever opened it on closing. That return doesn't
  // scroll: after stepping through photos the page may bring the last one shown into view
  // instead, and the opener mustn't pull the view back to where the viewer started.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => opener?.focus({ preventScroll: true });
  }, []);

  // A file taken out from under the viewer is replaced by the next one sliding in from the
  // right, or by the previous one from the left when it was the last. The slide waits for that
  // file to load, and is dropped if another is stepped to first. It's a Web Animation, which the
  // stylesheet's reduced-motion rule doesn't reach, so that preference is checked here.
  const stage = useRef<HTMLDivElement>(null);
  const stillMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const seenRemoved = useRef(removed);
  const lastIndex = useRef(index);
  const slide = useRef<{ key: string; from: number } | null>(null);
  useEffect(() => {
    if (removed !== seenRemoved.current) {
      seenRemoved.current = removed;
      slide.current = { key, from: index < lastIndex.current ? -1 : 1 };
    }
    lastIndex.current = index;
    const pending = slide.current;
    if (pending === null) return;
    if (pending.key !== key) {
      slide.current = null;
      return;
    }
    if (!item) return;
    slide.current = null;
    // The file's own element comes first in the stage, ahead of the error line and the bar.
    const media = stage.current?.firstElementChild;
    if (stillMotion || !media) return;
    media.animate(
      [
        { opacity: 0, transform: `translateX(${pending.from * 48}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [removed, key, index, item, stillMotion]);

  /**
   * Run a file action, showing any failure in the side panel against the file on show.
   * @param action - the open, reveal or copy call
   * @returns true when it worked
   */
  async function run(action: () => Promise<void>): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (err) {
      setFailure({ key, message: errorText(err) });
      return false;
    }
  }

  /**
   * After the photo or video fails to load, ask again whether the file is still there: it may
   * have been deleted while open, or since the look-ahead loaded it.
   * @returns true when it has gone, and the viewer now says so
   */
  async function recheck(): Promise<boolean> {
    try {
      const fresh = await source.load(index);
      if (fresh.missing) setItems((prev) => new Map(prev).set(key, fresh));
      return fresh.missing;
    } catch {
      return false;
    }
  }

  const reveal = source.reveal;
  const copy = source.copy;
  const openLabel = useOpenLabel(item?.name);

  // "Copied" shows on the button for a moment, for the file that was copied.
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (copied === null) return;
    const timer = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  /** Put the file on show on the clipboard. */
  async function copyFile(): Promise<void> {
    if (copy && (await run(() => copy(index)))) setCopied(key);
  }

  // The photo's zoom and rotate buttons are drawn by the photo itself, into this spot in the bar,
  // so they act on its own zoom and turn.
  const [photoTools, setPhotoTools] = useState<HTMLSpanElement | null>(null);

  // The bar and side arrows fade once the pointer rests. `awake` drops when the rest timer runs
  // out; the pointer over them, or keyboard focus inside them, keeps them on show regardless.
  const [awake, setAwake] = useState(true);
  const [held, setHeld] = useState(false);
  const [focused, setFocused] = useState(false);
  const restTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    restTimer.current = window.setTimeout(() => setAwake(false), REST_MS);
    return () => window.clearTimeout(restTimer.current);
  }, []);
  const chrome = `transition-opacity duration-300 ${awake || held || focused ? "opacity-100" : "opacity-0"}`;

  /**
   * Show the bar and arrows, start the rest timer again, and note whether the pointer is over
   * them.
   * @param event - the pointer moving anywhere in the viewer
   */
  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    setHeld(inChrome(event.target));
    setAwake(true);
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => setAwake(false), REST_MS);
  }

  /**
   * Keep the bar on show while a key has moved focus into it. A click focuses a button too, but
   * only keyboard focus (`:focus-visible`) holds the bar, or it would never fade after a click.
   * @param event - focus arriving anywhere in the viewer
   */
  function onFocus(event: FocusEvent<HTMLDivElement>): void {
    setFocused(inChrome(event.target) && event.target.matches(":focus-visible"));
  }

  // The Live Photo's clip plays in place of the still. Stepping away stops it, so coming back
  // shows the still again.
  const [liveKey, setLiveKey] = useState<string | null>(null);
  if (liveKey !== null && liveKey !== key) setLiveKey(null);
  const live = item?.live !== undefined && liveKey === key ? item.live : null;

  const [menuAt, setMenuAt] = useState<{
    key: string;
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  // Its items act on the file it was opened for, so it goes if another comes on show.
  if (menuAt !== null && menuAt.key !== key) setMenuAt(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);

  /**
   * Open the caller's menu for the file on show at the pointer. The bar, the side arrows and the
   * video's own controls keep the plain right-click, which shows nothing.
   * @param event - the right-click anywhere on the stage
   */
  function onStageMenu(event: MouseEvent<HTMLDivElement>): void {
    if (!menu || inChrome(event.target)) return;
    if (event.target instanceof Element && event.target.closest("button, input")) return;
    event.preventDefault();
    setMenuAt({ key, x: event.clientX, y: event.clientY, items: menu() });
  }

  const bin = commands?.find((c) => c.id === "bin");
  const usable = item !== null && !item.missing;
  return createPortal(
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item ? item.name : "Photo viewer"}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHeld(false)}
      onFocus={onFocus}
      onBlur={() => setFocused(false)}
      className="fixed inset-0 z-40 flex bg-ground outline-none"
    >
      <div
        ref={stage}
        onContextMenu={onStageMenu}
        className="on-dark relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ground"
      >
        {item && live && (
          <VideoPlayer
            key={`${key}-live`}
            src={live}
            poster={item.preview}
            label={item.name}
            onEnded={() => setLiveKey(null)}
            onError={() => {
              setLiveKey(null);
              setFailure({ key, message: "This Live Photo's clip can't play inside Pic Cabinet" });
            }}
          />
        )}
        {item && !live && (
          <Media
            key={key}
            item={item}
            gone={source.gone}
            refresh={source.refresh}
            onBroken={recheck}
            onShown={() => setShown(key)}
            openLabel={openLabel}
            onOpen={() => run(() => source.open(index))}
            onReveal={reveal && (() => run(() => reveal(index)))}
            tools={photoTools}
          />
        )}
        {error && (
          <p className="absolute inset-x-0 top-14 mx-auto w-fit max-w-[80%] rounded-md bg-surface/90 px-3 py-1.5 text-danger">
            {error}
          </p>
        )}

        <div
          data-chrome
          className={`absolute inset-x-0 top-0 flex h-12 items-center gap-3 bg-surface/85 pr-2 pl-1.5 ${chrome}`}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            title="Back (Esc)"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink active:bg-line"
          >
            <Icon name="back" size={20} />
          </button>
          <p className="flex min-w-0 flex-1 items-baseline gap-3">
            <span className="truncate font-semibold">{item?.name}</span>
            {item && (
              <span className="shrink-0 text-[14px] text-muted">{formatTaken(item.takenAt)}</span>
            )}
          </p>
          <span className="shrink-0 text-[14px] text-faint tabular-nums">
            {(index + 1).toLocaleString()} of {source.count.toLocaleString()}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <span ref={setPhotoTools} className="contents" />
            {usable && item.live && (
              <ToolButton
                icon="live"
                label={live ? "Show photo" : "Play Live Photo"}
                pressed={live !== null}
                onClick={() => setLiveKey(live ? null : key)}
              />
            )}
            {usable && reveal && (
              <ToolButton
                icon="folder"
                label="Show in folder"
                onClick={() => run(() => reveal(index))}
              />
            )}
            {usable && copy && (
              <ToolButton
                icon={copied === key ? "check" : "copy"}
                label={copied === key ? "Copied" : "Copy"}
                onClick={() => void copyFile()}
              />
            )}
            {usable && !item.empty && (
              <ToolButton
                icon="open"
                label={openLabel}
                onClick={() => run(() => source.open(index))}
              />
            )}
            <ToolButton icon="info" label="Info" shortcut="I" pressed={info} onClick={toggleInfo} />
            <ToolButton
              icon={fullscreen.on ? "windowed" : "fullscreen"}
              label="Fullscreen"
              shortcut="F"
              pressed={fullscreen.on}
              onClick={() => fullscreen.set(!fullscreen.on)}
            />
            {bin && item && (
              <ToolButton
                icon="bin"
                label={bin.label}
                shortcut={bin.shortcut}
                disabled={bin.disabled}
                onClick={bin.run}
              />
            )}
          </div>
        </div>

        <NavButton
          side="left"
          label={steps[0]}
          hidden={index === 0}
          className={chrome}
          onClick={() => onIndex(index - 1)}
        />
        <NavButton
          side="right"
          label={steps[1]}
          hidden={index >= source.count - 1}
          className={chrome}
          onClick={() => onIndex(index + 1)}
        />
      </div>

      {info && (
        <aside className="flex w-80 max-w-[45%] shrink-0 flex-col border-l border-line bg-surface">
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-6">
            {item && (
              <>
                <h2 className="selectable text-[18px] leading-tight font-semibold break-all">
                  {item.name}
                </h2>
                {controls && <div className="mt-4">{controls}</div>}
                {item.facts}
              </>
            )}
          </div>
        </aside>
      )}

      {menuAt && <TileMenu x={menuAt.x} y={menuAt.y} items={menuAt.items} onClose={closeMenu} />}
    </div>,
    document.body,
  );
}

/**
 * The photo or video itself, or a button to open it in its own app when Pic Cabinet can't. A
 * file that has gone from disk says so instead.
 * @param props - Component props.
 * @param props.item - the file on show
 * @param props.gone - what to do about a file that has gone, from the source
 * @param props.refresh - a button that brings the source up to date, from the source
 * @param props.refresh.label - the button's text
 * @param props.refresh.run - bring the source up to date
 * @param props.onBroken - ask whether the file has gone after it failed to load; resolves true
 * when it has, and the item is then marked missing
 * @param props.onShown - the file is on screen as fully as it will be, so neighbours can load
 * @param props.openLabel - text for the open-in-app button
 * @param props.onOpen - open the file in its default app
 * @param props.onReveal - show the file in Explorer, where the source has a folder to show
 * @param props.tools - the spot in the viewer's bar a photo draws its zoom and rotate buttons into
 * @returns the media, or the fallback with its open button
 */
function Media({
  item,
  gone,
  refresh,
  onBroken,
  onShown,
  openLabel,
  onOpen,
  onReveal,
  tools,
}: {
  item: ViewItem;
  gone: string;
  refresh?: { label: string; run: () => Promise<void> };
  onBroken: () => Promise<boolean>;
  onShown: () => void;
  openLabel: string;
  onOpen: () => void;
  onReveal?: () => void;
  tools: HTMLElement | null;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const video = item.kind === "video";

  // Only a picture waits for its full image; anything else is as shown as it gets at once.
  useEffect(() => {
    if (item.missing || item.empty || failed || video) onShown();
  }, [item.missing, item.empty, failed, video, onShown]);

  /** A load failed: a gone file shows its notice, anything else the can't-show fallback. */
  function broken(): void {
    onBroken().then(
      (missing) => !missing && setFailed(true),
      () => setFailed(true),
    );
  }

  if (item.missing) {
    return (
      <div className="max-w-sm text-center">
        <Icon name="warn" size={32} className="mx-auto mb-4 text-faint" />
        <p className="text-[17px] font-semibold">This file has been moved or deleted</p>
        <p className="mt-2 text-muted">{gone}</p>
        {refresh && (
          <Button variant="primary" className="mt-5" onClick={() => void refresh.run()}>
            <Icon name="refresh" size={16} />
            {refresh.label}
          </Button>
        )}
      </div>
    );
  }

  // Opening it in another app would only give that app's own "can't open" error.
  if (item.empty) {
    return (
      <div className="max-w-sm text-center">
        <Icon name="warn" size={32} className="mx-auto mb-4 text-faint" />
        <p className="text-[17px] font-semibold">This file is empty</p>
        <p className="mt-2 text-muted">
          It is 0 bytes, probably from a copy that didn&apos;t finish. The original may still be
          where it was copied from.
        </p>
        {onReveal && (
          <Button variant="primary" className="mt-5" onClick={onReveal}>
            <Icon name="folder" size={16} />
            Show in folder
          </Button>
        )}
      </div>
    );
  }

  if (failed || (video && !item.original)) {
    return (
      <div className="max-w-sm text-center">
        <img
          src={item.preview}
          alt=""
          className="mx-auto mb-5 max-h-48 rounded-[3px] opacity-80"
          onError={(e) => (e.currentTarget.hidden = true)}
        />
        <p className="text-muted">
          {video
            ? "This video's format can't play inside Pic Cabinet."
            : "This file can't be shown inside Pic Cabinet. It is still sorted like any other photo."}
        </p>
        <Button variant="primary" className="mt-5" onClick={onOpen}>
          <Icon name={video ? "play" : "open"} size={16} />
          {openLabel}
        </Button>
        {failed && (
          <MissingExtensions
            ext={item.name.slice(item.name.lastIndexOf(".") + 1).toLowerCase()}
            kind={item.kind}
          />
        )}
      </div>
    );
  }

  if (video) {
    return (
      <VideoPlayer
        src={item.original ?? ""}
        poster={item.preview}
        label={item.name}
        onError={broken}
      />
    );
  }

  return (
    <Photo
      item={item}
      tools={tools}
      onShown={onShown}
      onBroken={() => {
        onShown();
        broken();
      }}
    />
  );
}

/** How far a zoomed photo is moved from centred, in px. */
type Offset = Point;

/**
 * Wheel travel per zoom step. A mouse wheel notch is 100, so each notch is a step, while a
 * touchpad's stream of small deltas adds up instead of racing to the largest zoom.
 */
const WHEEL_STEP = 60;

/** How far a press can move, in px, and still count as a click rather than a drag. */
const CLICK_SLOP = 4;
/** How long the full picture can take, in ms, before a busy mark shows. */
const SLOW_MS = 300;

/**
 * A photo to look at closely: click it or its percent in the bar for 100% and again to fit, step
 * through the zoom stops with the wheel or the + and - keys, Ctrl+wheel to zoom smoothly, 1 for
 * 100% and 0 to fit, drag to look around a zoomed photo, and turn it with R or the Rotate button.
 * Zoom is measured against the picture's real pixels; a HEIC or RAW is shown from Windows' 2048px
 * preview, so its percent is of the preview and it zooms no closer than the preview's 100%.
 * Turning only changes how it's shown here; the file is never changed.
 * @param props - Component props.
 * @param props.item - the photo on show
 * @param props.tools - the spot in the viewer's bar its Zoom and Rotate buttons go, once drawn
 * @param props.onShown - the full picture is on screen
 * @param props.onBroken - the full picture failed to load
 * @returns the photo, with its buttons drawn into the bar
 */
function Photo({
  item,
  tools,
  onShown,
  onBroken,
}: {
  item: ViewItem;
  tools: HTMLElement | null;
  onShown: () => void;
  onBroken: () => void;
}): ReactElement {
  const [sharp, setSharp] = useState(false);
  // Whether the full picture's size is known yet; until then its box is empty.
  const [sized, setSized] = useState(false);
  const [slow, setSlow] = useState(false);
  // The zoom as a scale of the picture's real pixels, or null while fitted, so a fitted photo
  // stays fitted and 100% stays 100% when the window or the details panel changes size.
  const [scale, setScale] = useState<number | null>(null);
  // The scale the photo shows at when fitted, 0 until the picture's size is known.
  const [fitScale, setFitScale] = useState(0);
  const [turns, setTurns] = useState(0);
  const [pan, setPan] = useState<Offset>({ x: 0, y: 0 });
  // A turned photo's extra scale to fit the stage again, applied over its laid-out size.
  const [fit, setFit] = useState(1);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  // Where a drag started, less the pan then, so moving the pointer moves the photo with it.
  const dragFrom = useRef<Offset | null>(null);
  // Where a press started, and whether it has since moved far enough to be a drag, so letting go
  // of a drag doesn't count as a click that zooms.
  const pressAt = useRef<Offset | null>(null);
  const dragged = useRef(false);
  const wheel = useRef(0);
  const sideways = turns % 2 === 1;
  const fitted = scale === null || !fitScale;
  // How many times its fitted size the photo is drawn, for the transform and the pan's reach.
  const zoom = scale === null || !fitScale ? 1 : scale / fitScale;
  const now = scale ?? fitScale;
  // A preview's pixels are all there is to show, so it goes no closer than its own 100%.
  const ladder = fitScale ? zoomLadder(fitScale, item.original ? MAX_SCALE : 1) : [];
  const canZoomIn = ladder.length > 0 && stepIn(now, ladder) !== now;

  // A HEIC, RAW or TIFF is drawn by Windows first, so its size isn't known until that's done,
  // and its own box (and the tile drawn in it) stays empty meanwhile. Watch for the box to open.
  useEffect(() => {
    const img = photo.current;
    if (!img) return;
    const observer = new ResizeObserver(() => {
      if (img.offsetWidth > 0 && img.offsetHeight > 0) setSized(true);
    });
    observer.observe(img);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (sharp) return;
    const timer = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [sharp]);

  // The photo is laid out unturned, fitted to the stage. A quarter turn swaps its width and
  // height, so it's scaled to fit again, but never past its real size. The fitted scale counts
  // screen pixels, not CSS pixels, so 100% shows one picture pixel per screen pixel when Windows
  // display scaling is above 100%.
  useEffect(() => {
    const box = stage.current;
    const img = photo.current;
    if (!box || !img) return;
    /** Work out the turned photo's fit, and the scale it shows at fitted, for the stage now. */
    function measure(): void {
      if (!box || !img) return;
      const width = img.offsetWidth;
      const height = img.offsetHeight;
      const turned =
        sideways && width && height
          ? Math.min(
              box.clientWidth / height,
              box.clientHeight / width,
              (img.naturalWidth || width) / width,
            )
          : 1;
      setFit(turned);
      setFitScale(
        img.naturalWidth && width
          ? (width * turned * window.devicePixelRatio) / img.naturalWidth
          : 0,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [sideways, sharp]);

  /**
   * Keep a pan within reach of the photo's edges, so it can't be dragged off the stage.
   * @param next - the pan wanted
   * @param scale - the photo's zoom
   * @returns the pan, pulled back where needed
   */
  function clamp(next: Offset, scale: number): Offset {
    const box = stage.current;
    const img = photo.current;
    if (!box || !img) return { x: 0, y: 0 };
    const size = fit * scale;
    const width = (sideways ? img.offsetHeight : img.offsetWidth) * size;
    const height = (sideways ? img.offsetWidth : img.offsetHeight) * size;
    const reachX = Math.max(0, (width - box.clientWidth) / 2);
    const reachY = Math.max(0, (height - box.clientHeight) / 2);
    return {
      x: Math.max(-reachX, Math.min(reachX, next.x)),
      y: Math.max(-reachY, Math.min(reachY, next.y)),
    };
  }

  /**
   * Zoom to a scale, keeping the point under `at` where it is. A scale at or below the fitted
   * size fits the photo.
   * @param next - the scale to go to, 1 being the picture's real size
   * @param at - the point to zoom about, in px from the stage's centre (default the centre)
   */
  function zoomTo(next: number, at: Offset = { x: 0, y: 0 }): void {
    if (!fitScale) return;
    const to = Math.max(1, next / fitScale);
    if (to === zoom) return;
    setPan(clamp(zoomPan(pan, at, to / zoom), to));
    setScale(to > 1 ? next : null);
  }

  /** One stop closer, about the centre. */
  function zoomIn(): void {
    if (ladder.length) zoomTo(stepIn(now, ladder));
  }

  /** One stop further out, about the centre. */
  function zoomOut(): void {
    if (ladder.length) zoomTo(stepOut(now, ladder));
  }

  /** Back to the whole photo, fitted to the window. */
  function fitPhoto(): void {
    setScale(null);
    setPan({ x: 0, y: 0 });
  }

  /**
   * From fitted to 100%, or the next stop when 100% is no closer than fitted; back to fit when
   * zoomed.
   * @param at - the point to zoom about, in px from the stage's centre (default the centre)
   */
  function toggleZoom(at?: Offset): void {
    if (!fitted) fitPhoto();
    else if (canZoomIn) zoomTo(fitScale < 1 ? 1 : stepIn(fitScale, ladder), at);
  }

  /** A quarter turn clockwise, centred again. */
  function turn(): void {
    setTurns((t) => (t + 1) % 4);
    setPan({ x: 0, y: 0 });
  }

  // Keys for the photo on show. Ctrl and Alt are left alone, so Ctrl+= and Ctrl+- still change
  // the text size, and keys typed into a box or meant for a focused control are left to it.
  useEffect(() => {
    /**
     * + and - step the zoom, 1 shows the real size, 0 fits the photo again, R turns it.
     * @param event - the window's keydown
     */
    function onKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "+" || event.key === "=") zoomIn();
      else if (event.key === "-" || event.key === "_") zoomOut();
      else if (event.key === "1") zoomTo(1);
      else if (event.key === "0") fitPhoto();
      else if (event.key === "r" || event.key === "R") turn();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // React's wheel listener is passive, so it can't stop Ctrl+wheel zooming the whole page; the
  // stage gets its own.
  useEffect(() => {
    const box = stage.current;
    if (!box) return;
    /**
     * Ctrl+wheel, or a touchpad pinch, which arrives as one, zooms smoothly about the pointer. A
     * plain wheel steps a stop per notch.
     * @param event - the wheel over the stage
     */
    function onWheel(event: WheelEvent): void {
      if (event.ctrlKey) event.preventDefault();
      if (!box || !ladder.length) return;
      const rect = box.getBoundingClientRect();
      const at = {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      };
      if (event.ctrlKey) {
        zoomTo(wheelScale(now, event.deltaY, fitScale, ladder[ladder.length - 1]), at);
        return;
      }
      wheel.current += event.deltaY;
      if (Math.abs(wheel.current) < WHEEL_STEP) return;
      const closer = wheel.current < 0;
      wheel.current = 0;
      zoomTo(closer ? stepIn(now, ladder) : stepOut(now, ladder), at);
    }
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  });

  /**
   * Start dragging a zoomed photo.
   * @param event - the press on the photo
   */
  function onPointerDown(event: PointerEvent<HTMLImageElement>): void {
    dragged.current = false;
    pressAt.current = { x: event.clientX, y: event.clientY };
    if (fitted || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragFrom.current = { x: event.clientX - pan.x, y: event.clientY - pan.y };
    setDragging(true);
  }

  /**
   * Move the photo with the pointer while dragging.
   * @param event - the pointer moving
   */
  function onPointerMove(event: PointerEvent<HTMLImageElement>): void {
    const press = pressAt.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) {
      dragged.current = true;
    }
    const from = dragFrom.current;
    if (!from) return;
    setPan(clamp({ x: event.clientX - from.x, y: event.clientY - from.y }, zoom));
  }

  /**
   * Go to 100% about the pointer when fitted, or back to fit when zoomed. A drag is not a click.
   * @param event - the click on the photo
   */
  function onClick(event: MouseEvent<HTMLImageElement>): void {
    if (dragged.current) return;
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    toggleZoom({
      x: event.clientX - box.left - box.width / 2,
      y: event.clientY - box.top - box.height / 2,
    });
  }

  /** Stop dragging. */
  function onPointerUp(): void {
    dragFrom.current = null;
    pressAt.current = null;
    setDragging(false);
  }

  let cursor = canZoomIn ? "cursor-zoom-in" : "";
  if (!fitted) cursor = dragging ? "cursor-grabbing" : "cursor-grab";

  // The tile is the photo's background until the full picture loads, so the photo shows at once,
  // a little soft, then sharpens. As a background it fills the photo's own box, which is known as
  // soon as the file's header is read, so a picture smaller than the screen never flashes up
  // stretched. It goes once the photo is in: the tile is flattened onto grey, which would show
  // through a transparent picture. A picture Windows draws has no box until it's done, so its
  // tile is its own layer filling the stage until then. A file the webview shows itself skips
  // that: its box comes within moments, and a small picture would flash up stretched.
  return (
    <div ref={stage} className="relative flex size-full items-center justify-center">
      {!sized && !item.original && (
        <img
          src={item.thumb}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{ transform: `rotate(${turns * 90}deg)` }}
          className="pointer-events-none absolute inset-0 size-full object-contain select-none"
        />
      )}
      {slow && !sharp && (
        <Icon
          name="busy"
          size={18}
          className="pointer-events-none absolute right-0 bottom-0 animate-spin text-faint"
        />
      )}
      <img
        ref={photo}
        src={item.original ?? item.preview}
        alt={item.name}
        draggable={false}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) rotate(${turns * 90}deg) scale(${fit * zoom})`,
          background: sharp ? undefined : `url("${item.thumb}") center / contain no-repeat`,
        }}
        onLoad={() => {
          setSharp(true);
          onShown();
        }}
        onError={onBroken}
        className={`relative max-h-full max-w-full object-contain select-none ${cursor} ${dragging ? "" : "transition-transform duration-150"}`}
      />
      {tools &&
        createPortal(
          <>
            <ToolButton
              icon="zoomOut"
              label="Zoom out"
              shortcut="-"
              disabled={fitted}
              onClick={zoomOut}
            />
            <button
              type="button"
              title={fitted ? "100% (1)" : "Fit (0)"}
              disabled={fitted && !canZoomIn}
              onClick={() => toggleZoom()}
              className="h-8 min-w-17 rounded-md px-1.5 text-[13px] text-muted tabular-nums transition-colors hover:bg-raised hover:text-ink active:bg-line disabled:pointer-events-none"
            >
              {zoomLabel(now, fitted)}
            </button>
            <ToolButton
              icon="zoom"
              label="Zoom in"
              shortcut="+"
              disabled={!canZoomIn}
              onClick={zoomIn}
            />
            <ToolButton icon="rotate" label="Rotate" shortcut="R" onClick={turn} />
          </>,
          tools,
        )}
    </div>
  );
}

/**
 * Small icon button in the viewer's bar, named by its tooltip.
 * @param props - Component props.
 * @param props.icon - which icon to show
 * @param props.label - what it does, for the tooltip and screen readers
 * @param props.shortcut - its key, added to the tooltip
 * @param props.pressed - on or off, for a button that toggles something
 * @param props.disabled - greyed out, for a step that can go no further
 * @param props.onClick - do it
 * @returns the button
 */
function ToolButton({
  icon,
  label,
  shortcut,
  pressed,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink active:bg-line disabled:pointer-events-none disabled:opacity-35 aria-pressed:bg-raised aria-pressed:text-ink"
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/**
 * Previous or next arrow over one side of the photo, hidden at that end of the source. Just
 * the arrow, so it covers little of the photo; the label is its tooltip.
 * @param props - Component props.
 * @param props.side - which edge it sits on
 * @param props.label - what it does, e.g. "Older", for the tooltip and screen readers
 * @param props.hidden - at that end of the source, so there's nowhere to step
 * @param props.className - extra classes, for fading it with the bar
 * @param props.onClick - step to the neighbouring file
 * @returns the button
 */
function NavButton({
  side,
  label,
  hidden,
  className,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  hidden: boolean;
  className: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      data-chrome
      onClick={onClick}
      disabled={hidden}
      title={label}
      aria-label={label}
      className={`absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/70 text-ink hover:bg-raised disabled:invisible ${
        side === "left" ? "left-3" : "right-3"
      } ${className}`}
    >
      <Icon name={side === "left" ? "back" : "chevron"} size={22} />
    </button>
  );
}

/**
 * One block of details in the viewer's side panel.
 * @param props - Component props.
 * @param props.label - what the block is about, e.g. "Taken"
 * @param props.children - the details
 * @returns the block
 */
export function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-1.5 text-[14px] text-faint">{label}</h3>
      {children}
    </section>
  );
}
