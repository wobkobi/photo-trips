import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { thumbUrl, type SampleTile } from "../lib/api";
import { spreadPick } from "../lib/trips";
import { HOVER_RING } from "./ui";
import { Viewer } from "./Viewer";
import { useLibrarySource } from "./viewSources";

/** Smallest a preview gets, in CSS pixels; a wider strip fits more of them rather than larger. */
const MIN_TILE = 160;
const GAP = 4;

/**
 * One row of photo previews from a trip or a suggested one, as many as fit across at a size
 * that can be made out, picked evenly through the trip. Each opens in the viewer, which steps
 * through the ones shown.
 * @param props - Component props.
 * @param props.sample - photos to choose from, already spread through the trip
 * @returns the strip
 */
export function SampleStrip({ sample }: { sample: SampleTile[] }): ReactElement {
  const stripRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewing, setViewing] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  const fits = Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)));
  const shown = useMemo(() => spreadPick(sample, fits), [sample, fits]);
  // Tiles stretch to fill the row, up to the room that the full set of `fits` would take.
  const size = width > 0 ? Math.floor((width - GAP * (fits - 1)) / fits) : MIN_TILE;
  const ids = useMemo(() => shown.map((tile) => tile.id), [shown]);
  const source = useLibrarySource(ids);

  // The padding keeps the focus outline inside the clipped row; the margin cancels it out.
  return (
    <div ref={stripRef} className="-m-1 flex overflow-hidden p-1" style={{ gap: GAP }}>
      {width > 0 &&
        shown.map((tile, index) => (
          <SampleThumb
            key={tile.id}
            tile={tile}
            size={size}
            label={`Look at photo ${index + 1} of ${shown.length}`}
            onOpen={() => setViewing(index)}
          />
        ))}
      {viewing !== null && viewing < shown.length && (
        <Viewer source={source} index={viewing} onIndex={setViewing} onClose={closeViewer} />
      )}
    </div>
  );
}

/**
 * One preview in the strip, left as an empty tile if it fails to load.
 * @param props - Component props.
 * @param props.tile - the photo to show
 * @param props.size - edge length in CSS pixels
 * @param props.label - accessible name, giving its place in the strip
 * @param props.onOpen - open it in the viewer
 * @returns the preview button
 */
function SampleThumb({
  tile,
  size,
  label,
  onOpen,
}: {
  tile: SampleTile;
  size: number;
  label: string;
  onOpen: () => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      title="Look at this one bigger"
      className={`relative shrink-0 overflow-hidden rounded-xs bg-raised ${HOVER_RING}`}
      style={{ width: size, height: size }}
    >
      {!failed && (
        <img
          src={thumbUrl(tile.id, tile.version)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </button>
  );
}
