import { useEffect, useState, type ReactNode } from "react";
import { api, errorText, fileUrl, thumbUrl, type MediaDetail, type Tile } from "../lib/api";
import { formatBytes, formatTaken, sourceText } from "../lib/format";
import { Icon } from "./Icon";
import { Button } from "./ui";

const KIND_NAMES: Record<string, string> = {
  photo: "Photo",
  raw: "RAW",
  video: "Video",
  companion: "Sidecar",
};

/**
 * Full-window view of one tile with its details. Arrow keys step through the timeline.
 * @param props.tiles - the timeline, newest first
 * @param props.index - which tile is open
 * @param props.onIndex - move to another tile
 * @param props.onClose - close the viewer
 * @returns the viewer overlay
 */
export function Viewer({
  tiles,
  index,
  onIndex,
  onClose,
}: {
  tiles: Tile[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const tile = tiles[index];
  // Results are tagged with the tile they belong to, so stepping to another tile shows nothing
  // stale while its details load.
  const [loaded, setLoaded] = useState<{ id: number; detail: MediaDetail } | null>(null);
  const [failure, setFailure] = useState<{ id: number; message: string } | null>(null);
  const detail = loaded?.id === tile.id ? loaded.detail : null;
  const error = failure?.id === tile.id ? failure.message : null;
  const setError = (message: string) => setFailure({ id: tile.id, message });

  useEffect(() => {
    let active = true;
    api.mediaDetail(tile.id).then(
      (d) => active && setLoaded({ id: tile.id, detail: d }),
      (err) => active && setFailure({ id: tile.id, message: errorText(err) }),
    );
    return () => {
      active = false;
    };
  }, [tile.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      // Newest first, so "left" (earlier on screen) is the newer tile.
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < tiles.length - 1) onIndex(index + 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, tiles.length, onIndex, onClose]);

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      className="fixed inset-0 z-40 flex bg-ground"
    >
      <div className="on-dark relative flex min-w-0 flex-1 items-center justify-center bg-ground p-6">
        {detail && (
          <Media
            key={detail.id}
            detail={detail}
            onOpen={() => run(() => api.openMedia(detail.id))}
          />
        )}
        <NavButton side="left" disabled={index === 0} onClick={() => onIndex(index - 1)} />
        <NavButton
          side="right"
          disabled={index >= tiles.length - 1}
          onClick={() => onIndex(index + 1)}
        />
      </div>

      <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="text-[12px] text-faint">
            {(index + 1).toLocaleString()} of {tiles.length.toLocaleString()}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close viewer"
            className="rounded-md p-1.5 text-muted hover:bg-raised hover:text-ink"
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-3 pb-6">
          {error && <p className="mb-4 text-danger">{error}</p>}
          {detail && (
            <>
              <h2 className="selectable text-[24px] leading-tight font-bold tracking-tight break-all text-brand">
                {detail.name}
              </h2>

              <Fact label="Taken">
                <p>{formatTaken(detail.takenAt)}</p>
                <p
                  className={`mt-1 text-[12px] ${detail.dateSource === "modified" ? "text-warn" : "text-faint"}`}
                >
                  {sourceText(detail.dateSource)}
                </p>
              </Fact>

              {detail.lat !== null && detail.lon !== null && (
                <Fact label="Location">
                  <p className="selectable">
                    {detail.lat.toFixed(4)}, {detail.lon.toFixed(4)}
                  </p>
                </Fact>
              )}

              <Fact label="File">
                <p>
                  {KIND_NAMES[detail.kind]}, {formatBytes(detail.size)}
                </p>
                <p className="selectable mt-1 text-[12px] break-all text-faint">{detail.folder}</p>
              </Fact>

              {detail.members.length > 1 && (
                <Fact label="Moves together with">
                  <ul className="flex flex-col gap-1">
                    {detail.members.slice(1).map((m) => (
                      <li key={m.id} className="flex justify-between gap-3 text-[13px]">
                        <span className="selectable truncate">{m.name}</span>
                        <span className="shrink-0 text-faint">{KIND_NAMES[m.kind]}</span>
                      </li>
                    ))}
                  </ul>
                </Fact>
              )}

              <div className="mt-6 flex flex-wrap gap-2">
                <Button onClick={() => run(() => api.revealMedia(detail.id))}>
                  <Icon name="folder" size={16} />
                  Show in folder
                </Button>
                <Button onClick={() => run(() => api.openMedia(detail.id))}>
                  <Icon name="open" size={16} />
                  Open with Windows
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** The photo or video itself, with a fallback when the webview can't show it. */
function Media({ detail, onOpen }: { detail: MediaDetail; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  const mediaClass = "max-h-full max-w-full object-contain";

  if (failed || (detail.kind === "video" && !detail.playable)) {
    return (
      <div className="max-w-sm text-center">
        <img
          src={thumbUrl(detail.id, detail.version)}
          alt=""
          className="mx-auto mb-5 max-h-48 rounded-[3px] opacity-80"
          onError={(e) => (e.currentTarget.hidden = true)}
        />
        <p className="text-muted">
          {detail.kind === "video"
            ? "This video's format can't play inside Pic Cabinet."
            : "Windows can't draw this file, so it can't be shown here. It is still sorted like any other photo."}
        </p>
        <Button variant="primary" className="mt-5" onClick={onOpen}>
          <Icon name="play" size={16} />
          {detail.kind === "video" ? "Play in default player" : "Open with Windows"}
        </Button>
      </div>
    );
  }

  if (detail.kind === "video") {
    return (
      <video
        src={fileUrl(detail.path)}
        poster={thumbUrl(detail.id, detail.version, true)}
        controls
        autoPlay
        onError={() => setFailed(true)}
        className={mediaClass}
      />
    );
  }

  return (
    <img
      src={detail.viewable ? fileUrl(detail.path) : thumbUrl(detail.id, detail.version, true)}
      alt={detail.name}
      draggable={false}
      onError={() => setFailed(true)}
      className={mediaClass}
    />
  );
}

function NavButton({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Newer" : "Older"}
      className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-surface/80 p-2.5 text-muted hover:bg-raised hover:text-ink disabled:invisible ${
        side === "left" ? "left-4" : "right-4"
      }`}
    >
      <Icon name={side === "left" ? "back" : "chevron"} />
    </button>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="mb-1.5 text-[12px] text-faint">{label}</h3>
      {children}
    </section>
  );
}
