import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, errorText, type MediaKind } from "../lib/api";
import { Icon } from "./Icon";
import { Button } from "./ui";

/** One file, ready for the viewer to show. */
export interface ViewItem {
  name: string;
  kind: MediaKind;
  /** The original file's URL, when the webview can show (photos) or play (videos) it as it is. */
  original: string | null;
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
          if (i !== index) preload(loadedItem);
        },
        (err) => {
          pending.current.delete(k);
          if (i === index) setFailure({ key: k, message: errorText(err) });
        },
      );
    }
  }, [source, index, items]);

  // Capture phase, so Escape closes only the viewer, not the selection or menu of the page behind.
  useEffect(() => {
    /**
     * Escape closes the viewer; the left and right arrows step through the source.
     * @param event - the window's keydown, caught before the page behind sees it
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < source.count - 1) onIndex(index + 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, source.count, onIndex, onClose]);

  // Focus moves into the viewer, and back to whatever opened it on closing.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.focus();
    return () => opener?.focus();
  }, []);

  /**
   * Run a file action, showing any failure in the side panel against the file on show.
   * @param action - the open or reveal call
   */
  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (err) {
      setFailure({ key, message: errorText(err) });
    }
  }

  const reveal = source.reveal;
  const openLabel = useOpenLabel(item?.name);
  return createPortal(
    <div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={item ? item.name : "Photo viewer"}
      className="fixed inset-0 z-40 flex bg-ground outline-none"
    >
      <div className="on-dark relative flex min-w-0 flex-1 items-center justify-center bg-ground p-6">
        {item && (
          <Media
            key={key}
            item={item}
            openLabel={openLabel}
            onOpen={() => run(() => source.open(index))}
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
              <div className="mt-6 flex flex-wrap gap-2">
                {reveal && (
                  <Button onClick={() => run(() => reveal(index))}>
                    <Icon name="folder" size={16} />
                    Show in folder
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
 * The photo or video itself, or a button to open it in its own app when Pic Cabinet can't.
 * @param props - Component props.
 * @param props.item - the file on show
 * @param props.openLabel - text for the open-in-app button
 * @param props.onOpen - open the file in its default app
 * @returns the media, or the fallback with its open button
 */
function Media({
  item,
  openLabel,
  onOpen,
}: {
  item: ViewItem;
  openLabel: string;
  onOpen: () => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  const [sharp, setSharp] = useState(false);
  const mediaClass = "max-h-full max-w-full object-contain";
  const video = item.kind === "video";

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
      </div>
    );
  }

  if (video) {
    return (
      <video
        src={item.original ?? undefined}
        poster={item.preview}
        controls
        autoPlay
        onError={() => setFailed(true)}
        className={mediaClass}
      />
    );
  }

  // The tile underneath is the same picture smaller, so the photo shows at once, a little soft,
  // and sharpens when the full one has loaded. It goes once that's in, since a small or
  // transparent full picture wouldn't cover it.
  return (
    <div className="relative flex size-full items-center justify-center">
      {!sharp && (
        <img
          src={item.thumb}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      <img
        src={item.original ?? item.preview}
        alt={item.name}
        draggable={false}
        onLoad={() => setSharp(true)}
        onError={() => setFailed(true)}
        className={`relative ${mediaClass}`}
      />
    </div>
  );
}

/**
 * Previous or next button over one side of the photo, hidden at that end of the source.
 * @param props - Component props.
 * @param props.side - which edge it sits on
 * @param props.label - what the button says
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
      className={`absolute top-1/2 flex min-h-12 min-w-12 -translate-y-1/2 items-center justify-center gap-2 rounded-full bg-surface/90 px-3 text-[17px] font-semibold text-ink hover:bg-raised disabled:invisible md:px-5 ${
        side === "left" ? "left-3 md:left-6" : "right-3 md:right-6"
      }`}
    >
      {side === "left" && <Icon name="back" />}
      {/* Icon only on a narrow window, where the two labels would meet over the photo. */}
      <span className="sr-only md:not-sr-only">{label}</span>
      {side === "right" && <Icon name="chevron" />}
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
