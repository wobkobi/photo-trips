import { describe, expect, it } from "vitest";
import type { BatchInfo, BatchStatus } from "./api";
import { newestUndoable } from "./lastUndo";

/**
 * A listed batch with only the fields {@link newestUndoable} reads set.
 * @param id - the batch id, higher for newer
 * @param status - where it stands
 * @param canUndo - whether History offers Undo on it
 * @returns the batch
 */
const batch = (id: number, status: BatchStatus, canUndo: boolean): BatchInfo => ({
  id,
  kind: "organise",
  label: `Batch ${id}`,
  status,
  createdAt: id,
  undoneAt: null,
  total: 1,
  done: canUndo ? 1 : 0,
  failed: 0,
  skipped: 0,
  undone: 0,
  canUndo,
});

describe("newestUndoable", () => {
  it("picks the newest batch that can be undone, whatever the order", () => {
    expect(newestUndoable([batch(3, "done", true), batch(7, "done", true)])).toBe(7);
  });

  it("passes over batches already undone or with nothing to put back", () => {
    expect(
      newestUndoable([
        batch(9, "undone", false),
        batch(8, "failed", false),
        batch(5, "done", true),
      ]),
    ).toBe(5);
  });

  it("offers nothing while the newest batch is still running or being undone", () => {
    expect(newestUndoable([batch(4, "running", false), batch(3, "done", true)])).toBeNull();
    expect(newestUndoable([batch(4, "undoing", false), batch(3, "done", true)])).toBeNull();
  });

  it("offers nothing when no batch can be undone", () => {
    expect(newestUndoable([])).toBeNull();
    expect(newestUndoable([batch(2, "undone", false)])).toBeNull();
  });
});
