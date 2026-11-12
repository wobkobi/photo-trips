// Which copy of each duplicate set stays, and what the rest add up to. The page keeps the
// user's picks by set hash; a set without a valid pick keeps its suggested copy.

import type { DupChoice, DupSet } from "./api";

/** The user's pick per set hash: the copy id to keep, or null to keep every copy. */
export type Picks = Record<string, number | null>;

/**
 * The copy a set keeps. A pick for a copy that's no longer in the set falls back to the
 * suggested keeper.
 * @param set - the duplicate set
 * @param picks - the user's picks
 * @returns the kept copy's id, or null when every copy stays
 */
export function keeperOf(set: DupSet, picks: Picks): number | null {
  const pick = picks[set.hash];
  if (pick === null) return null;
  if (pick !== undefined && set.copies.some((c) => c.id === pick)) return pick;
  return set.copies[0].id;
}

/**
 * Everything the picks send to the Recycle Bin.
 * @param sets - every duplicate set on the page
 * @param picks - the user's picks
 * @returns the choices for the backend, how many copies go and the space they free
 */
export function removalPlan(
  sets: DupSet[],
  picks: Picks,
): { choices: DupChoice[]; copies: number; bytes: number } {
  const choices: DupChoice[] = [];
  let copies = 0;
  let bytes = 0;
  for (const set of sets) {
    const keep = keeperOf(set, picks);
    if (keep === null) continue;
    const remove = set.copies.filter((c) => c.id !== keep).map((c) => c.id);
    choices.push({ keep, remove });
    copies += remove.length;
    bytes += set.size * remove.length;
  }
  return { choices, copies, bytes };
}
