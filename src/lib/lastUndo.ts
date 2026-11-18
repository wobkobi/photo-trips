import type { BatchInfo } from "./api";

/** Batches History lists at first, and how many more each "Show older" adds. */
export const BATCH_PAGE = 200;

/**
 * The batch Ctrl+Z offers to undo: the newest one History can undo. A batch still running or
 * being undone blocks it, so the question never lands on an older batch that a finishing job
 * would leave second-newest.
 * @param batches - batches as History lists them, in any order
 * @returns the batch id, or null when there's nothing to undo yet
 */
export function newestUndoable(batches: readonly BatchInfo[]): number | null {
  const newestFirst = [...batches].sort((a, b) => b.id - a.id);
  for (const batch of newestFirst) {
    if (batch.status === "running" || batch.status === "undoing") return null;
    if (batch.canUndo) return batch.id;
  }
  return null;
}
