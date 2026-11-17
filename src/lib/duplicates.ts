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

/**
 * A pick for one set, carried over to its partner sets. A copied Live Photo or RAW+JPEG pair
 * makes one set per kind, all over the same tiles; keeping one tile's photo but the other
 * tile's clip would bin half of each pair, so those sets always keep the same tile.
 * @param sets - every duplicate set on the page
 * @param hash - the set the user picked in
 * @param keep - the copy to keep, or null to keep every copy
 * @returns the picks to merge in, for the set and each partner set
 */
export function pickWithPartners(sets: DupSet[], hash: string, keep: number | null): Picks {
  const picks: Picks = { [hash]: keep };
  const chosen = sets.find((s) => s.hash === hash);
  if (!chosen) return picks;
  const tiles = tilesOf(chosen);
  const keptTile = chosen.copies.find((c) => c.id === keep)?.group;
  for (const set of sets) {
    if (set.hash === hash) continue;
    const others = tilesOf(set);
    if (others.size !== tiles.size || [...others].some((t) => !tiles.has(t))) continue;
    picks[set.hash] =
      keep === null ? null : (set.copies.find((c) => c.group === keptTile)?.id ?? null);
  }
  return picks;
}

/**
 * The tiles a set's copies belong to.
 * @param set - a duplicate set
 * @returns the tile ids
 */
function tilesOf(set: DupSet): Set<number> {
  return new Set(set.copies.map((c) => c.group));
}
