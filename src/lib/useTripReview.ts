import { useState } from "react";
import { api, errorText, type Preview, type TripChange } from "./api";
import { count } from "./format";
import { useJobDone } from "./useJobs";
import { useToasts } from "./useToasts";

/** A trip change previewed and waiting for the user to confirm it. */
export interface TripReview {
  preview: Preview;
  /** The confirm button's label. */
  action: string;
  /** First sentence of the result toast once applied. */
  done: string;
}

/**
 * Preview a trip change as file moves and apply it once confirmed. The apply job's end clears
 * the review; its result and Undo show as a toast, so they outlast the page.
 * @returns the review state and what to do with it
 */
export function useTripReview(): {
  review: TripReview | null;
  error: string | null;
  checking: boolean;
  /** The confirmed change is being made. */
  applying: boolean;
  check: (change: TripChange, done: string) => Promise<void>;
  apply: () => Promise<void>;
  back: () => void;
} {
  const { expectJob } = useToasts();
  const [review, setReview] = useState<TripReview | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useJobDone("apply", (job) => {
    if (!applying) return;
    if (!job.ok && job.error) setError(job.error);
    setApplying(false);
    setReview(null);
  });

  /**
   * Preview a change for the user to confirm.
   * @param change - the trip change
   * @param done - what the result toast says once it's made, e.g. "Took 2 photos out of Japan."
   */
  async function check(change: TripChange, done: string): Promise<void> {
    setError(null);
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
    setApplying(true);
    const forget = expectJob("apply", { intro: review.done, undoable: true });
    try {
      await api.applyPlan(review.preview.id);
    } catch (err) {
      forget();
      setApplying(false);
      setError(errorText(err));
    }
  }

  /** Leave the review without making the change. */
  function back(): void {
    setReview(null);
  }

  return { review, error, checking, applying, check, apply, back };
}
