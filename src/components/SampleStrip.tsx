import { useState } from "react";
import { thumbUrl, type SampleTile } from "../lib/api";

/**
 * A row of small thumbnails from a trip or a suggested one.
 * @param props.sample - photos to show, already spread through the trip
 * @returns the strip
 */
export function SampleStrip({ sample }: { sample: SampleTile[] }) {
  return (
    <div className="flex gap-1 overflow-hidden">
      {sample.map((tile) => (
        <SampleThumb key={tile.id} tile={tile} />
      ))}
    </div>
  );
}

function SampleThumb({ tile }: { tile: SampleTile }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="h-16 w-16 shrink-0 overflow-hidden rounded-[3px] bg-raised">
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
    </span>
  );
}
