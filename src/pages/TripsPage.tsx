import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { PageId } from "../App";
import { Field, INPUT } from "../components/Field";
import { Icon } from "../components/Icon";
import { PhotoPicker, PickBar } from "../components/PhotoPicker";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { SampleStrip } from "../components/SampleStrip";
import { Button, EmptyState, PageHeader } from "../components/ui";
import {
  api,
  errorText,
  type ApplySummary,
  type Preview,
  type Tile,
  type TripChange,
  type TripInfo,
  type TripMatches,
} from "../lib/api";
import { tileSizeOf } from "../lib/display";
import { count } from "../lib/format";
import { namingOf, tripFolder } from "../lib/naming";
import {
  EMPTY_FORM,
  formFromTrip,
  hasValidRange,
  rangeText,
  toDraft,
  tripBg,
  type TripForm,
  type TripStart,
} from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";
import { useTripMatches } from "../lib/useTripMatches";

const NONE_LEFT: ReadonlySet<number> = new Set();
const NO_TILES: Tile[] = [];

interface Editor {
  /** The trip being edited, or null for a new one. */
  trip: TripInfo | null;
  form: TripForm;
  /** Ids of the photos unticked, which stay in their month folders. */
  left: ReadonlySet<number>;
  /**
   * Photos picked in the Library, waiting for the dates' photos to load so the rest of those
   * days can start unticked.
   */
  picked: ReadonlySet<number> | null;
}

/**
 * The editor for a new trip.
 * @param start - name, dates and Library picks from elsewhere, or null for a blank trip
 * @returns the editor state
 */
function newEditor(start: TripStart | null): Editor {
  return {
    trip: null,
    form: start?.form ?? EMPTY_FORM,
    left: NONE_LEFT,
    picked: start?.picked ? new Set(start.picked) : null,
  };
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
 * @param props.draft - a trip started elsewhere (a Library selection or a suggestion) to open
 * @param props.onDraftUsed - called once the draft has opened in the editor
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function TripsPage({
  draft,
  onDraftUsed,
  onNavigate,
}: {
  draft: TripStart | null;
  onDraftUsed: () => void;
  onNavigate: (page: PageId) => void;
}) {
  const { running } = useJobs();
  const { settings } = useSettings();
  const [trips, setTrips] = useState<TripInfo[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(() => (draft ? newEditor(draft) : null));
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
  useJobDone(["index", "remove", "import", "inbox"], load);
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

  function reviewSave(current: Editor, excluded: number[]) {
    const draftTrip = { ...toDraft(current.form), excluded };
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
            <span className="text-ink">
              {tripFolder(namingOf(settings).trips, "2025-03-12", "Japan")}
            </span>
            .
          </>
        }
        actions={
          listing ? (
            <Button
              variant="primary"
              onClick={() => {
                setResult(null);
                setEditor(newEditor(null));
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
          onChange={setEditor}
          onReview={(excluded) => reviewSave(editor, excluded)}
          onCancel={() => setEditor(null)}
        />
      )}
      {listing && trips !== null && trips.length === 0 && (
        <EmptyState title="No trips yet">
          <p>
            Add a trip with the dates you were away, and every photo from those days moves into its
            own folder. You can also use Pick photos for a trip in the Library to make one from the
            photos you choose.
          </p>
          <Button variant="primary" onClick={() => setEditor(newEditor(null))}>
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
                setEditor({
                  trip,
                  form: formFromTrip(trip),
                  left: new Set(trip.excluded),
                  picked: null,
                });
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
            <p className="text-[22px] leading-tight font-bold tracking-tight text-brand">
              {trip.name}
            </p>
            <p className="mt-1 flex flex-wrap gap-x-4 text-[15px] text-muted">
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

/**
 * The trip form: name and dates at the top, then every photo from those dates with a tick, so
 * photos that weren't part of the trip can be left out of it.
 * @param props.editor - the trip, form and unticked photos so far
 * @param props.busy - a job or check is running, so the buttons wait
 * @param props.onChange - called with the editor after each change
 * @param props.onReview - preview the save, given the ids of the photos left out
 * @param props.onCancel - close without changes
 * @returns the editor, filling the remaining height
 */
function TripEditor({
  editor,
  busy,
  onChange,
  onReview,
  onCancel,
}: {
  editor: Editor;
  busy: boolean;
  onChange: (editor: Editor) => void;
  onReview: (excluded: number[]) => void;
  onCancel: () => void;
}) {
  const { settings } = useSettings();
  const { form, trip, left, picked } = editor;
  const matches = useTripMatches(form, trip?.id ?? null);
  const tiles = matches?.tiles ?? NO_TILES;
  const ready =
    form.name.trim() !== "" && hasValidRange(form) && matches !== null && !matches.problem;
  const ticked = tiles.filter((t) => !left.has(t.id)).length;
  const set = (field: keyof TripForm) => (value: string) =>
    onChange({ ...editor, form: { ...form, [field]: value } });
  const setLeft = (next: ReadonlySet<number>) => onChange({ ...editor, left: next, picked: null });

  // Photos picked in the Library become the ticked ones once their days have loaded. Later date
  // changes then tick the new days' photos as usual.
  useEffect(() => {
    if (picked === null || matches === null || matches.problem) return;
    onChange({
      ...editor,
      left: new Set(matches.tiles.filter((t) => !picked.has(t.id)).map((t) => t.id)),
      picked: null,
    });
  }, [editor, picked, matches, onChange]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !busy) onReview(tiles.filter((t) => left.has(t.id)).map((t) => t.id));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={submit} className="flex flex-col gap-5 px-8 pt-6 pb-5">
        <h2 className="text-[26px] leading-none font-bold tracking-tight text-brand">
          {trip ? `Edit ${trip.name}` : "New trip"}
        </h2>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="Japan"
              maxLength={80}
              autoFocus
              className={`${INPUT} w-72`}
            />
          </Field>
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
        <p className="-mt-2 max-w-3xl text-[15px] text-muted">
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
      {tiles.length > 0 && !matches?.problem && (
        <>
          <PickBar
            ticked={ticked}
            total={tiles.length}
            hint="Untick any that weren't part of the trip. They stay in their month folders, and you can tick them again by editing the trip."
            onAll={(pick) => setLeft(pick ? NONE_LEFT : new Set(tiles.map((t) => t.id)))}
          />
          <div className="flex min-h-0 flex-1 border-t border-line">
            <PhotoPicker
              tiles={tiles}
              left={left}
              onChange={setLeft}
              tileSize={tileSizeOf(settings)}
            />
          </div>
        </>
      )}
    </div>
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
      <legend className="mb-1.5 text-[15px] font-semibold text-muted">{label}</legend>
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

/**
 * What the dates take in, when there's no photo grid to show it: why the dates can't be used
 * yet, or that no photos match them.
 * @param props.form - the trip form
 * @param props.matches - the photos the dates take in, or null while counting
 * @returns the message, or nothing when the grid shows the photos
 */
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
  if (matches === null) return <p className="text-muted">Finding the photos from these dates</p>;
  if (matches.problem) {
    return (
      <p role="alert" className="text-danger">
        {matches.problem}
      </p>
    );
  }
  if (matches.tiles.length > 0) return null;
  return <p>No photos or videos from these dates yet. Photos added later still go into the trip.</p>;
}
