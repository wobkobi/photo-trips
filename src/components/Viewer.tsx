import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import { api, errorText, type MediaKind } from "../lib/api";
import { MissingExtensions } from "./CodecHint";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui";
import { VideoPlayer } from "./VideoPlayer";

/** One file, ready for the viewer to show. */
export interface ViewItem {
  name: string;
  kind: MediaKind;
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
 * @param props - Component props.
 * @param props.source - the files
 * @param props.index - which file is open
 * @param props.onIndex - move to another file
 * @param props.onClose - close the viewer
 * @param props.steps - labels for the previous and next buttons (default Previous and Next)
 * @param props.controls - shown above the details, e.g. a tick for the file on show
 * @returns the viewer, drawn over the whole window
 */
export function Viewer({
  source,
  index,
  onIndex,
  onClose,
  steps = ["Previous", "Next"],
  controls,
}: {
  source: ViewSource;
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  steps?: [string, string];
  controls?: ReactNode;
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

  // Capture phase, so Escape closes only the viewer, not the selection or menu of the page behind.
  useEffect(() => {
    /**
     * Escape closes the viewer; the left and right arrows step through the source, and Home and
     * End go to its first and last. Keys meant for a focused video's controls or a box in the side
     * panel are left to them.
     * @param event - the window's keydown, caught before the page behind sees it
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      // A date box in the side panel uses the arrows itself.
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < source.count - 1) onIndex(index + 1);
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === "Home" && index > 0) onIndex(0);
      if (event.key === "End" && index < source.count - 1) onIndex(source.count - 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, source.count, onIndex, onClose]);

  // Focus moves into the viewer, and back to whatever opened it on closing. That return doesn't
  // scroll: after stepping through photos the page may bring the last one shown into view
  // instead, and the opener mustn't pull the view back to where the viewer started.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => opener?.focus({ preventScroll: true });
  }, []);

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
  return createPortal(
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item ? item.name : "Photo viewer"}
      className="fixed inset-0 z-40 flex bg-ground outline-none"
    >
      <div className="on-dark relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-ground p-6">
        {item && (
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
          />
        )}
        <NavButton
          side="left"
          label={steps[0]}
          hidden={index === 0}
          onClick={() => onIndex(index - 1)}
        />
        <NavButton
          side="right"
          label={steps[1]}
          hidden={index >= source.count - 1}
          onClick={() => onIndex(index + 1)}
        />
      </div>

      <aside className="flex w-80 max-w-[45%] shrink-0 flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[14px] text-faint">
            {(index + 1).toLocaleString()} of {source.count.toLocaleString()}
          </span>
          <Button onClick={onClose}>
            <Icon name="close" size={18} />
            Close
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {error && <p className="mb-4 text-danger">{error}</p>}
          {item && (
            <>
              <h2 className="selectable text-[18px] leading-tight font-semibold break-all">
                {item.name}
              </h2>
              {controls && <div className="mt-4">{controls}</div>}
              {item.facts}
              <div className="mt-6 flex flex-wrap gap-2" hidden={item.missing}>
                {reveal && (
                  <Button onClick={() => run(() => reveal(index))}>
                    <Icon name="folder" size={16} />
                    Show in folder
                  </Button>
                )}
                {copy && (
                  <Button onClick={() => void copyFile()}>
                    <Icon name={copied === key ? "check" : "copy"} size={16} />
                    {copied === key ? "Copied" : "Copy"}
                  </Button>
                )}
                <Button onClick={() => run(() => source.open(index))}>
                  <Icon name="open" size={16} />
                  {openLabel}
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>
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
}: {
  item: ViewItem;
  gone: string;
  refresh?: { label: string; run: () => Promise<void> };
  onBroken: () => Promise<boolean>;
  onShown: () => void;
  openLabel: string;
  onOpen: () => void;
  onReveal?: () => void;
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
      onShown={onShown}
      onBroken={() => {
        onShown();
        broken();
      }}
    />
  );
}

/** How far a zoomed photo is moved from centred, in px. */
interface Offset {
  x: number;
  y: number;
}

/** Zoom steps the buttons, wheel and keys move through. 1 fits the photo in the window. */
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
/**
 * Wheel travel per zoom step. A mouse wheel notch is 100, so each notch is a step, while a
 * touchpad's stream of small deltas adds up instead of racing to the largest zoom.
 */
const WHEEL_STEP = 60;

/** Where a click on the photo at fit size zooms to. */
const CLICK_ZOOM = 2;
/** How far a press can move, in px, and still count as a click rather than a drag. */
const CLICK_SLOP = 4;
/** How long the full picture can take, in ms, before a busy mark shows. */
const SLOW_MS = 300;

/**
 * The next zoom step in or out, stopping at either end of {@link ZOOMS}.
 * @param zoom - the zoom now, one of {@link ZOOMS}
 * @param direction - 1 to zoom in, -1 to zoom out
 * @returns the zoom to go to
 */
function stepZoom(zoom: number, direction: 1 | -1): number {
  const at = ZOOMS.indexOf(zoom) + direction;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at))];
}

/**
 * A photo to look at closely: click to zoom in about the pointer and click again to fit, zoom
 * with the wheel, the + and - keys or the buttons beneath it, drag to look around a zoomed
 * photo, and turn it with R. Turning only changes how it's shown here; the file is never
 * changed.
 * @param props - Component props.
 * @param props.item - the photo on show
 * @param props.onShown - the full picture is on screen
 * @param props.onBroken - the full picture failed to load
 * @returns the photo with its zoom and turn buttons
 */
function Photo({
  item,
  onShown,
  onBroken,
}: {
  item: ViewItem;
  onShown: () => void;
  onBroken: () => void;
}): ReactElement {
  const [sharp, setSharp] = useState(false);
  // Whether the full picture's size is known yet; until then its box is empty.
  const [sized, setSized] = useState(false);
  const [slow, setSlow] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);
  const [pan, setPan] = useState<Offset>({ x: 0, y: 0 });
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
  // height, so it's scaled to fit again, but never past its real size.
  useEffect(() => {
    const box = stage.current;
    const img = photo.current;
    if (!box || !img) return;
    /** Work out the turned photo's fit for the stage's size now. */
    function measure(): void {
      if (!box || !img || !sideways || !img.offsetWidth || !img.offsetHeight) {
        setFit(1);
        return;
      }
      const width = img.offsetWidth;
      const height = img.offsetHeight;
      setFit(
        Math.min(
          box.clientWidth / height,
          box.clientHeight / width,
          (img.naturalWidth || width) / width,
        ),
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
   * Zoom to a step, keeping the point under `at` where it is.
   * @param next - the zoom to go to
   * @param at - the point to zoom about, in px from the stage's centre (default the centre)
   */
  function zoomTo(next: number, at: Offset = { x: 0, y: 0 }): void {
    if (next === zoom) return;
    const ratio = next / zoom;
    setPan(clamp({ x: at.x - (at.x - pan.x) * ratio, y: at.y - (at.y - pan.y) * ratio }, next));
    setZoom(next);
  }

  /** One step closer, about the centre. */
  function zoomIn(): void {
    zoomTo(stepZoom(zoom, 1));
  }

  /** One step further out, about the centre. */
  function zoomOut(): void {
    zoomTo(stepZoom(zoom, -1));
  }

  /** Back to the whole photo, fitted to the window. */
  function fitPhoto(): void {
    setZoom(1);
    setPan({ x: 0, y: 0 });
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
     * + and - zoom, 0 fits the photo again, R turns it.
     * @param event - the window's keydown
     */
    function onKey(event: KeyboardEvent): void {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (event.key === "+" || event.key === "=") zoomIn();
      else if (event.key === "-" || event.key === "_") zoomOut();
      else if (event.key === "0") fitPhoto();
      else if (event.key === "r" || event.key === "R") turn();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Zoom a step per notch, about the pointer.
   * @param event - the wheel over the stage
   */
  function onWheel(event: WheelEvent<HTMLDivElement>): void {
    wheel.current += event.deltaY;
    if (Math.abs(wheel.current) < WHEEL_STEP) return;
    const direction = wheel.current < 0 ? 1 : -1;
    wheel.current = 0;
    const rect = event.currentTarget.getBoundingClientRect();
    zoomTo(stepZoom(zoom, direction), {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  }

  /**
   * Start dragging a zoomed photo.
   * @param event - the press on the photo
   */
  function onPointerDown(event: PointerEvent<HTMLImageElement>): void {
    dragged.current = false;
    pressAt.current = { x: event.clientX, y: event.clientY };
    if (zoom === 1 || event.button !== 0) return;
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
   * Zoom in about the pointer at fit size, or back to fit when zoomed. A drag is not a click.
   * @param event - the click on the photo
   */
  function onClick(event: MouseEvent<HTMLImageElement>): void {
    if (dragged.current) return;
    if (zoom > 1) {
      fitPhoto();
      return;
    }
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    zoomTo(CLICK_ZOOM, {
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

  let cursor = "cursor-zoom-in";
  if (zoom > 1) cursor = dragging ? "cursor-grabbing" : "cursor-grab";
  const changed = zoom > 1 || turns > 0;

  // The tile is the photo's background until the full picture loads, so the photo shows at once,
  // a little soft, then sharpens. As a background it fills the photo's own box, which is known as
  // soon as the file's header is read, so a picture smaller than the screen never flashes up
  // stretched. It goes once the photo is in: the tile is flattened onto grey, which would show
  // through a transparent picture. A picture Windows draws has no box until it's done, so its
  // tile is its own layer filling the stage until then. A file the webview shows itself skips
  // that: its box comes within moments, and a small picture would flash up stretched.
  return (
    <div
      ref={stage}
      onWheel={onWheel}
      className="group relative flex size-full items-center justify-center"
    >
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
          className="pointer-events-none absolute top-0 right-0 animate-spin text-faint"
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
      <div
        className={`absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-md border border-line bg-surface/90 p-1 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${changed ? "opacity-100" : "opacity-0"}`}
      >
        <ToolButton
          icon="zoomOut"
          label="Zoom out (-)"
          disabled={zoom === ZOOMS[0]}
          onClick={zoomOut}
        />
        <button
          type="button"
          onClick={fitPhoto}
          title="Fit to window (0)"
          className="min-w-12 rounded px-1.5 py-1 text-[14px] font-semibold tabular-nums hover:bg-raised"
        >
          {zoom === 1 ? "Fit" : `${zoom}x`}
        </button>
        <ToolButton
          icon="zoom"
          label="Zoom in (+)"
          disabled={zoom === ZOOMS[ZOOMS.length - 1]}
          onClick={zoomIn}
        />
        <ToolButton icon="rotate" label="Turn (R)" onClick={turn} />
      </div>
    </div>
  );
}

/**
 * Small icon button under the photo, labelled by its tooltip.
 * @param props - Component props.
 * @param props.icon - which icon to show
 * @param props.label - what it does, with its key, for the tooltip and screen readers
 * @param props.disabled - at the end of its range
 * @param props.onClick - do it
 * @returns the button
 */
function ToolButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1.5 text-muted hover:bg-raised hover:text-ink disabled:text-faint disabled:hover:bg-transparent"
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
 * @param props.onClick - step to the neighbouring file
 * @returns the button
 */
function NavButton({
  side,
  label,
  hidden,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  hidden: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={hidden}
      title={label}
      aria-label={label}
      className={`absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface/70 text-ink hover:bg-raised disabled:invisible ${
        side === "left" ? "left-3" : "right-3"
      }`}
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
