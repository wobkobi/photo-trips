import { useCallback, useMemo, useState, type ReactElement } from "react";
import { thumbUrl, type SampleTile } from "../lib/api";
import { Viewer } from "./Viewer";
import { useLibrarySource } from "./viewSources";

/**
 * A row of small thumbnails from a trip or a suggested one. Each opens in the viewer, which
 * steps through the rest of the row.
 * @param props - Component props.
 * @param props.sample - photos to show, already spread through the trip
 * @returns the strip
 */
export function SampleStrip({ sample }: { sample: SampleTile[] }): ReactElement {
  const [viewing, setViewing] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const ids = useMemo(() => sample.map((tile) => tile.id), [sample]);
  const source = useLibrarySource(ids);

  // The padding keeps the focus outline inside the clipped row; the margin cancels it out.
  return (
    <div className="-m-1 flex gap-1 overflow-hidden p-1">
      {sample.map((tile, index) => (
        <SampleThumb
          key={tile.id}
          tile={tile}
          label={`Look at photo ${index + 1} of ${sample.length}`}
          onOpen={() => setViewing(index)}
        />
      ))}
      {viewing !== null && viewing < sample.length && (
        <Viewer source={source} index={viewing} onIndex={setViewing} onClose={closeViewer} />
      )}
    </div>
  );
}

/**
 * One thumbnail in the strip, left as an empty tile if it fails to load.
 * @param props - Component props.
 * @param props.tile - the photo to show
 * @param props.label - accessible name, giving its place in the strip
 * @param props.onOpen - open it in the viewer
 * @returns the thumbnail button
 */
function SampleThumb({
  tile,
  label,
  onOpen,
}: {
  tile: SampleTile;
  label: string;
  onOpen: () => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="h-16 w-16 shrink-0 overflow-hidden rounded-[3px] bg-raised hover:opacity-85"
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
