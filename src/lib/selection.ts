// Range and run selection for the library grid: Shift extends from an anchor tile, and a month
// heading picks or drops the whole month at once.

/**
 * The tile a Shift range starts from: the anchor when it is still shown, else the tile focus was
 * on, else none.
 * @param anchor - the anchor's index in the shown tiles, or undefined when there is none or it
 *   is filtered out
 * @param focused - the index of the tile last focused in the grid, or null
 * @param length - how many tiles are shown
 * @returns the index to range from, or null when there is nothing to range from
 */
export function rangeStart(
  anchor: number | undefined,
  focused: number | null,
  length: number,
): number | null {
  if (anchor !== undefined && anchor >= 0 && anchor < length) return anchor;
  if (focused !== null && focused >= 0 && focused < length) return focused;
  return null;
}

/**
 * The selection after a Shift range: every id from `from` to `to` in either direction, plus the
 * ids in `keep` (the selection so far, when Ctrl is held too).
 * @param order - ids in the order shown
 * @param from - index of one end of the range
 * @param to - index of the other end
 * @param keep - ids to keep selected besides the range
 * @returns the new selection
 */
export function selectRange(
  order: readonly number[],
  from: number,
  to: number,
  keep: Iterable<number> = [],
): Set<number> {
  const next = new Set(keep);
  const [low, high] = from < to ? [from, to] : [to, from];
  for (let i = Math.max(low, 0); i <= Math.min(high, order.length - 1); i += 1) next.add(order[i]);
  return next;
}

/**
 * Pick a run of ids (a month), or drop it when every one is picked already.
 * @param selected - ids selected now
 * @param run - the ids in the run
 * @returns the new selection
 */
export function toggleRun(selected: ReadonlySet<number>, run: readonly number[]): Set<number> {
  const next = new Set(selected);
  const drop = run.length > 0 && run.every((id) => selected.has(id));
  for (const id of run) {
    if (drop) next.delete(id);
    else next.add(id);
  }
  return next;
}
