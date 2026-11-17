import { useState } from "react";
import { api, errorText, type ApplySummary, type Preview, type TripChange } from "./api";
import { count } from "./format";
import { useJobDone } from "./useJobs";

/** A trip change previewed and waiting for the user to confirm it. */
export interface TripReview {
  preview: Preview;
  /** The confirm button's label. */
  action: string;
  /** First sentence of the result banner once applied. */
  done: string;
}

/** The finished change, for the result banner. */
export interface TripResult {
  summary: ApplySummary;
  done: string;
}

/**
 * Preview a trip change as file moves, apply it once confirmed, and offer to undo it. The apply
 * job's end clears the review and shows the result.
 * @returns the review state and what to do with it
 */
export function useTripReview(): {
  review: TripReview | null;
  result: TripResult | null;
  error: string | null;
  checking: boolean;
  /** The confirmed change is being made. */
  applying: boolean;
  check: (change: TripChange, done: string) => Promise<void>;
  apply: () => Promise<void>;
  undo: () => Promise<void>;
  back: () => void;
} {
  const [review, setReview] = useState<TripReview | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult] = useState<TripResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useJobDone("apply", (job) => {
    if (applying === null) return;
    if (job.ok) setResult({ summary: job.result as ApplySummary, done: applying });
    else if (job.error) setError(job.error);
    setApplying(null);
    setReview(null);
  });
  useJobDone("undo", () => setResult(null));

  /**
   * Preview a change for the user to confirm.
   * @param change - the trip change
   * @param done - what the result banner says once it's made, e.g. "Took 2 photos out of Japan."
   */
  async function check(change: TripChange, done: string): Promise<void> {
    setError(null);
    setResult(null);
    setChecking(true);
    try {
      const preview = await api.planTrip(change);
      const action =
        preview.files > 0 ? `Save and move ${count(preview.files, "file", "files")}` : "Save";
      setReview({ preview, action, done });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  /** Make the change under review; the apply job's end shows the result. */
  async function apply(): Promise<void> {
    if (!review) return;
    setError(null);
    setApplying(review.done);
    try {
      await api.applyPlan(review.preview.id);
    } catch (err) {
      setApplying(null);
      setError(errorText(err));
    }
  }

  /** Undo the change just made. */
  async function undo(): Promise<void> {
    if (!result) return;
    setError(null);
    try {
      await api.undoBatch(result.summary.batchId);
    } catch (err) {
      setError(errorText(err));
    }
  }

  /** Leave the review without making the change. */
  function back(): void {
    setReview(null);
  }

  return {
    review,
    result,
    error,
    checking,
    applying: applying !== null,
    check,
    apply,
    undo,
    back,
  };
}
