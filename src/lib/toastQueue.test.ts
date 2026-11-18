import { describe, expect, it } from "vitest";
import type { ApplySummary } from "./api";
import { jobToast, MAX_TOASTS, NO_TOASTS, resultText, toastReducer } from "./toastQueue";

/**
 * A job summary.
 * @param moved - files moved
 * @param failed - files that stayed
 * @param cancelled - stopped partway
 * @returns the summary, batch 7
 */
const summary = (moved: number, failed = 0, cancelled = false): ApplySummary => ({
  batchId: 7,
  moved,
  failed,
  cancelled,
});

describe("resultText", () => {
  it("counts the files and where they went", () => {
    expect(resultText(summary(3), { destination: "the Recycle Bin" })).toEqual({
      text: "Moved 3 files to the Recycle Bin.",
      problem: false,
    });
  });

  it("leaves out a zero count after an intro", () => {
    expect(resultText(summary(0), { intro: "Saved the trip Japan." }).text).toBe(
      "Saved the trip Japan.",
    );
  });

  it("keeps a zero count with no intro", () => {
    expect(resultText(summary(0)).text).toBe("Moved 0 files.");
  });

  it("says how far a stopped job got, in the job's own verb", () => {
    expect(resultText(summary(1, 0, true), { verb: "imported" }).text).toBe(
      "Stopped after importing 1 file.",
    );
  });

  it("names the files that stayed", () => {
    expect(resultText(summary(2, 1), { verb: "copied" })).toEqual({
      text: "Copied 2 files. 1 file couldn't be copied and stayed where it was. History says why.",
      problem: true,
    });
    expect(resultText(summary(0, 2)).text).toContain("stayed where they were");
  });
});

describe("jobToast", () => {
  it("offers Undo only when something moved or the change is undoable anyway", () => {
    expect(jobToast(summary(0), {}).batchId).toBeUndefined();
    expect(jobToast(summary(0), { undoable: true }).batchId).toBe(7);
    expect(jobToast(summary(1), {}).batchId).toBe(7);
  });

  it("links to History on a problem, and to Show once files arrived", () => {
    expect(jobToast(summary(1, 1), { show: "library" }).link).toEqual({
      page: "history",
      label: "History",
    });
    expect(jobToast(summary(1), { show: "library" }).link).toEqual({
      page: "library",
      label: "Show",
    });
    expect(jobToast(summary(0), { show: "library" }).link).toBeUndefined();
  });
});

describe("toastReducer", () => {
  it("gives each toast a new id and keeps only the newest few", () => {
    let state = NO_TOASTS;
    for (let i = 0; i < MAX_TOASTS + 1; i++) {
      state = toastReducer(state, { type: "add", toast: { text: `t${i}` } });
    }
    expect(state.toasts.map((t) => t.text)).toEqual(["t1", "t2", "t3"]);
    expect(state.toasts.map((t) => t.id)).toEqual([2, 3, 4]);
    expect(state.toasts[0]).toMatchObject({ problem: false, batchId: null, link: null });
  });

  it("dismisses one toast, and an undo only its own batch's", () => {
    let state = toastReducer(NO_TOASTS, { type: "add", toast: { text: "a", batchId: 1 } });
    state = toastReducer(state, { type: "add", toast: { text: "b", batchId: 2 } });
    state = toastReducer(state, { type: "add", toast: { text: "c" } });
    state = toastReducer(state, { type: "undone", batchId: 2 });
    expect(state.toasts.map((t) => t.text)).toEqual(["a", "c"]);
    state = toastReducer(state, { type: "dismiss", id: 1 });
    expect(state.toasts.map((t) => t.text)).toEqual(["c"]);
  });

  it("returns the same state when nothing matches", () => {
    const state = toastReducer(NO_TOASTS, { type: "add", toast: { text: "a" } });
    expect(toastReducer(state, { type: "undone", batchId: 9 })).toBe(state);
    expect(toastReducer(state, { type: "dismiss", id: 9 })).toBe(state);
    expect(toastReducer(NO_TOASTS, { type: "clear" })).toBe(NO_TOASTS);
  });

  it("turns a failed undo into a warning without Undo", () => {
    let state = toastReducer(NO_TOASTS, { type: "add", toast: { text: "a", batchId: 1 } });
    state = toastReducer(state, { type: "fail", id: 1, text: "Busy." });
    expect(state.toasts[0]).toMatchObject({ text: "Busy.", problem: true, batchId: null });
  });

  it("clears every toast but keeps counting ids", () => {
    let state = toastReducer(NO_TOASTS, { type: "add", toast: { text: "a" } });
    state = toastReducer(state, { type: "clear" });
    state = toastReducer(state, { type: "add", toast: { text: "b" } });
    expect(state.toasts).toEqual([expect.objectContaining({ id: 2, text: "b" })]);
  });
});
