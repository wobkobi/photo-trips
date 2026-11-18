// The words for a finished change and the queue of toasts that report them. Pure, so the
// sentences and the queue's rules are tested without React.

import type { PageId } from "../App";
import type { ApplySummary } from "./api";
import { count } from "./format";

/** Sentence-start, "-ing" and plain forms of what happened to the files. */
export const VERBS = {
  moved: ["Moved", "moving", "moved"],
  copied: ["Copied", "copying", "copied"],
  imported: ["Imported", "importing", "imported"],
} as const;

export type Verb = keyof typeof VERBS;

/** How a page wants a finished job's result worded and what it offers. */
export interface ResultWords {
  /** Sentence before the move count, e.g. "Saved the trip Japan." */
  intro?: string;
  /** Where the files went, when that isn't a folder, e.g. "the Recycle Bin". */
  destination?: string;
  /** What happened to the files (default moved). */
  verb?: Verb;
}

/**
 * The sentence for an applied change: the intro, how many files went where (or how far it got
 * before being stopped), and how many couldn't be moved. With an intro and nothing moved, the
 * count is left out, since "Moved 0 files." adds nothing to "Saved the trip Japan."
 * @param result - what the job reported
 * @param words - the intro, destination and verb
 * @returns the text, and whether some files failed
 */
export function resultText(
  result: ApplySummary,
  words: ResultWords = {},
): { text: string; problem: boolean } {
  const { intro, destination, verb = "moved" } = words;
  const [past, ing, plain] = VERBS[verb];
  const moved = count(result.moved, "file", "files") + (destination ? ` to ${destination}` : "");
  let movedText = "";
  if (result.cancelled) movedText = `Stopped after ${ing} ${moved}.`;
  else if (result.moved > 0 || !intro) movedText = `${past} ${moved}.`;
  const problem = result.failed > 0;
  const parts = [intro, movedText];
  if (problem) {
    parts.push(
      `${count(result.failed, "file", "files")} couldn't be ${plain} and stayed where ${
        result.failed === 1 ? "it was" : "they were"
      }. History says why.`,
    );
  }
  return { text: parts.filter(Boolean).join(" "), problem };
}

/** A page to open from a toast, and the button's label. */
export interface ToastLink {
  page: PageId;
  label: string;
}

/** What a toast says and offers, before the queue gives it an id. */
export interface ToastInput {
  text: string;
  /** Some files failed: drawn as a warning, and kept until dismissed rather than fading. */
  problem?: boolean;
  /** The History batch its Undo puts back; no Undo when absent. */
  batchId?: number;
  link?: ToastLink;
}

export interface Toast extends Required<Pick<ToastInput, "text" | "problem">> {
  id: number;
  batchId: number | null;
  link: ToastLink | null;
}

/** A page's wishes for the toast of a job it is about to start. */
export interface JobToast extends ResultWords {
  /** Offer Undo even when no file moved (a trip change still can be undone). */
  undoable?: boolean;
  /** Where the files can be seen once they arrive, for a Show button. */
  show?: PageId;
}

/**
 * The toast for a finished job. A problem links to History, which says why; otherwise Show
 * appears once files have arrived somewhere to show.
 * @param result - what the job reported
 * @param wishes - the page's wording and offers
 * @returns the toast to queue
 */
export function jobToast(result: ApplySummary, wishes: JobToast): ToastInput {
  const { text, problem } = resultText(result, wishes);
  let link: ToastLink | undefined;
  if (problem) link = { page: "history", label: "History" };
  else if (wishes.show && result.moved > 0) link = { page: wishes.show, label: "Show" };
  return {
    text,
    problem,
    batchId: result.moved > 0 || wishes.undoable ? result.batchId : undefined,
    link,
  };
}

/** Toasts on screen at once; a new one pushes out the oldest. */
export const MAX_TOASTS = 3;

export interface ToastState {
  /** Oldest first. */
  toasts: Toast[];
  /** The id the next toast gets; ids are never reused. */
  next: number;
}

export const NO_TOASTS: ToastState = { toasts: [], next: 1 };

export type ToastAction =
  | { type: "add"; toast: ToastInput }
  | { type: "dismiss"; id: number }
  /** The batch was undone, from the toast or History: its toast has nothing left to offer. */
  | { type: "undone"; batchId: number }
  /** Undo couldn't start: the toast says why and no longer offers it. */
  | { type: "fail"; id: number; text: string }
  | { type: "clear" };

/**
 * The toast queue's rules.
 * @param state - the queue
 * @param action - what happened
 * @returns the new queue
 */
export function toastReducer(state: ToastState, action: ToastAction): ToastState {
  switch (action.type) {
    case "add": {
      const { text, problem = false, batchId, link } = action.toast;
      const toast: Toast = {
        id: state.next,
        text,
        problem,
        batchId: batchId ?? null,
        link: link ?? null,
      };
      return { toasts: [...state.toasts, toast].slice(-MAX_TOASTS), next: state.next + 1 };
    }
    case "dismiss":
      return remove(state, (t) => t.id === action.id);
    case "undone":
      return remove(state, (t) => t.batchId === action.batchId);
    case "fail":
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.id ? { ...t, text: action.text, problem: true, batchId: null } : t,
        ),
      };
    case "clear":
      return state.toasts.length === 0 ? state : { ...state, toasts: [] };
  }
}

/**
 * The queue without the toasts that match, or the same queue when none do.
 * @param state - the queue
 * @param match - picks the toasts to drop
 * @returns the new queue
 */
function remove(state: ToastState, match: (toast: Toast) => boolean): ToastState {
  const kept = state.toasts.filter((t) => !match(t));
  return kept.length === state.toasts.length ? state : { ...state, toasts: kept };
}
