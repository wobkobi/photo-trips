import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { PageId } from "../App";
import { Field, INPUT } from "../components/Field";
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
import { hasValidRange, rangeText, toDraft, type TripForm } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useTripMatches } from "../lib/useTripMatches";

/** A suggestion whose name or dates are being changed before it becomes a trip. */
interface Editing {
  key: string;
  form: TripForm;
}

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
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function SuggestionsPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { running } = useJobs();
  const [data, setData] = useState<Suggestions | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
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
  useJobDone(["index", "remove", "import"], load);
  useJobDone("apply", (done) => {
    if (applying !== null) {
      if (done.ok) setResult({ summary: done.result as ApplySummary, done: applying });
      else if (done.error) setError(done.error);
      setApplying(null);
      setReview(null);
      setEditing(null);
    }
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  async function reviewCreate(form: TripForm) {
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

  async function apply(current: Review) {
    setError(null);
    setApplying(current.done);
    try {
      await api.applyPlan(current.preview.id);
    } catch (err) {
      setApplying(null);
      setError(errorText(err));
    }
  }

  async function undo(batchId: number) {
    setError(null);
    try {
      await api.undoBatch(batchId);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function dismiss(suggestion: Suggestion) {
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
      if (editing?.key === key) setEditing(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function restore() {
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
        detail="Stretches of busy days, or days away from home, that aren't a trip yet."
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
        <p role="alert" className="mx-8 mt-4 text-danger">
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
          <p className="mt-3 text-[13px]">{howFound(data)}</p>
          {data.dismissed > 0 && (
            <Button onClick={restore} disabled={busy}>
              Show {count(data.dismissed, "dismissed suggestion", "dismissed suggestions")} again
            </Button>
          )}
        </EmptyState>
      )}
      {listing && data !== null && suggestions.length > 0 && (
        <div className="flex max-w-4xl flex-col gap-3 px-8 py-6">
          <p className="max-w-2xl text-[13px] text-muted">{howFound(data)}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {suggestions.map((suggestion) => {
              const key = suggestionKey(suggestion);
              return editing?.key === key ? (
                <SuggestionEditor
                  key={key}
                  form={editing.form}
                  busy={busy}
                  onChange={(form) => setEditing({ key, form })}
                  onCreate={() => reviewCreate(editing.form)}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <SuggestionCard
                  key={key}
                  suggestion={suggestion}
                  busy={busy}
                  onCreate={() => reviewCreate(formFromSuggestion(suggestion))}
                  onChange={() => {
                    setResult(null);
                    setEditing({ key, form: formFromSuggestion(suggestion) });
                  }}
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
 * @param props.suggestion - the suggestion
 * @param props.busy - a job or check is running, so the buttons wait
 * @param props.onCreate - preview it as a trip as it is
 * @param props.onChange - open it for changing the name or dates first
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
}) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-dashed border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[22px] leading-tight font-semibold">{suggestion.name}</p>
          <p className="mt-1 text-[13px] text-muted">
            {/* A name made from the dates already says them. */}
            {suggestion.namedByPlace && (
              <span className="mr-4">{rangeText(suggestion.startDay, suggestion.endDay)}</span>
            )}
            {reasonText(suggestion)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={onDismiss} disabled={busy}>
            Not a trip
          </Button>
          <Button variant="ghost" onClick={onChange} disabled={busy}>
            Change
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

/**
 * A suggestion opened for changes: its name and days, with a live count of the photos the
 * new days take in.
 * @param props.form - the name and dates so far
 * @param props.busy - a job or check is running, so the buttons wait
 * @param props.onChange - called with the form after each edit
 * @param props.onCreate - preview the trip as changed
 * @param props.onCancel - close without changes
 * @returns the list item
 */
function SuggestionEditor({
  form,
  busy,
  onChange,
  onCreate,
  onCancel,
}: {
  form: TripForm;
  busy: boolean;
  onChange: (form: TripForm) => void;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const matches = useTripMatches(form, null);
  const valid = hasValidRange(form);
  const ready = form.name.trim() !== "" && valid && matches !== null && !matches.problem;
  const set = (field: keyof TripForm) => (value: string) => onChange({ ...form, [field]: value });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !busy) onCreate();
  }

  return (
    <li className="rounded-md border border-dashed border-paper/40 bg-surface">
      <form onSubmit={submit} className="flex flex-col gap-4 p-4">
        <Field label="Name">
          <input
            type="text"
            value={form.name}
            onChange={(e) => set("name")(e.target.value)}
            maxLength={80}
            autoFocus
            className={`${INPUT} max-w-md`}
          />
        </Field>
        <div className="flex flex-wrap gap-x-6 gap-y-4">
          <Field label="First day">
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate")(e.target.value)}
              required
              className={INPUT}
            />
          </Field>
          <Field label="Last day">
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate")(e.target.value)}
              required
              className={INPUT}
            />
          </Field>
        </div>

        {!form.startDate || !form.endDate ? (
          <p className="text-muted">Pick the first and last day.</p>
        ) : !valid ? (
          <p className="text-danger">The last day can't be before the first.</p>
        ) : matches === null ? (
          <p className="text-muted">Counting photos from these days</p>
        ) : matches.problem ? (
          <p role="alert" className="text-danger">
            {matches.problem}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p>
              {matches.files === 0
                ? "No photos or videos from these days."
                : `${count(matches.files, "photo or video", "photos and videos")} from these days.`}
            </p>
            {matches.sample.length > 0 && <SampleStrip sample={matches.sample} />}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!ready || busy}>
            Create trip
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </li>
  );
}
