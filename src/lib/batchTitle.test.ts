import { describe, expect, it } from "vitest";
import type { BatchInfo } from "./api";
import { titleText } from "./batchTitle";

/**
 * A batch with just the fields the title reads.
 * @param label - the saved label
 * @param status - where the batch stands
 * @param done - files it got through
 * @returns the batch
 */
function batch(label: string, status: BatchInfo["status"], done: number): BatchInfo {
  return { label, status, done } as BatchInfo;
}

describe("titleText", () => {
  it("keeps the label for a batch that did its work", () => {
    expect(titleText(batch("Moved 4 duplicate copies to the Recycle Bin", "done", 4))).toBe(
      "Moved 4 duplicate copies to the Recycle Bin",
    );
  });

  it("keeps the label when a stopped batch moved some files", () => {
    expect(titleText(batch("Moved 4 duplicate copies to the Recycle Bin", "interrupted", 2))).toBe(
      "Moved 4 duplicate copies to the Recycle Bin",
    );
  });

  it("says what a batch set out to do when it stopped before touching a file", () => {
    expect(titleText(batch("Moved 4 duplicate copies to the Recycle Bin", "interrupted", 0))).toBe(
      "Move 4 duplicate copies to the Recycle Bin",
    );
    expect(titleText(batch("Copied 22 files from Apple iPhone", "failed", 0))).toBe(
      "Copy 22 files from Apple iPhone",
    );
    expect(titleText(batch("Changed how folders are named", "cancelled", 0))).toBe(
      "Change how folders are named",
    );
  });

  it("leaves a label with an unknown verb alone", () => {
    expect(titleText(batch("Put back 3 photos", "failed", 0))).toBe("Put back 3 photos");
  });
});
