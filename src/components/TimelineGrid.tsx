import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { thumbUrl, type Tile } from "../lib/api";
import { timelineRows } from "../lib/format";
import { tripBg } from "../lib/trips";
import { Icon } from "./Icon";

/** Preferred tile edge in CSS pixels; the real size stretches to fill the row. */
const TARGET_TILE = 168;
const GAP = 4;
const SIDE_PADDING = 32;
const HEADER_HEIGHT = 64;

/** Click or right-click on a tile, with the modifier keys that decide what it does. */
export type TileEvent = ReactMouseEvent<HTMLButtonElement>;

/**
 * Month-grouped photo grid that only renders the rows on screen.
 * @param props.tiles - tiles, newest first
 * @param props.selected - ids of selected tiles
 * @param props.onTileClick - called with a tile's index and the click
 * @param props.onTileMenu - called with a tile's index and the right-click
 * @param props.onThumbError - called when Windows has no thumbnail for a tile
 * @returns the scrolling grid
 */
export function TimelineGrid({
  tiles,
  selected,
  onTileClick,
  onTileMenu,
  onThumbError,
}: {
  tiles: Tile[];
  selected: ReadonlySet<number>;
  onTileClick: (index: number, event: TileEvent) => void;
  onTileMenu: (index: number, event: TileEvent) => void;
  onThumbError: (tile: Tile) => void;
}) {
  const selecting = selected.size > 0;
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
                        selecting={selecting}
                        selected={selected.has(tile.id)}
                        onClick={(event) => onTileClick(row.start + offset, event)}
                        onMenu={(event) => onTileMenu(row.start + offset, event)}
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
  selecting,
  selected,
  onClick,
  onMenu,
  onThumbError,
}: {
  tile: Tile;
  size: number;
  /** Some tile is selected, so a plain click selects instead of opening. */
  selecting: boolean;
  selected: boolean;
  onClick: (event: TileEvent) => void;
  onMenu: (event: TileEvent) => void;
  onThumbError: (tile: Tile) => void;
}) {
  const [failed, setFailed] = useState(false);
  const kind = tile.kind === "video" ? "Video" : "Photo";
  const trip = tile.trip ? `, ${tile.trip.name} trip` : "";
  const label = `${kind} taken ${tile.takenAt.replace("T", " ")}${trip}`;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onMenu}
      aria-label={label}
      aria-pressed={selecting ? selected : undefined}
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
      {tile.trip && (
        <span
          title={tile.trip.name}
          className={`absolute inset-x-0 bottom-0 h-1 ${tripBg(tile.trip.colour)}`}
        />
      )}
      {selected && (
        <span className="pointer-events-none absolute inset-0 rounded-[3px] ring-2 ring-paper ring-inset" />
      )}
      {selecting && (
        <span
          className={`absolute top-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full ${
            selected ? "bg-paper text-ground" : "border border-paper/70 bg-ground/40"
          }`}
        >
          {selected && <Icon name="check" size={14} />}
        </span>
      )}
    </button>
  );
}
