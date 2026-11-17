import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { thumbUrl, type Tile } from "../lib/api";
import {
  count,
  formatTaken,
  gridPlace,
  jumpRow,
  placeRow,
  stepTile,
  tileRow,
  timelineRows,
  type GridPlace,
  type TimelineRow,
} from "../lib/format";
import { gridColumns, monthStarts } from "../lib/timelineLayout";
import { tripBg } from "../lib/trips";
import { DateRail, RAIL_SPACE } from "./DateRail";
import { Icon } from "./Icon";
import { MonthPin } from "./MonthPin";
import { Button, HOVER_RING, LIST_FILL } from "./ui";

// Tight gutters, so the grid reads as one wall of photos rather than a page of cards.
const GAP = 3;
const SIDE_PADDING = 12;
const HEADER_HEIGHT = 48;
/** Frames to wait for a jumped-to tile to be drawn before giving up on focusing it. */
const JUMP_FRAMES = 6;
/** Space left under the last row, so it doesn't sit hard against the bottom edge. */
const END_SPACE = 32;
/** Right padding of the rows while the date rail lies over the grid, keeping tiles clear of it. */
const RAIL_PADDING = RAIL_SPACE + 4;
/**
 * Ctrl+wheel travel per photo size step. A mouse wheel notch is 100, so each notch is a step,
 * while a touchpad pinch's stream of small deltas adds up instead of racing to an end.
 */
const WHEEL_STEP = 60;

/** Click or right-click on a tile, with the modifier keys that decide what it does. */
export type TileEvent = ReactMouseEvent<HTMLButtonElement>;

/** A month heading, with the tiles it covers (`start` to `end` index into the tiles). */
export type MonthRow = Extract<TimelineRow, { type: "month" }>;

/** A request to bring one tile into view. A new object each time, so a repeat click scrolls again. */
export interface TileJump {
  index: number;
  /**
   * "start" (the default) puts the tile's row, or its month heading when the tile is in the
   * month's first row, at the top. "auto" scrolls only as far as needed to show the tile's row,
   * so a tile already on screen doesn't move.
   */
  align?: "start" | "auto";
  /** Move keyboard focus to the tile once it's drawn (default true). */
  focus?: boolean;
}

/**
 * The tile that holds the grid's one Tab stop (see the roving Tab stop in {@link TimelineGrid}).
 * @param rows - the grid's rows
 * @param drawn - the rows drawn now, overscan included
 * @param range - the rows on screen, or null before the first layout
 * @param current - the tile last focused, if any
 * @param focusIn - focus is in the grid now
 * @returns the tile's index; 0 when no tile row is drawn
 */
function gridTabStop(
  rows: TimelineRow[],
  drawn: VirtualItem[],
  range: { startIndex: number; endIndex: number } | null,
  current: number | null,
  focusIn: boolean,
): number {
  /**
   * Whether a row is on screen.
   * @param row - the row's index
   * @returns true when it's within the visible range
   */
  const onScreen = (row: number): boolean =>
    range !== null && row >= range.startIndex && row <= range.endIndex;
  if (current !== null) {
    const row = tileRow(rows, current);
    if (row >= 0 && (focusIn ? drawn.some((item) => item.index === row) : onScreen(row))) {
      return current;
    }
  }
  const tileRows = drawn.filter((item) => rows[item.index]?.type === "tiles");
  const first = tileRows.find((item) => onScreen(item.index)) ?? tileRows[0];
  return first ? rows[first.index].start : 0;
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
 * Whether the grid may take keyboard focus on showing: not over a dialog or the viewer, not in
 * a page that's inert (under the tour), and not from anything already focused in the page, such
 * as the search box Ctrl+F just focused. Focus left on the menu that opened the page, or on
 * nothing, is fair game.
 * @param grid - the grid's scroller
 * @returns true when focusing a tile takes focus from nothing that wants it
 */
function mayTakeFocus(grid: HTMLElement): boolean {
  if (grid.closest("[inert]")) return false;
  if (document.querySelector('dialog[open], [aria-modal="true"]')) return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return !active.closest("main");
}

/**
 * Month-grouped photo grid that only renders the rows on screen.
 * @param props - Component props.
 * @param props.tiles - tiles, newest first
 * @param props.tileSize - preferred tile edge in CSS pixels; tiles stretch to fill each row
 * @param props.selecting - picking photos, so tiles show a tick box and a click picks
 * @param props.selected - ids of selected tiles
 * @param props.onTileClick - called with a tile's index, the click, and the tile that had focus
 *   before it (null when none has), for a Shift+click with no anchor to range from
 * @param props.onTileExtend - called with the tile focus left and the tile it moved to when
 *   Shift (or Ctrl+Shift, with true) and an arrow, Page Up, Page Down, Home or End moves focus;
 *   without it those keys are left alone
 * @param props.onTileMenu - called with a tile's index and the right-click
 * @param props.onTileZoom - called with a tile's index from its magnifier button; tiles only get
 * one when this is given
 * @param props.onThumbError - called when Windows has no thumbnail for a tile
 * @param props.thumbOf - a tile's thumbnail URL (default: the library thumbnail for its id)
 * @param props.thumbRetry - raise to have tiles without a thumbnail ask for one again
 * @param props.monthAction - something to show at the right of a month heading
 * @param props.fadeUnselected - fade tiles that aren't selected, for when most are
 * @param props.showUncertain - mark every tile with an uncertain date, not just the one hovered,
 *   for when those are what's being looked for
 * @param props.jump - scroll to this tile ({@link TileJump} says how far) and move keyboard focus
 *   to it unless asked not to
 * @param props.onJumpDone - called once `jump` has been carried out, so the page can drop it
 * @param props.ownsHeight - the grid sits straight in a page column, so it keeps its own minimum
 *   height ({@link LIST_FILL}); otherwise its parent row does
 * @param props.place - where the grid is scrolled to ({@link GridPlace}), kept up to date as it
 *   scrolls and gone back to when the grid mounts again; without it the grid keeps its own,
 *   which still holds its place when the column count changes
 * @param props.onSizeStep - called with 1 (bigger) or -1 (smaller) for each Ctrl+wheel notch over
 *   the grid; without it Ctrl+wheel is left alone
 * @param props.takeFocus - focus the grid's Tab stop once it's first laid out, unless that would
 *   take focus from something in the page or from a dialog
 * @returns the scrolling grid
 */
export function TimelineGrid({
  tiles,
  tileSize: target,
  selecting,
  selected,
  onTileClick,
  onTileExtend,
  onTileMenu,
  onTileZoom,
  onThumbError,
  thumbOf = libraryThumb,
  thumbRetry = 0,
  monthAction,
  fadeUnselected = false,
  showUncertain = false,
  jump,
  onJumpDone,
  ownsHeight = false,
  place,
  onSizeStep,
  takeFocus = false,
}: {
  tiles: Tile[];
  tileSize: number;
  selecting: boolean;
  selected: ReadonlySet<number>;
  onTileClick: (index: number, event: TileEvent, focused: number | null) => void;
  onTileExtend?: (from: number, to: number, keep: boolean) => void;
  onTileMenu: (index: number, event: TileEvent) => void;
  onTileZoom?: (index: number) => void;
  onThumbError: (tile: Tile) => void;
  thumbOf?: (tile: Tile) => string;
  thumbRetry?: number;
  monthAction?: (month: MonthRow) => ReactNode;
  fadeUnselected?: boolean;
  showUncertain?: boolean;
  jump?: TileJump | null;
  onJumpDone?: () => void;
  ownsHeight?: boolean;
  place?: RefObject<GridPlace | null>;
  onSizeStep?: (step: 1 | -1) => void;
  takeFocus?: boolean;
}): ReactElement {
  const outerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ownPlace = useRef<GridPlace | null>(null);
  const placeRef = place ?? ownPlace;
  // The scroller's width less its scrollbar, and the whole grid's, which no scrollbar changes.
  const [width, setWidth] = useState(0);
  const [outerWidth, setOuterWidth] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const outer = outerRef.current;
    if (!el || !outer) return;
    // Measured at once, before the first paint, so the first frame already has its rows and a
    // place gone back to never shows the top first. The observer keeps it current after that.
    setWidth(el.clientWidth);
    setViewHeight(el.clientHeight);
    setOuterWidth(outer.clientWidth);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === outer) setOuterWidth(entry.contentRect.width);
        else {
          setWidth(entry.contentRect.width);
          setViewHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  // The rail is decided from the layout it would leave, at the grid's full width (the scrollbar
  // hides while it shows), so it never depends on itself: the layout without it is wider, so
  // shorter, and can't call for it either. It's only worth showing with somewhere to jump to.
  const railed = gridColumns(outerWidth - SIDE_PADDING - RAIL_PADDING, target, GAP);
  const railRows = useMemo(() => timelineRows(tiles, railed.columns), [tiles, railed.columns]);
  const railHeight = useMemo(
    () => monthStarts(railRows, railed.tileSize, GAP, HEADER_HEIGHT),
    [railRows, railed.tileSize],
  );
  const showRail = railHeight.months.length > 1 && railHeight.total + END_SPACE > viewHeight * 1.5;
  const plain = gridColumns(width - SIDE_PADDING * 2, target, GAP);
  const { columns, tileSize } = showRail ? railed : plain;
  const rows = useMemo(
    () => (columns === railed.columns ? railRows : timelineRows(tiles, columns)),
    [tiles, columns, railed.columns, railRows],
  );
  // Where each month starts, from the same row heights the list lays out with, for the date rail
  // and the pinned month label.
  const { months, total: rowsHeight } = useMemo(
    () => monthStarts(rows, tileSize, GAP, HEADER_HEIGHT),
    [rows, tileSize],
  );
  const total = rowsHeight + END_SPACE;

  // TanStack Virtual returns fresh functions each render, which the React Compiler can't
  // memoise; it skips this component, which is the documented, intended outcome.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    /**
     * The element the grid scrolls in.
     * @returns the scroll container, or null before it mounts
     */
    getScrollElement: () => scrollRef.current,
    /**
     * Month headings have a fixed height; a tile row is one tile plus the gap below it.
     * @param i - the row's index in `rows`
     * @returns the row height in pixels
     */
    estimateSize: (i) => (rows[i].type === "month" ? HEADER_HEIGHT : tileSize + GAP),
    overscan: 3,
  });

  // Row heights depend on the tile size, so re-measure whenever the layout changes.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, tileSize, rows]);

  // Go back to the kept place once the grid is first laid out, and again at a new column count,
  // where the same pixel offset would land months away. Before paint, so there's no jump.
  const laidOut = width > 0;
  const placedAt = useRef(0);
  // The row a kept place was put back at. While it stays at the top the place isn't rewritten
  // from it, since that would swap the kept tile for the first in its new row and creep back a
  // few photos on every size change.
  const placedRow = useRef(-1);
  useLayoutEffect(() => {
    if (!laidOut || placedAt.current === columns) return;
    placedAt.current = columns;
    const kept = placeRef.current;
    const row = kept ? placeRow(rows, tiles, kept) : -1;
    if (row < 0) return;
    // Sizes may still be the estimates from before the width was known.
    virtualizer.measure();
    virtualizer.scrollToIndex(row, { align: "start" });
    placedRow.current = row;
    // Only the layout decides when to go back; new tiles or a moved place mustn't pull the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laidOut, columns]);

  // Keep the place up to date as the grid scrolls, by the row at the top of the view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !laidOut) return;
    /** Note the row now at the top of the view. */
    const onScroll = (): void => {
      const top = virtualizer.getVirtualItemForOffset(el.scrollTop);
      if (!top || top.index === placedRow.current) return;
      placedRow.current = -1;
      placeRef.current = gridPlace(rows, tiles, top.index);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [virtualizer, rows, tiles, placeRef, laidOut]);

  // Only the rows on screen exist, so the tile can be focused only once the scroll has drawn it,
  // usually a frame or two later; it's looked for each frame, up to JUMP_FRAMES. Focus is moved
  // without scrolling again, so the month heading stays in view above it. A request runs once per
  // mount, and once it's carried out onJumpDone has the page drop it, so a grid mounted again
  // later (after a trip review) goes back to its kept place rather than replaying it.
  const handledJump = useRef<TileJump | null>(null);
  const jumpDone = useRef(onJumpDone);
  useEffect(() => {
    jumpDone.current = onJumpDone;
  });
  useEffect(() => {
    if (!jump || !laidOut || handledJump.current === jump) return;
    handledJump.current = jump;
    const align = jump.align ?? "start";
    const row = align === "auto" ? tileRow(rows, jump.index) : jumpRow(rows, jump.index);
    if (row >= 0) virtualizer.scrollToIndex(row, { align });
    if (row < 0 || jump.focus === false) {
      jumpDone.current?.();
      return;
    }
    let tries = 0;
    let done = false;
    /** Focus the jumped-to tile once it's drawn, retrying each frame up to JUMP_FRAMES. */
    const focusTile = (): void => {
      const tile = scrollRef.current?.querySelector<HTMLButtonElement>(
        `[data-tile="${jump.index}"]`,
      );
      if (tile) tile.focus({ preventScroll: true });
      else if (++tries < JUMP_FRAMES) frame = requestAnimationFrame(focusTile);
      done = tile != null || tries >= JUMP_FRAMES;
      // Not sooner: dropping the request cancels the frames still looking for the tile.
      if (done) jumpDone.current?.();
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

  // Ctrl+wheel resizes the photos instead of zooming the whole window. React's onWheel is
  // passive, so it can't stop the zoom; this listener isn't. A plain wheel still scrolls.
  const wheel = useRef(0);
  useEffect(() => {
    const el = outerRef.current;
    if (!el || !onSizeStep) return;
    /**
     * Step the photo size once per notch of Ctrl+wheel.
     * @param event - a wheel turn over the grid or its date rail
     */
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      wheel.current += event.deltaY;
      if (Math.abs(wheel.current) < WHEEL_STEP) return;
      const step = wheel.current < 0 ? 1 : -1;
      wheel.current = 0;
      onSizeStep(step);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onSizeStep]);

  // On first showing, focus the tile Tab would land on. A frame later, so a kept place has been
  // gone back to and the Tab stop is a tile on screen there.
  const tookFocus = useRef(false);
  useEffect(() => {
    if (!takeFocus || !laidOut || tookFocus.current) return;
    const frame = requestAnimationFrame(() => {
      tookFocus.current = true;
      const el = scrollRef.current;
      if (!el || !mayTakeFocus(el)) return;
      el.querySelector<HTMLElement>('[data-tile][tabindex="0"]')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [takeFocus, laidOut]);

  // The grid is one Tab stop, and the arrow keys move between its tiles. The stop is the tile
  // last focused while that's on screen, or while focus is still in the grid (so Tab from a
  // focused tile scrolled off screen leaves the grid rather than landing on another tile), else
  // the first tile on screen. A focused tile scrolled far enough to unmount drops focus to the
  // page, and Tab back in lands on the first tile on screen.
  const [current, setCurrent] = useState<number | null>(null);
  const [focusIn, setFocusIn] = useState(false);
  const items = virtualizer.getVirtualItems();
  const range = virtualizer.range;
  const tabTile = gridTabStop(rows, items, range, current, focusIn);
  // A press focuses the tile pressed before its click arrives, so the tile focused before the
  // press is noted as the press starts, for a Shift+click to range from.
  const lastFocused = useRef<number | null>(null);
  const focusedBeforePress = useRef<number | null>(null);

  /**
   * Note the focused tile as the grid's Tab stop.
   * @param event - focus arriving on something in the grid
   */
  function onGridFocus(event: ReactFocusEvent<HTMLDivElement>): void {
    setFocusIn(true);
    const tile = event.target.dataset.tile ?? event.target.dataset.zoomTile;
    if (tile === undefined) return;
    setCurrent(Number(tile));
    lastFocused.current = Number(tile);
  }

  /**
   * Pass a tile's click on with the tile focused before it. A click from the keyboard (detail 0)
   * has no press, and the tile clicked is the one focused.
   * @param index - the clicked tile
   * @param event - the click
   */
  function clickTile(index: number, event: TileEvent): void {
    onTileClick(
      index,
      event,
      event.detail === 0 ? lastFocused.current : focusedBeforePress.current,
    );
  }

  /**
   * Note focus leaving the grid altogether.
   * @param event - focus leaving something in the grid
   */
  function onGridBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusIn(false);
  }

  /**
   * Arrow keys, Page Up, Page Down, Home and End move focus between tiles; a page is as many tile
   * rows as fit on screen whole. With Shift (and `onTileExtend` given) the move also extends the
   * selection, and Ctrl+Shift keeps what was selected besides. Ctrl alone is left to the page.
   * @param event - a key press inside the grid
   */
  function onGridKey(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.metaKey) return;
    if (event.shiftKey ? !onTileExtend : event.ctrlKey) return;
    const from = (event.target as HTMLElement).dataset.tile;
    if (from === undefined) return;
    const page = Math.floor(viewHeight / (tileSize + GAP));
    const to = stepTile(rows, Number(from), event.key, tiles.length, page);
    if (to === null) return;
    event.preventDefault();
    focusTileAt(to);
    if (event.shiftKey) onTileExtend?.(Number(from), to, event.ctrlKey);
  }

  /**
   * Move focus to a tile. It may not be drawn yet, so its row is scrolled into view first and the
   * tile focused once it's there, retrying each frame up to JUMP_FRAMES, as for a jump.
   * @param to - the tile's index
   */
  function focusTileAt(to: number): void {
    virtualizer.scrollToIndex(tileRow(rows, to), { align: "auto" });
    let tries = 0;
    /** Look for the tile, and try again next frame while it isn't drawn. */
    const focusTile = (): void => {
      const tile = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-tile="${to}"]`);
      if (tile) tile.focus({ preventScroll: true });
      else if (++tries < JUMP_FRAMES) requestAnimationFrame(focusTile);
    };
    focusTile();
  }

  return (
    <div ref={outerRef} className={`relative flex ${ownsHeight ? LIST_FILL : "min-h-0 flex-1"}`}>
      {/* Key presses bubble up from the focused tile button. The date rail stands in for the
          scrollbar while it shows. */}
      <div
        ref={scrollRef}
        onKeyDown={onGridKey}
        onPointerDownCapture={() => (focusedBeforePress.current = lastFocused.current)}
        onFocus={onGridFocus}
        onBlur={onGridBlur}
        className={`min-w-0 flex-1 overflow-y-auto ${showRail ? "no-scrollbar" : ""}`}
      >
        {width > 0 && (
          <div
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() + END_SPACE }}
          >
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={row.key}
                  className="absolute left-0 w-full"
                  style={{
                    transform: `translateY(${item.start}px)`,
                    height: item.size,
                    paddingLeft: SIDE_PADDING,
                    paddingRight: showRail ? RAIL_PADDING : SIDE_PADDING,
                  }}
                >
                  {row.type === "month" ? (
                    // The row has a fixed height (HEADER_HEIGHT), so nothing in it may wrap: a long
                    // month name is cut short instead of growing up over the photos above.
                    <div className="group/month flex h-full items-end gap-4 px-1 pb-1">
                      <h2 className="flex min-w-0 items-baseline gap-2.5 pb-2.5">
                        <span className="truncate text-[16px] leading-none font-semibold">
                          {row.label}
                        </span>
                        <span className="shrink-0 text-[13px] leading-none text-faint">
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
                          tabStop={row.start + offset === tabTile}
                          selecting={selecting}
                          thumb={thumbOf(tile)}
                          retry={thumbRetry}
                          selected={selected.has(tile.id)}
                          faded={fadeUnselected && !selected.has(tile.id)}
                          showUncertain={showUncertain}
                          onClick={(event) => clickTile(row.start + offset, event)}
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
      {width > 0 && <MonthPin months={months} scrollRef={scrollRef} inset={SIDE_PADDING} />}
      {showRail && <DateRail months={months} total={total} scrollRef={scrollRef} />}
    </div>
  );
}

/**
 * A month heading's button, for {@link TimelineGrid}'s `monthAction`, that selects the whole
 * month, or deselects it when all of it is selected. Short on screen so it fits the fixed-height
 * heading beside the name; the full wording is read out.
 * @param props - Component props.
 * @param props.month - the month row the button belongs to
 * @param props.allPicked - every photo in the month is selected, so the button deselects
 * @param props.onPick - called with true to select the month or false to deselect it
 * @param props.onHover - show the button only while the heading is hovered, and leave it out of
 *   the Tab order, for when nothing is being selected yet
 * @returns the button
 */
export function MonthPickButton({
  month,
  allPicked,
  onPick,
  onHover = false,
}: {
  month: MonthRow;
  allPicked: boolean;
  onPick: (pick: boolean) => void;
  onHover?: boolean;
}): ReactElement {
  return (
    <Button
      variant="ghost"
      className={`ml-auto shrink-0 whitespace-nowrap ${
        onHover ? "opacity-0 group-hover/month:opacity-100 focus-visible:opacity-100" : ""
      }`}
      tabIndex={onHover ? -1 : undefined}
      aria-label={allPicked ? `Deselect all of ${month.label}` : `Select all of ${month.label}`}
      onClick={() => onPick(!allPicked)}
    >
      {allPicked ? "Deselect month" : "Select month"}
    </Button>
  );
}

/**
 * One square tile in a {@link TimelineGrid}: the thumbnail (or the file extension when Windows
 * has none), a tick box while selecting, and an optional magnifier beside it.
 * @param props - Component props.
 * @param props.index - position in the grid, for finding the tile to focus after a jump
 * @param props.tile - the photo or video
 * @param props.thumb - thumbnail URL
 * @param props.retry - a count that, when raised, has a tile without a thumbnail ask again
 * @param props.size - tile edge in CSS pixels
 * @param props.tabStop - the grid's one Tab stop; every other tile is reached by the arrow keys
 * @param props.selecting - picking photos, so a plain click picks instead of opening
 * @param props.selected - the tile is picked
 * @param props.faded - dim the tile, for an unpicked one when most are picked
 * @param props.showUncertain - show the uncertain-date mark without a hover
 * @param props.onClick - called with the click
 * @param props.onMenu - called with the right-click
 * @param props.onZoom - open the tile in the viewer from a magnifier button; no magnifier without it
 * @param props.onThumbError - called when the thumbnail fails to load
 * @returns the tile
 */
function TileButton({
  index,
  tile,
  thumb,
  retry,
  size,
  tabStop,
  selecting,
  selected,
  faded,
  showUncertain,
  onClick,
  onMenu,
  onZoom,
  onThumbError,
}: {
  /** Position in the grid, for finding the tile to focus after a jump. */
  index: number;
  tile: Tile;
  thumb: string;
  retry: number;
  size: number;
  tabStop: boolean;
  /** Picking photos, so a plain click picks instead of opening. */
  selecting: boolean;
  selected: boolean;
  faded: boolean;
  showUncertain: boolean;
  onClick: (event: TileEvent) => void;
  onMenu: (event: TileEvent) => void;
  /** Open the tile in the viewer from a magnifier button, for when a click picks instead. */
  onZoom?: () => void;
  onThumbError: (tile: Tile) => void;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  // A retry asks under a new URL, since the webview remembers an image that failed to load.
  // Only a tile that failed changes URL, so tiles that loaded keep their cached image. askAt is
  // the retry count this tile's URL carries (0 for the plain URL).
  const [askAt, setAskAt] = useState(0);
  const [triedAt, setTriedAt] = useState(retry);
  if (triedAt !== retry) {
    setTriedAt(retry);
    if (failed) {
      setFailed(false);
      setAskAt(retry);
    }
  }
  const src = askAt ? `${thumb}${thumb.includes("?") ? "&" : "?"}retry=${askAt}` : thumb;
  const kind = tile.kind === "video" ? "Video" : tile.live ? "Live Photo" : "Photo";
  const raw = tile.kind === "raw" || tile.rawTwin;
  // The Live Photo ring and the RAW mark name two of the files that go along; the count is for
  // the rest, such as sidecars.
  const more = tile.extra - Number(tile.live) - Number(tile.rawTwin);
  const taken = formatTaken(tile.takenAt);
  const trip = tile.trip ? `, ${tile.trip.name} trip` : "";
  const label = `${tile.name}, ${kind.toLowerCase()} taken ${taken}${trip}`;
  const tip = [
    tile.name,
    taken,
    tile.uncertain && "Date uncertain",
    tile.trip && `${tile.trip.name} trip`,
  ]
    .filter(Boolean)
    .join("\n");

  // The magnifier sits beside the tile's button rather than in it, since a button can't hold
  // another button.
  return (
    <div className="group relative shrink-0" style={{ width: size, height: size }}>
      <button
        type="button"
        onClick={onClick}
        onContextMenu={onMenu}
        data-tile={index}
        tabIndex={tabStop ? 0 : -1}
        aria-label={label}
        title={tip}
        aria-pressed={selecting ? selected : undefined}
        className={`relative h-full w-full overflow-hidden rounded-xs bg-raised focus-visible:outline-offset-0 ${HOVER_RING}`}
      >
        {failed ? (
          <span className="flex h-full w-full items-center justify-center text-[20px] font-bold text-faint">
            .{tile.ext}
          </span>
        ) : (
          <img
            src={src}
            alt=""
            decoding="async"
            draggable={false}
            onError={() => {
              // A tile scrolled in after a retry may hit the plain URL's remembered failure;
              // it gets one fresh ask under the current count before it counts as failed.
              if (askAt !== retry) {
                setAskAt(retry);
                return;
              }
              setFailed(true);
              onThumbError(tile);
            }}
            className={`h-full w-full object-cover transition-opacity ${
              faded ? "opacity-35 grayscale group-hover:opacity-60" : ""
            }`}
          />
        )}
        {/* A guessed date is worth a mark only on the tile being looked at, or on all of them
            while they're what the filter shows; on every tile it's noise. */}
        {tile.uncertain && (
          <span
            title="Date uncertain: guessed from when the file was last changed"
            className={`on-dark absolute top-2 rounded-full bg-ground/80 p-1.5 text-warn ${
              onZoom ? "right-11" : "right-2"
            } ${showUncertain ? "" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"}`}
          >
            <Icon name="warn" size={16} />
          </span>
        )}
        {(tile.kind === "video" || raw || tile.live || more > 0) && (
          <span className="on-dark absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-linear-to-t from-ground/80 to-transparent px-2 pt-5 pb-1.5 text-[13px] font-semibold text-ink">
            {tile.kind === "video" && <Icon name="play" size={18} />}
            {raw && <span title={tile.rawTwin ? "With a RAW copy" : undefined}>RAW</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {tile.live && (
                <span title="Live Photo">
                  <Icon name="live" size={16} />
                </span>
              )}
              {more > 0 && (
                <span title={`${count(more, "more file goes", "more files go")} with this one`}>
                  +{more}
                </span>
              )}
            </span>
          </span>
        )}
        {tile.trip && (
          <span
            title={tile.trip.name}
            className={`absolute inset-x-0 bottom-0 h-1.5 ${tripBg(tile.trip.colour)}`}
          />
        )}
        {selected && (
          <span className="pointer-events-none absolute inset-0 rounded-xs ring-4 ring-accent ring-inset" />
        )}
        {selecting && (
          <span
            className={`absolute top-2 left-2 flex h-8 w-8 items-center justify-center rounded-full border-2 ${
              selected ? "border-white bg-accent text-ground" : "on-dark border-ink bg-ground/50"
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
          data-zoom-tile={index}
          tabIndex={tabStop ? 0 : -1}
          aria-label={`Open ${tile.name}`}
          title="Open"
          className="on-dark absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-ground/70 text-ink opacity-0 group-hover:opacity-100 hover:bg-ground focus-visible:bg-ground focus-visible:opacity-100"
        >
          <Icon name="zoom" size={18} />
        </button>
      )}
    </div>
  );
}
