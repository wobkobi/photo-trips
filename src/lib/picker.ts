// Ticking and unticking photos before they're brought in. The picker tracks what is left out
// rather than what is in, so everything starts ticked and a new photo is never missed.

import type { ImportItem, Tile } from "./api";
import { splitPath } from "./format";

/**
 * Import items as grid tiles, newest first. A tile's id is its item's index, which is what the
 * import is told to leave out.
 * @param items - the preview's items, in plan order
 * @returns tiles for the grid
 */
export function importTiles(items: ImportItem[]): Tile[] {
  return items
    .map((item, index) => ({
      id: index,
      takenAt: item.takenAt,
      kind: item.kind,
      ext: item.ext,
      uncertain: item.uncertain,
      extra: item.extra,
      version: item.version,
      trip: null,
    }))
    .sort((a, b) => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : a.id - b.id));
}

/** How much of an import is still ticked. */
export interface PickTotals {
  /** Photos and videos, each counted with its companions as one. */
  items: number;
  files: number;
  bytes: number;
}

/**
 * Totals for the items still ticked.
 * @param items - the preview's items
 * @param left - indexes of items left out
 * @returns the ticked photos, files and bytes
 */
export function pickTotals(items: ImportItem[], left: ReadonlySet<number>): PickTotals {
  const totals = { items: 0, files: 0, bytes: 0 };
  items.forEach((item, index) => {
    if (left.has(index)) return;
    totals.items += 1;
    totals.files += 1 + item.extra;
    totals.bytes += item.bytes;
  });
  return totals;
}

/**
 * Destination folders of the items still ticked, with how many files each receives. A photo's
 * companions always land in its folder.
 * @param items - the preview's items
 * @param left - indexes of items left out
 * @returns folders relative to the library, sorted by name
 */
export function pickedFolders(
  items: ImportItem[],
  left: ReadonlySet<number>,
): { folder: string; files: number }[] {
  const folders = new Map<string, number>();
  items.forEach((item, index) => {
    if (left.has(index)) return;
    const { folder } = splitPath(item.to);
    folders.set(folder, (folders.get(folder) ?? 0) + 1 + item.extra);
  });
  return [...folders]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([folder, files]) => ({ folder, files }));
}

/**
 * Tick or untick a set of photos together.
 * @param left - ids left out now
 * @param ids - the photos to change
 * @param pick - tick them (true) or leave them out (false)
 * @returns the new left-out ids
 */
export function setPicked(
  left: ReadonlySet<number>,
  ids: Iterable<number>,
  pick: boolean,
): Set<number> {
  const next = new Set(left);
  for (const id of ids) {
    if (pick) next.delete(id);
    else next.add(id);
  }
  return next;
}

/**
 * Where a folder's photos start in the grid: the first tile, newest first, whose photo goes into
 * that folder and is still ticked.
 * @param items - the preview's items
 * @param tiles - the grid's tiles, newest first
 * @param folder - a folder from {@link pickedFolders}
 * @param left - indexes of items left out
 * @returns the tile's index in `tiles`, or -1 when none goes there
 */
export function firstInFolder(
  items: ImportItem[],
  tiles: Tile[],
  folder: string,
  left: ReadonlySet<number>,
): number {
  return tiles.findIndex((tile) => !left.has(tile.id) && splitPath(items[tile.id].to).folder === folder);
}
