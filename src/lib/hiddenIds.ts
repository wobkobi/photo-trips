// Photos hidden from the library while a Recycle Bin job sends them away. Each job's photos are
// shown again (or dropped for good) by the first load after that job ends, without touching the
// photos of a later job that is still running.

/** No photos hidden. */
export const NONE: ReadonlySet<number> = new Set();

/**
 * Some ids added to a set, as a new set.
 * @param set - the ids now
 * @param ids - the ids to add
 * @returns the set with them added
 */
export function withIds(set: ReadonlySet<number>, ids: Iterable<number>): ReadonlySet<number> {
  return new Set([...set, ...ids]);
}

/**
 * Some ids taken out of a set. The set itself comes back when none of them were in it, and
 * {@link NONE} when nothing is left, so a store holding it doesn't redraw for no change.
 * @param set - the ids now
 * @param ids - the ids to take out
 * @returns the set without them
 */
export function withoutIds(set: ReadonlySet<number>, ids: Iterable<number>): ReadonlySet<number> {
  let next: Set<number> | null = null;
  for (const id of ids) {
    if (!set.has(id)) continue;
    next ??= new Set(set);
    next.delete(id);
  }
  if (next === null) return set;
  return next.size === 0 ? NONE : next;
}
