import { useMemo, useState } from "react";
import type { Tile } from "../lib/api";
import { setPicked } from "../lib/picker";
import { TimelineGrid, type MonthRow, type TileEvent } from "./TimelineGrid";
import { Button } from "./ui";

/**
 * Month-grouped grid where every photo has a tick, for choosing which photos go ahead. A click
 * ticks or unticks one photo, Shift+click sets a run of photos to match the last one clicked,
 * and each month has a button to tick or untick all of it.
 * @param props.tiles - photos, newest first
 * @param props.left - ids of the photos left out (everything else is ticked)
 * @param props.onChange - called with the new left-out ids
 * @param props.tileSize - preferred tile edge in CSS pixels
 * @param props.thumbOf - a tile's thumbnail URL
 * @returns the scrolling grid
 */
export function PhotoPicker({
  tiles,
  left,
  onChange,
  tileSize,
  thumbOf,
}: {
  tiles: Tile[];
  left: ReadonlySet<number>;
  onChange: (left: Set<number>) => void;
  tileSize: number;
  thumbOf?: (tile: Tile) => string;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const picked = useMemo(
    () => new Set(tiles.filter((t) => !left.has(t.id)).map((t) => t.id)),
    [tiles, left],
  );

  function onTileClick(index: number, event: TileEvent) {
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

  function monthAction(month: MonthRow) {
    const ids = tiles.slice(month.start, month.end).map((t) => t.id);
    const allPicked = ids.every((id) => picked.has(id));
    return (
      <Button
        variant="ghost"
        className="ml-auto"
        onClick={() => onChange(setPicked(left, ids, !allPicked))}
      >
        {allPicked ? `Untick all of ${month.label}` : `Tick all of ${month.label}`}
      </Button>
    );
  }

  return (
    <TimelineGrid
      tiles={tiles}
      tileSize={tileSize}
      selecting
      selected={picked}
      fadeUnselected
      onTileClick={onTileClick}
      onTileMenu={(_, event) => event.preventDefault()}
      onThumbError={() => undefined}
      thumbOf={thumbOf}
      monthAction={monthAction}
    />
  );
}
