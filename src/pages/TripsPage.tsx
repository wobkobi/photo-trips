import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { Button, EmptyState, PageHeader } from "../components/ui";
import {
  api,
  errorText,
  thumbUrl,
  type ApplySummary,
  type Preview,
  type SampleTile,
  type TripChange,
  type TripInfo,
  type TripMatches,
} from "../lib/api";
import { count } from "../lib/format";
import {
  EMPTY_FORM,
  formFromTrip,
  hasValidRange,
  rangeText,
  toDraft,
  tripBg,
  type TripForm,
  type TripRange,
} from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";

/** Wait this long after the last keystroke before counting matching photos. */
const MATCH_DELAY_MS = 250;

interface Editor {
  /** The trip being edited, or null for a new one. */
  trip: TripInfo | null;
  form: TripForm;
}

/** A trip change previewed and waiting for the user to confirm it. */
interface Review {
  preview: Preview;
  /** Shown above the plan, e.g. "Deleting the trip doesn't delete any photos." */
  note?: string;
  /** Primary button text. */
  action: string;
  danger: boolean;
  /** First sentence of the result banner once applied. */
  done: string;
}

/**
 * Trips: date ranges whose photos live together in their own folder. Create, edit and delete
 * them, each previewed as file moves before anything changes.
 * @param props.draft - dates picked elsewhere (a Library selection) to start a new trip with
 * @param props.onDraftUsed - called once the draft has opened in the editor
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function TripsPage({
  draft,
  onDraftUsed,
  onNavigate,
}: {
  draft: TripRange | null;
  onDraftUsed: () => void;
  onNavigate: (page: PageId) => void;
}) {
  const { running } = useJobs();
  const [trips, setTrips] = useState<TripInfo[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(() =>
    draft ? { trip: null, form: { ...EMPTY_FORM, ...draft } } : null,
  );
  const [review, setReview] = useState<Review | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: ApplySummary; done: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (draft) onDraftUsed();
  }, [draft, onDraftUsed]);

  const load = useCallback(() => {
    api.listTrips().then(
      (loaded) => {
        setTrips(loaded);
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
  }, []);

  useEffect(load, [load]);
  useJobDone(["index", "remove"], load);
  useJobDone("apply", (done) => {
    if (applying !== null) {
      if (done.ok) setResult({ summary: done.result as ApplySummary, done: applying });
      else if (done.error) setError(done.error);
      setApplying(null);
      setReview(null);
      setEditor(null);
    }
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  async function preview(change: TripChange, describe: (preview: Preview) => Review) {
    setError(null);
    setChecking(true);
    try {
      setReview(describe(await api.planTrip(change)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  function reviewSave(current: Editor) {
    const draftTrip = toDraft(current.form);
    const name = draftTrip.name;
    const change: TripChange = current.trip
      ? { action: "update", id: current.trip.id, draft: draftTrip }
      : { action: "create", draft: draftTrip };
    const verb = current.trip ? "Save changes" : "Save trip";
    void preview(change, (p) => ({
      preview: p,
      action: p.files > 0 ? `${verb} and move ${count(p.files, "file", "files")}` : verb,
      danger: false,
      done: current.trip ? `Saved the changes to ${name}.` : `Saved the trip ${name}.`,
    }));
  }

  function reviewDelete(trip: TripInfo) {
    void preview({ action: "delete", id: trip.id }, (p) => ({
      preview: p,
      note: "Deleting the trip doesn't delete any photos. They go back to their year and month folders.",
      action:
        p.files > 0 ? `Delete trip and move ${count(p.files, "file", "files")}` : "Delete trip",
      danger: true,
      done: `Deleted the trip ${trip.name}.`,
    }));
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

  const moving = running?.kind === "apply" || running?.kind === "undo";
  const busy = running !== null || checking;
  const listing = !moving && review === null && editor === null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Trips"
        detail={
          <>
            Photos taken during a trip live together in its own folder, like{" "}
            <span className="text-paper">Trips\2025-03-12 Japan</span>.
          </>
        }
        actions={
          listing ? (
            <Button
              variant="primary"
              onClick={() => {
                setResult(null);
                setEditor({ trip: null, form: EMPTY_FORM });
              }}
            >
              New trip
            </Button>
          ) : (
            review !== null &&
            !moving && (
              <>
                <Button variant="ghost" onClick={() => setReview(null)} disabled={busy}>
                  <Icon name="back" size={16} />
                  {editor ? "Back to the trip" : "Back"}
                </Button>
                <Button
                  variant={review.danger ? "danger" : "primary"}
                  onClick={() => apply(review)}
                  disabled={busy}
                >
                  {review.action}
                </Button>
              </>
            )
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
      {!moving && review !== null && <PlanView preview={review.preview} note={review.note} />}
      {!moving && review === null && editor !== null && (
        <TripEditor
          editor={editor}
          busy={busy}
          onChange={(form) => setEditor({ ...editor, form })}
          onReview={() => reviewSave(editor)}
          onCancel={() => setEditor(null)}
        />
      )}
      {listing && trips !== null && trips.length === 0 && (
        <EmptyState title="No trips yet">
          <p>
            Add a trip with the dates you were away, and every photo from those days moves into its
            own folder. You can also select photos in the Library and right-click to make a trip
            from them.
          </p>
          <Button variant="primary" onClick={() => setEditor({ trip: null, form: EMPTY_FORM })}>
            New trip
          </Button>
        </EmptyState>
      )}
      {listing && trips !== null && trips.length > 0 && (
        <ul className="flex max-w-4xl flex-col gap-3 px-8 py-6">
          {trips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              busy={busy}
              onEdit={() => {
                setResult(null);
                setEditor({ trip, form: formFromTrip(trip) });
              }}
              onDelete={() => {
                setResult(null);
                reviewDelete(trip);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TripRow({
  trip,
  busy,
  onEdit,
  onDelete,
}: {
  trip: TripInfo;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex overflow-hidden rounded-md border border-line bg-surface">
      <span aria-hidden="true" className={`w-1.5 shrink-0 ${tripBg(trip.colour)}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[22px] leading-tight font-semibold">{trip.name}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 text-[13px] text-muted">
              <span>{rangeText(trip.startAt, trip.endAt)}</span>
              <span>{count(trip.files, "photo or video", "photos and videos")}</span>
              <span className="selectable truncate text-faint">Trips\{trip.folder}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" onClick={onEdit} disabled={busy}>
              Edit
            </Button>
            <Button variant="ghost" onClick={onDelete} disabled={busy}>
              Delete
            </Button>
          </div>
        </div>
        {trip.sample.length > 0 && <SampleStrip sample={trip.sample} />}
      </div>
    </li>
  );
}

function SampleStrip({ sample }: { sample: SampleTile[] }) {
  return (
    <div className="flex gap-1 overflow-hidden">
      {sample.map((tile) => (
        <SampleThumb key={tile.id} tile={tile} />
      ))}
    </div>
  );
}

function SampleThumb({ tile }: { tile: SampleTile }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="h-16 w-16 shrink-0 overflow-hidden rounded-[3px] bg-raised">
      {!failed && (
        <img
          src={thumbUrl(tile.id, tile.version)}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

function TripEditor({
  editor,
  busy,
  onChange,
  onReview,
  onCancel,
}: {
  editor: Editor;
  busy: boolean;
  onChange: (form: TripForm) => void;
  onReview: () => void;
  onCancel: () => void;
}) {
  const { form, trip } = editor;
  const matches = useMatches(form, trip?.id ?? null);
  const ready = form.name.trim() !== "" && hasValidRange(form) && !matches?.problem;
  const set = (field: keyof TripForm) => (value: string) => onChange({ ...form, [field]: value });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !busy) onReview();
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-6 px-8 py-6">
      <h2 className="font-display text-[26px] leading-none font-semibold">
        {trip ? `Edit ${trip.name}` : "New trip"}
      </h2>
      <Field label="Name">
        <input
          type="text"
          value={form.name}
          onChange={(e) => set("name")(e.target.value)}
          placeholder="Japan"
          maxLength={80}
          autoFocus
          className={INPUT}
        />
      </Field>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <DateTime
          label="Starts"
          date={form.startDate}
          time={form.startTime}
          onDate={set("startDate")}
          onTime={set("startTime")}
        />
        <DateTime
          label="Ends"
          date={form.endDate}
          time={form.endTime}
          onDate={set("endDate")}
          onTime={set("endTime")}
        />
      </div>
      <p className="-mt-3 text-[13px] text-muted">
        Leave the times empty to take in whole days. Add them for travel days, when the trip starts
        or ends partway through the day.
      </p>

      <MatchSummary form={form} matches={matches} />

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={!ready || busy}>
          Check the moves
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const INPUT =
  "rounded-md border border-line bg-ground px-3 py-1.5 text-paper placeholder:text-faint focus:border-paper/60 focus:outline-none";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function DateTime({
  label,
  date,
  time,
  onDate,
  onTime,
}: {
  label: string;
  date: string;
  time: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium text-muted">{label}</legend>
      <div className="flex gap-2">
        <input
          type="date"
          aria-label={`${label} on`}
          value={date}
          onChange={(e) => onDate(e.target.value)}
          required
          className={INPUT}
        />
        <input
          type="time"
          aria-label={`${label} at (optional)`}
          value={time}
          onChange={(e) => onTime(e.target.value)}
          className={INPUT}
        />
      </div>
    </fieldset>
  );
}

function MatchSummary({ form, matches }: { form: TripForm; matches: TripMatches | null }) {
  if (!hasValidRange(form)) {
    const backwards = form.startDate !== "" && form.endDate !== "";
    return (
      <p className={backwards ? "text-danger" : "text-muted"}>
        {backwards
          ? "The trip has to end after it starts."
          : "Pick the dates to see which photos it takes in."}
      </p>
    );
  }
  if (matches === null) return <p className="text-muted">Counting photos from these dates</p>;
  if (matches.problem) {
    return (
      <p role="alert" className="text-danger">
        {matches.problem}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p>
        {matches.files === 0
          ? "No photos or videos from these dates yet. Photos added later still go into the trip."
          : `${count(matches.files, "photo or video", "photos and videos")} from these dates.`}
      </p>
      {matches.sample.length > 0 && <SampleStrip sample={matches.sample} />}
    </div>
  );
}

/**
 * Live count of the photos a form's dates take in, refreshed shortly after the dates change.
 * @param form - the trip form
 * @param editing - id of the trip being edited, so its own dates don't count as an overlap
 * @returns the matches, or null while counting or when the dates are incomplete
 */
function useMatches(form: TripForm, editing: number | null): TripMatches | null {
  const [matches, setMatches] = useState<{ key: string; value: TripMatches } | null>(null);
  const valid = hasValidRange(form);
  const { startAt, endAt } = toDraft(form);
  const key = `${startAt}|${endAt}|${editing}`;

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api.tripMatches(startAt, endAt, editing).then(
        (value) => {
          if (live) setMatches({ key, value });
        },
        (err) => {
          if (live) setMatches({ key, value: { files: 0, sample: [], problem: errorText(err) } });
        },
      );
    }, MATCH_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [valid, startAt, endAt, editing, key]);

  return matches?.key === key ? matches.value : null;
}
