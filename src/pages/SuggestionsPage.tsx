import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { SampleStrip } from "../components/SampleStrip";
import { Button, EmptyState, PageHeader } from "../components/ui";
import {
  api,
  errorText,
  type ApplySummary,
  type Preview,
  type Suggestion,
  type Suggestions,
} from "../lib/api";
import { count } from "../lib/format";
import { formFromSuggestion, howFound, reasonText, suggestionKey } from "../lib/suggestions";
import { rangeText, toDraft, type TripForm, type TripStart } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";

/** A new trip previewed and waiting for the user to confirm it. */
interface Review {
  preview: Preview;
  action: string;
  /** First sentence of the result banner once applied. */
  done: string;
}

/**
 * Suggestions: stretches of busy days, or days away from home, that aren't a trip yet. Each
 * can become a trip, previewed as file moves first like any other, or be dismissed.
 * @param props - Component props.
 * @param props.onNavigate - switch to another page
 * @param props.onCreateTrip - open a suggestion in the trip editor, to change it or untick photos
 * @returns the page
 */
export function SuggestionsPage({
  onNavigate,
  onCreateTrip,
}: {
  onNavigate: (page: PageId) => void;
  onCreateTrip: (start: TripStart) => void;
}): ReactElement {
  const { running } = useJobs();
  const [data, setData] = useState<Suggestions | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: ApplySummary; done: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Loads can overlap (a job finishing while the user restores dismissed ones). Only the
  // latest one's answer is kept.
  const loads = useRef(0);

  const load = useCallback(() => {
    const ticket = ++loads.current;
    api.suggestTrips().then(
      (loaded) => {
        if (ticket !== loads.current) return;
        setData(loaded);
        setError(null);
      },
      (err) => {
        if (ticket === loads.current) setError(errorText(err));
      },
    );
  }, []);

  useEffect(load, [load]);
  useJobDone(["index", "remove", "import", "inbox"], load);
  useJobDone("apply", (done) => {
    if (applying !== null) {
      if (done.ok) setResult({ summary: done.result as ApplySummary, done: applying });
      else if (done.error) setError(done.error);
      setApplying(null);
      setReview(null);
    }
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  /**
   * Plan a suggestion as a new trip and show the moves for review before anything changes.
   * @param form - the trip the suggestion fills in
   */
  async function reviewCreate(form: TripForm): Promise<void> {
    const draft = toDraft(form);
    setError(null);
    setResult(null);
    setChecking(true);
    try {
      const preview = await api.planTrip({ action: "create", draft });
      setReview({
        preview,
        action:
          preview.files > 0
            ? `Save trip and move ${count(preview.files, "file", "files")}`
            : "Save trip",
        done: `Saved the trip ${draft.name}.`,
      });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  /**
   * Save the reviewed trip and start its moves; the apply job's end shows the result.
   * @param current - the trip under review
   */
  async function apply(current: Review): Promise<void> {
    setError(null);
    setApplying(current.done);
    try {
      await api.applyPlan(current.preview.id);
    } catch (err) {
      setApplying(null);
      setError(errorText(err));
    }
  }

  /**
   * Undo the trip just made, showing any failure as the page error.
   * @param batchId - the batch to undo
   */
  async function undo(batchId: number): Promise<void> {
    setError(null);
    try {
      await api.undoBatch(batchId);
    } catch (err) {
      setError(errorText(err));
    }
  }

  /**
   * Stop suggesting a suggestion's days, dropping it from the list without a reload.
   * @param suggestion - the suggestion turned down
   */
  async function dismiss(suggestion: Suggestion): Promise<void> {
    setError(null);
    setResult(null);
    const key = suggestionKey(suggestion);
    try {
      await api.dismissSuggestion(suggestion.startDay, suggestion.endDay);
      setData((current) =>
        current
          ? {
              ...current,
              suggestions: current.suggestions.filter((s) => suggestionKey(s) !== key),
              dismissed: current.dismissed + 1,
            }
          : current,
      );
    } catch (err) {
      setError(errorText(err));
    }
  }

  /** Bring every dismissed suggestion back and reload the list. */
  async function restore(): Promise<void> {
    setError(null);
    try {
      await api.restoreDismissed();
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const moving = running?.kind === "apply" || running?.kind === "undo";
  const busy = running !== null || checking;
  const listing = !moving && review === null;
  const suggestions = data?.suggestions ?? [];

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Suggestions"
        actions={
          review !== null &&
          !moving && (
            <>
              <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>
                <Icon name="back" size={16} />
                Back
              </Button>
              <Button variant="primary" onClick={() => apply(review)} disabled={busy}>
                {review.action}
              </Button>
            </>
          )
        }
      />
      {error && (
        <p role="alert" className="mx-5 mt-3 text-danger">
          {error}
        </p>
      )}
      {result && listing && (
        <ResultBanner
          result={result.summary}
          intro={result.done}
          undoable
          busy={running !== null}
          onUndo={() => undo(result.summary.batchId)}
          onHistory={() => onNavigate("history")}
        />
      )}

      {moving && running && <MovingProgress job={running} />}
      {!moving && review !== null && <PlanView preview={review.preview} />}
      {listing && data === null && !error && (
        <p className="px-8 py-6 text-muted">Looking for trips in the library</p>
      )}
      {listing && data !== null && suggestions.length === 0 && (
        <EmptyState title="No trips to suggest">
          <p>
            {data.dismissed > 0
              ? "Every stretch of busy days is already a trip or has been dismissed."
              : "Every stretch of busy days is already a trip, or there aren't any yet."}{" "}
            New suggestions show up here as photos come in.
          </p>
          <p className="mt-3 text-[15px]">{howFound(data)}</p>
          {data.dismissed > 0 && (
            <Button onClick={restore} disabled={busy}>
              Show {count(data.dismissed, "dismissed suggestion", "dismissed suggestions")} again
            </Button>
          )}
        </EmptyState>
      )}
      {listing && data !== null && suggestions.length > 0 && (
        <div className="flex max-w-6xl flex-col gap-3 px-8 py-6">
          <p className="max-w-2xl text-[15px] text-muted">{howFound(data)}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const key = suggestionKey(suggestion);
              return (
                <SuggestionCard
                  key={key}
                  suggestion={suggestion}
                  busy={busy}
                  onCreate={() => reviewCreate(formFromSuggestion(suggestion))}
                  onChange={() =>
                    onCreateTrip({ form: formFromSuggestion(suggestion), picked: null })
                  }
                  onDismiss={() => dismiss(suggestion)}
                />
              );
            })}
          </ul>
          {data.dismissed > 0 && (
            <div>
              <Button variant="ghost" onClick={restore} disabled={busy}>
                Show {count(data.dismissed, "dismissed suggestion", "dismissed suggestions")} again
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One suggestion, with its reason and sample photos. The dashed edge marks it as not yet a trip.
 * @param props - Component props.
 * @param props.suggestion - the suggestion
 * @param props.busy - a job or check is running, so the buttons wait
 * @param props.onCreate - preview it as a trip as it is
 * @param props.onChange - open it in the trip editor, to change the name or dates or untick
 *   photos first
 * @param props.onDismiss - stop suggesting these days
 * @returns the list item
 */
function SuggestionCard({
  suggestion,
  busy,
  onCreate,
  onChange,
  onDismiss,
}: {
  suggestion: Suggestion;
  busy: boolean;
  onCreate: () => void;
  onChange: () => void;
  onDismiss: () => void;
}): ReactElement {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-dashed border-line bg-surface p-4">
      {/* The buttons drop under the words when both can't share a line, rather than squeezing the
          words into a narrow column. */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <p className="text-[17px] leading-tight font-semibold">{suggestion.name}</p>
          <p className="mt-1 text-[15px] text-muted">
            {/* A name made from the dates already says them. */}
            {suggestion.namedByPlace && (
              <span className="mr-4">{rangeText(suggestion.startDay, suggestion.endDay)}</span>
            )}
            {reasonText(suggestion)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" onClick={onDismiss} disabled={busy}>
            Not a trip
          </Button>
          <Button variant="ghost" onClick={onChange} disabled={busy}>
            Change or pick photos
          </Button>
          <Button variant="primary" onClick={onCreate} disabled={busy}>
            Create trip
          </Button>
        </div>
      </div>
      {suggestion.sample.length > 0 && <SampleStrip sample={suggestion.sample} />}
    </li>
  );
}
