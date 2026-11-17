import { useCallback, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { Tile } from "../lib/api";
import { count } from "../lib/format";
import { setPicked } from "../lib/picker";
import { Icon } from "./Icon";
import { TimelineGrid, type MonthRow, type TileEvent, type TileJump } from "./TimelineGrid";
import { Button } from "./ui";
import { Viewer, type ViewSource } from "./Viewer";

/**
 * Month-grouped grid where every photo has a tick, for choosing which photos go ahead. A click
 * ticks or unticks one photo, Shift+click sets a run of photos to match the last one clicked,
 * and each month has a button to tick or untick all of it. Each photo's magnifier opens it in
 * the viewer, which has its own tick.
 * @param props - Component props.
 * @param props.tiles - photos, newest first
 * @param props.left - ids of the photos left out (everything else is ticked)
 * @param props.onChange - called with the new left-out ids
 * @param props.tileSize - preferred tile edge in CSS pixels
 * @param props.thumbOf - a tile's thumbnail URL
 * @param props.source - the viewer's files, in the same order as `tiles`
 * @param props.tickLabel - what ticking means, for the viewer's tick, e.g. "Import this one"
 * @param props.jump - scroll to this tile and focus it
 * @param props.onThumbError - called when Windows has no thumbnail for a tile
 * @param props.thumbRetry - a count that, when raised, has tiles without a thumbnail ask again
 * @returns the scrolling grid
 */
export function PhotoPicker({
  tiles,
  left,
  onChange,
  tileSize,
  thumbOf,
  source,
  tickLabel,
  jump,
  onThumbError,
  thumbRetry,
}: {
  tiles: Tile[];
  left: ReadonlySet<number>;
  onChange: (left: Set<number>) => void;
  tileSize: number;
  thumbOf?: (tile: Tile) => string;
  source: ViewSource;
  tickLabel: string;
  jump?: TileJump | null;
  onThumbError?: (tile: Tile) => void;
  thumbRetry?: number;
}): ReactElement {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewing(null), []);
  const picked = useMemo(
    () => new Set(tiles.filter((t) => !left.has(t.id)).map((t) => t.id)),
    [tiles, left],
  );

  /**
   * Tick or untick one photo, or with Shift set the run from the anchor to match the anchor.
   * @param index - position of the clicked tile in `tiles`
   * @param event - the click's modifier keys
   */
  function onTileClick(index: number, event: TileEvent): void {
    if (event.shiftKey && anchor !== null && anchor < tiles.length) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      const run = tiles.slice(from, to + 1).map((t) => t.id);
      onChange(setPicked(left, run, picked.has(tiles[anchor].id)));
      return;
    }
    const id = tiles[index].id;
    onChange(setPicked(left, [id], left.has(id)));
    setAnchor(index);
  }

  /**
   * Button in a month heading that ticks the whole month, or unticks it when all are ticked.
   * @param month - the month row the button belongs to
   * @returns the month's tick button
   */
  function monthAction(month: MonthRow): ReactElement {
    const ids = tiles.slice(month.start, month.end).map((t) => t.id);
    const allPicked = ids.every((id) => picked.has(id));
    return (
      // Short on screen so it fits the fixed-height month heading beside the name; the full
      // wording is read out.
      <Button
        variant="ghost"
        className="ml-auto shrink-0 whitespace-nowrap"
        aria-label={allPicked ? `Deselect all of ${month.label}` : `Select all of ${month.label}`}
        onClick={() => onChange(setPicked(left, ids, !allPicked))}
      >
        {allPicked ? "Deselect month" : "Select month"}
      </Button>
    );
  }

  // The tiles can change under an open viewer (a fresh check finds fewer), so it closes rather
  // than show the wrong photo.
  const shown = viewing !== null && viewing < tiles.length ? tiles[viewing] : null;
  return (
    <>
      <TimelineGrid
        tiles={tiles}
        tileSize={tileSize}
        selecting
        selected={picked}
        fadeUnselected
        onTileClick={onTileClick}
        onTileMenu={(_, event) => event.preventDefault()}
        onTileZoom={setViewing}
        onThumbError={onThumbError ?? (() => undefined)}
        thumbRetry={thumbRetry}
        thumbOf={thumbOf}
        monthAction={monthAction}
        jump={jump}
      />
      {shown && viewing !== null && (
        <Viewer
          source={source}
          index={viewing}
          onIndex={setViewing}
          onClose={closeViewer}
          steps={["Newer", "Older"]}
          controls={
            <TickSwitch
              label={tickLabel}
              ticked={picked.has(shown.id)}
              onToggle={() => onChange(setPicked(left, [shown.id], left.has(shown.id)))}
            />
          }
        />
      )}
    </>
  );
}

/**
 * The viewer's tick for the photo on show: a large switch, ticked like its tile.
 * @param props - Component props.
 * @param props.label - what ticking means, shown beside the switch
 * @param props.ticked - whether the photo on show is ticked
 * @param props.onToggle - called to flip the tick
 * @returns the switch
 */
function TickSwitch({
  label,
  ticked,
  onToggle,
}: {
  label: string;
  ticked: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ticked}
      onClick={onToggle}
      className={`flex min-h-12 w-full items-center gap-3 rounded-lg border-2 px-3 py-2 text-left text-[17px] font-semibold ${
        ticked ? "border-accent bg-accent/10" : "border-line hover:bg-raised"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 ${
          ticked ? "border-accent bg-accent text-ground" : "border-ink"
        }`}
      >
        {ticked && <Icon name="check" size={20} />}
      </span>
      {label}
    </button>
  );
}

/**
 * The bar above a {@link PhotoPicker}: how many photos are ticked, what happens to the rest,
 * and buttons to tick or untick everything.
 * @param props - Component props.
 * @param props.ticked - photos still ticked
 * @param props.total - photos in the picker
 * @param props.extra - shown after the count, e.g. the ticked size
 * @param props.hint - what happens to unticked photos
 * @param props.onAll - tick (true) or untick (false) every photo
 * @returns the bar
 */
export function PickBar({
  ticked,
  total,
  extra,
  hint,
  onAll,
}: {
  ticked: number;
  total: number;
  extra?: ReactNode;
  hint: ReactNode;
  onAll: (pick: boolean) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line bg-surface px-5 py-1.5">
      <p className="min-w-0 flex-1 basis-80">
        <strong className="font-semibold">
          {ticked.toLocaleString()} of {count(total, "item", "items")} selected
        </strong>
        {extra && <> {extra}</>}
        <span className="ml-3 text-[14px] text-faint">{hint}</span>
      </p>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" onClick={() => onAll(true)} disabled={ticked === total}>
          Select all
        </Button>
        <Button variant="ghost" onClick={() => onAll(false)} disabled={ticked === 0}>
          Select none
        </Button>
      </div>
    </div>
  );
}
