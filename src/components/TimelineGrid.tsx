import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { thumbUrl, type Tile } from "../lib/api";
import { timelineRows } from "../lib/format";
import { Icon } from "./Icon";

/** Preferred tile edge in CSS pixels; the real size stretches to fill the row. */
const TARGET_TILE = 168;
const GAP = 4;
const SIDE_PADDING = 32;
const HEADER_HEIGHT = 64;

/**
 * Month-grouped photo grid that only renders the rows on screen.
 * @param props.tiles - tiles, newest first
 * @param props.onOpen - called with a tile's index when it is clicked
 * @param props.onThumbError - called when Windows has no thumbnail for a tile
 * @returns the scrolling grid
 */
export function TimelineGrid({
  tiles,
  onOpen,
  onThumbError,
}: {
  tiles: Tile[];
  onOpen: (index: number) => void;
  onThumbError: (tile: Tile) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const inner = Math.max(0, width - SIDE_PADDING * 2);
  const columns = Math.max(2, Math.floor((inner + GAP) / (TARGET_TILE + GAP)));
  const tileSize = Math.floor((inner - GAP * (columns - 1)) / columns);
  const rows = useMemo(() => timelineRows(tiles, columns), [tiles, columns]);

  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].type === "month" ? HEADER_HEIGHT : tileSize + GAP),
    overscan: 3,
  });

  // Row heights depend on the tile size, so re-measure whenever the layout changes.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, tileSize, rows]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {width > 0 && (
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() + 32 }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.key}
                className="absolute left-0 w-full"
                style={{
                  transform: `translateY(${item.start}px)`,
                  height: item.size,
                  paddingInline: SIDE_PADDING,
                }}
              >
                {row.type === "month" ? (
                  <h2 className="flex h-full items-end gap-3 pb-3">
                    <span className="font-display text-[26px] leading-none font-semibold">
                      {row.label}
                    </span>
                    <span className="pb-0.5 text-[13px] text-faint">
                      {row.count.toLocaleString()}
                    </span>
                  </h2>
                ) : (
                  <div className="flex" style={{ gap: GAP }}>
                    {tiles.slice(row.start, row.end).map((tile, offset) => (
                      <TileButton
                        key={tile.id}
                        tile={tile}
                        size={tileSize}
                        onOpen={() => onOpen(row.start + offset)}
                        onThumbError={onThumbError}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TileButton({
  tile,
  size,
  onOpen,
  onThumbError,
}: {
  tile: Tile;
  size: number;
  onOpen: () => void;
  onThumbError: (tile: Tile) => void;
}) {
  const [failed, setFailed] = useState(false);
  const label = `${tile.kind === "video" ? "Video" : "Photo"} taken ${tile.takenAt.replace("T", " ")}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="group relative shrink-0 overflow-hidden rounded-[3px] bg-surface focus-visible:outline-offset-0"
      style={{ width: size, height: size }}
    >
      {failed ? (
        <span className="flex h-full w-full items-center justify-center font-display text-[20px] text-faint">
          .{tile.ext}
        </span>
      ) : (
        <img
          src={thumbUrl(tile.id, tile.version)}
          alt=""
          decoding="async"
          draggable={false}
          onError={() => {
            setFailed(true);
            onThumbError(tile);
          }}
          className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
        />
      )}
      {tile.uncertain && (
        <span
          title="Date uncertain: guessed from when the file was last changed"
          className="absolute top-1.5 right-1.5 rounded-full bg-ground/80 p-1 text-warn"
        >
          <Icon name="warn" size={12} />
        </span>
      )}
      {(tile.kind === "video" || tile.kind === "raw" || tile.extra > 0) && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-ground/80 to-transparent px-2 pt-5 pb-1.5 text-[11px] font-medium text-paper">
          {tile.kind === "video" && <Icon name="play" size={12} />}
          {tile.kind === "raw" && <span>raw</span>}
          {tile.extra > 0 && (
            <span className="ml-auto" title={`${tile.extra} more file(s) travel with this one`}>
              +{tile.extra}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
