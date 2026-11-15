import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { thumbUrl, type Tile } from "../lib/api";
import { jumpRow, timelineRows, type TimelineRow } from "../lib/format";
import { tripBg } from "../lib/trips";
import { Icon } from "./Icon";

const GAP = 6;
const SIDE_PADDING = 32;
const HEADER_HEIGHT = 64;
/** Frames to wait for a jumped-to tile to be drawn before giving up on focusing it. */
const JUMP_FRAMES = 6;

/** Click or right-click on a tile, with the modifier keys that decide what it does. */
export type TileEvent = ReactMouseEvent<HTMLButtonElement>;

/** A month heading, with the tiles it covers (`start` to `end` index into the tiles). */
export type MonthRow = Extract<TimelineRow, { type: "month" }>;

/** A request to bring one tile into view. A new object each time, so a repeat click scrolls again. */
export interface TileJump {
  index: number;
}

/**
 * A library tile's thumbnail.
 * @param tile - the tile
 * @returns the thumbnail URL
 */
function libraryThumb(tile: Tile): string {
  return thumbUrl(tile.id, tile.version);
}

/**
 * Month-grouped photo grid that only renders the rows on screen.
 * @param props.tiles - tiles, newest first
 * @param props.tileSize - preferred tile edge in CSS pixels; tiles stretch to fill each row
 * @param props.selecting - picking photos, so tiles show a tick box and a click picks
 * @param props.selected - ids of selected tiles
 * @param props.onTileClick - called with a tile's index and the click
 * @param props.onTileMenu - called with a tile's index and the right-click
 * @param props.onTileZoom - called with a tile's index from its magnifier button; tiles only get
 * one when this is given
 * @param props.onThumbError - called when Windows has no thumbnail for a tile
 * @param props.thumbOf - a tile's thumbnail URL (default: the library thumbnail for its id)
 * @param props.monthAction - something to show at the right of a month heading
 * @param props.fadeUnselected - fade tiles that aren't selected, for when most are
 * @param props.jump - scroll to this tile, with its month heading when it's in the month's first
 *   row, and move keyboard focus to it
 * @returns the scrolling grid
 */
export function TimelineGrid({
  tiles,
  tileSize: target,
  selecting,
  selected,
  onTileClick,
  onTileMenu,
  onTileZoom,
  onThumbError,
  thumbOf = libraryThumb,
  monthAction,
  fadeUnselected = false,
  jump,
}: {
  tiles: Tile[];
  tileSize: number;
  selecting: boolean;
  selected: ReadonlySet<number>;
  onTileClick: (index: number, event: TileEvent) => void;
  onTileMenu: (index: number, event: TileEvent) => void;
  onTileZoom?: (index: number) => void;
  onThumbError: (tile: Tile) => void;
  thumbOf?: (tile: Tile) => string;
  monthAction?: (month: MonthRow) => ReactNode;
  fadeUnselected?: boolean;
  jump?: TileJump | null;
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
  const columns = Math.max(2, Math.floor((inner + GAP) / (target + GAP)));
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

  // Only the rows on screen exist, so the tile can be focused only once the scroll has drawn it,
  // usually a frame or two later; it's looked for each frame, up to JUMP_FRAMES. Focus is moved
  // without scrolling again, so the month heading stays in view above it. Each request is handled
  // once, so a later re-layout (the grid hidden and shown again) doesn't replay an old jump.
  const laidOut = width > 0;
  const handledJump = useRef<TileJump | null>(null);
  useEffect(() => {
    if (!jump || !laidOut || handledJump.current === jump) return;
    handledJump.current = jump;
    const row = jumpRow(rows, jump.index);
    if (row < 0) return;
    virtualizer.scrollToIndex(row, { align: "start" });
    let tries = 0;
    let done = false;
    const focusTile = () => {
      const tile = scrollRef.current?.querySelector<HTMLButtonElement>(
        `[data-tile="${jump.index}"]`,
      );
      if (tile) tile.focus({ preventScroll: true });
      else if (++tries < JUMP_FRAMES) frame = requestAnimationFrame(focusTile);
      done = tile != null || tries >= JUMP_FRAMES;
    };
    let frame = requestAnimationFrame(focusTile);
    return () => {
      cancelAnimationFrame(frame);
      // Cut short before the tile was found (as in Strict Mode's double run), so let it run again.
      if (!done) handledJump.current = null;
    };
    // Only a new request scrolls; a resize or new tiles shouldn't pull the view back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, laidOut]);

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
                  <div className="flex h-full items-end gap-4 pb-3">
                    <h2 className="flex items-end gap-3">
                      <span className="text-[26px] leading-none font-extrabold tracking-tight text-brand">
                        {row.label}
                      </span>
                      <span className="pb-0.5 text-[15px] text-faint">
                        {row.count.toLocaleString()}
                      </span>
                    </h2>
                    {monthAction?.(row)}
                  </div>
                ) : (
                  <div className="flex" style={{ gap: GAP }}>
                    {tiles.slice(row.start, row.end).map((tile, offset) => (
                      <TileButton
                        key={tile.id}
                        index={row.start + offset}
                        tile={tile}
                        size={tileSize}
                        selecting={selecting}
                        thumb={thumbOf(tile)}
                        selected={selected.has(tile.id)}
                        faded={fadeUnselected && !selected.has(tile.id)}
                        onClick={(event) => onTileClick(row.start + offset, event)}
                        onMenu={(event) => onTileMenu(row.start + offset, event)}
                        onZoom={onTileZoom && (() => onTileZoom(row.start + offset))}
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
  index,
  tile,
  thumb,
  size,
  selecting,
  selected,
  faded,
  onClick,
  onMenu,
  onZoom,
  onThumbError,
}: {
  /** Position in the grid, for finding the tile to focus after a jump. */
  index: number;
  tile: Tile;
  thumb: string;
  size: number;
  /** Picking photos, so a plain click picks instead of opening. */
  selecting: boolean;
  selected: boolean;
  faded: boolean;
  onClick: (event: TileEvent) => void;
  onMenu: (event: TileEvent) => void;
  /** Open the tile in the viewer from a magnifier button, for when a click picks instead. */
  onZoom?: () => void;
  onThumbError: (tile: Tile) => void;
}) {
  const [failed, setFailed] = useState(false);
  const kind = tile.kind === "video" ? "Video" : "Photo";
  const trip = tile.trip ? `, ${tile.trip.name} trip` : "";
  const label = `${kind} taken ${tile.takenAt.replace("T", " ")}${trip}`;

  // The magnifier sits beside the tile's button rather than in it, since a button can't hold
  // another button.
  return (
    <div className="group relative shrink-0" style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onMenu}
        data-tile={index}
        aria-label={label}
        aria-pressed={selecting ? selected : undefined}
        className="relative h-full w-full overflow-hidden rounded-[3px] bg-raised focus-visible:outline-offset-0"
      >
        {failed ? (
          <span className="flex h-full w-full items-center justify-center text-[20px] font-bold text-faint">
            .{tile.ext}
          </span>
        ) : (
          <img
            src={thumb}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => {
              setFailed(true);
              onThumbError(tile);
            }}
            className={`h-full w-full object-cover transition-opacity ${
              faded ? "opacity-35 grayscale group-hover:opacity-60" : "group-hover:opacity-90"
            }`}
          />
        )}
        {tile.uncertain && (
          <span
            title="Date uncertain: guessed from when the file was last changed"
            className={`on-dark absolute top-2 rounded-full bg-ground/80 p-1.5 text-warn ${
              onZoom ? "right-14" : "right-2"
            }`}
          >
            <Icon name="warn" size={16} />
          </span>
        )}
        {(tile.kind === "video" || tile.kind === "raw" || tile.extra > 0) && (
          <span className="on-dark absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-ground/80 to-transparent px-2 pt-5 pb-1.5 text-[13px] font-semibold text-ink">
            {tile.kind === "video" && <Icon name="play" size={18} />}
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
            className={`absolute inset-x-0 bottom-0 h-1.5 ${tripBg(tile.trip.colour)}`}
          />
        )}
        {selected && (
          <span className="pointer-events-none absolute inset-0 rounded-[3px] ring-4 ring-accent ring-inset" />
        )}
        {selecting && (
          <span
            className={`absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
              selected ? "border-white bg-accent text-white" : "on-dark border-ink bg-ground/50"
            }`}
          >
            {selected && <Icon name="check" size={20} />}
          </span>
        )}
      </button>
      {onZoom && (
        <button
          type="button"
          onClick={onZoom}
          aria-label={`Look at ${kind.toLowerCase()} taken ${tile.takenAt.replace("T", " ")}`}
          title="Look at this one bigger"
          className="on-dark absolute top-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-ground/70 text-ink hover:bg-ground focus-visible:bg-ground"
        >
          <Icon name="zoom" size={22} />
        </button>
      )}
    </div>
  );
}
