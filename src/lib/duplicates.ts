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
 * A pick for one set, carried over to its partner sets: those with a copy in one of the same
 * tiles. A copied Live Photo or RAW+JPEG pair makes one set per kind; keeping one tile's photo
 * but the other tile's clip would bin half of each pair, so a partner set keeps the same tile
 * when it has a copy there, and every copy when the chosen set does.
 * @param sets - every duplicate set on the page
 * @param hash - the set the user picked in
 * @param keep - the copy to keep, or null to keep every copy
 * @returns the picks to merge in, for the set and each partner set
 */
export function pickWithPartners(sets: DupSet[], hash: string, keep: number | null): Picks {
  const picks: Picks = { [hash]: keep };
  const chosen = sets.find((s) => s.hash === hash);
  if (!chosen) return picks;
  const tiles = new Set(chosen.copies.map((c) => c.group));
  const keptTile = chosen.copies.find((c) => c.id === keep)?.group;
  for (const set of sets) {
    if (set.hash === hash || !set.copies.some((c) => tiles.has(c.group))) continue;
    if (keep === null) {
      picks[set.hash] = null;
      continue;
    }
    const partner = set.copies.find((c) => c.group === keptTile);
    if (partner) picks[set.hash] = partner.id;
  }
  return picks;
}

/**
 * The picks still worth keeping after the sets are read again: those whose set is still listed
 * and, for a chosen copy, whose copy is still in it. A set that went (binned, or no longer a
 * duplicate) or a copy that left one loses its pick, so a later set never inherits it.
 * @param sets - every duplicate set now listed
 * @param picks - the user's picks
 * @returns the picks that still apply; the same object when none were dropped
 */
export function prunePicks(sets: DupSet[], picks: Picks): Picks {
  const byHash = new Map(sets.map((s) => [s.hash, s]));
  const kept: Picks = {};
  let dropped = false;
  for (const [hash, pick] of Object.entries(picks)) {
    const set = byHash.get(hash);
    if (set && (pick === null || set.copies.some((c) => c.id === pick))) kept[hash] = pick;
    else dropped = true;
  }
  return dropped ? kept : picks;
}
