import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import type { PageId } from "../App";
import { Field, INPUT } from "../components/Field";
import { PhotoPicker, PickBar } from "../components/PhotoPicker";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { Button, EmptyState, HOVER_RING, LIST_FILL, PageHeader } from "../components/ui";
import { useLibrarySource } from "../components/viewSources";
import {
  api,
  errorText,
  thumbUrl,
  type ApplySummary,
  type Preview,
  type SampleTile,
  type Tile,
  type TripChange,
  type TripInfo,
  type TripMatches,
} from "../lib/api";
import { tileSizeOf } from "../lib/display";
import { count } from "../lib/format";
import type { FilterTrip } from "../lib/libraryFilter";
import { cleanName, namingOf, tripFolder } from "../lib/naming";
import {
  EMPTY_FORM,
  formFromTrip,
  hasValidRange,
  rangeText,
  spreadPick,
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
  /**
   * The name, dates or ticks have been changed by hand since the editor opened, so stepping back
   * would lose work. Ticks set from the Library's picks don't count.
   */
  changed: boolean;
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
    changed: false,
  };
}

/**
 * The editor for an existing trip, with the photos taken out of it unticked.
 * @param trip - the trip to edit
 * @returns the editor state
 */
function editorOf(trip: TripInfo): Editor {
  return {
    trip,
    form: formFromTrip(trip),
    left: new Set(trip.excluded),
    picked: null,
    changed: false,
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
 * @param props - Component props.
 * @param props.draft - a trip started elsewhere (a Library selection or a suggestion) to open
 * @param props.onDraftUsed - called once the draft has opened in the editor
 * @param props.edit - a trip to open in the editor, from the Library's Edit
 * @param props.onEditUsed - called once that trip has opened in the editor
 * @param props.onNavigate - switch to another page
 * @param props.onShowTrip - open the Library showing only one trip's photos
 * @returns the page
 */
export function TripsPage({
  draft,
  onDraftUsed,
  edit,
  onEditUsed,
  onNavigate,
  onShowTrip,
}: {
  draft: TripStart | null;
  onDraftUsed: () => void;
  edit: TripInfo | null;
  onEditUsed: () => void;
  onNavigate: (page: PageId) => void;
  onShowTrip: (trip: FilterTrip) => void;
}): ReactElement {
  const { running } = useJobs();
  const { settings } = useSettings();
  const [trips, setTrips] = useState<TripInfo[] | null>(null);
  const [editor, setEditor] = useState<Editor | null>(() => {
    if (draft) return newEditor(draft);
    return edit ? editorOf(edit) : null;
  });
  const [review, setReview] = useState<Review | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [result, setResult] = useState<{ summary: ApplySummary; done: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (draft) onDraftUsed();
  }, [draft, onDraftUsed]);
  useEffect(() => {
    if (edit) onEditUsed();
  }, [edit, onEditUsed]);

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

  /**
   * Plan a trip change and show its moves for review before anything changes.
   * @param change - the create, update or delete to plan
   * @param describe - turns the planned moves into the review's wording
   */
  async function preview(
    change: TripChange,
    describe: (preview: Preview) => Review,
  ): Promise<void> {
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

  /**
   * Preview saving the editor's trip, new or changed.
   * @param current - the editor being saved
   * @param excluded - ids of the photos unticked
   */
  function reviewSave(current: Editor, excluded: number[]): void {
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

  /**
   * Preview deleting a trip, which sends its photos back to their month folders.
   * @param trip - the trip to delete
   */
  function reviewDelete(trip: TripInfo): void {
    void preview({ action: "delete", id: trip.id }, (p) => ({
      preview: p,
      note: "Deleting the trip doesn't delete any photos. They go back to their year and month folders.",
      action:
        p.files > 0 ? `Delete trip and move ${count(p.files, "file", "files")}` : "Delete trip",
      danger: true,
      done: `Deleted the trip ${trip.name}.`,
    }));
  }

  /**
   * Apply the reviewed change; the apply job's end shows the result and closes the editor.
   * @param current - the change under review
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
   * Undo the trip change just made, showing any failure as the page error.
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

  const moving = running?.kind === "apply" || running?.kind === "undo";
  const busy = running !== null || checking;
  const listing = !moving && review === null && editor === null;
  // The step on screen: a change under review, else the trip form, else the list of trips.
  const reviewing = !moving && review !== null;
  const editing = !moving && review === null && editor !== null;
  let title = "Trips";
  if (reviewing) title = "Preview";
  else if (editing) title = editor.trip ? `Edit ${editor.trip.name}` : "New trip";
  // Back from a review returns to the form it came from, or the list for a delete. Not once the
  // change is confirmed, while its job is starting.
  const onBack =
    reviewing && applying === null
      ? () => setReview(null)
      : editing
        ? () => setEditor(null)
        : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={title}
        detail={
          listing && trips !== null && trips.length > 0 ? trips.length.toLocaleString() : undefined
        }
        onBack={onBack}
        // A changed form steps back by its arrow only, so a stray Esc can't lose the work.
        backKeys={!(editing && editor.changed)}
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
              <Button
                variant={review.danger ? "danger" : "primary"}
                onClick={() => apply(review)}
                busy={busy}
              >
                {review.action}
              </Button>
            )
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
            Add the dates you were away, and the photos from those days get their own folder, like{" "}
            {tripFolder(namingOf(settings).trips, "2025-03-12", "Japan")}. Or select photos in the
            Library with Make a trip.
          </p>
          <Button variant="primary" onClick={() => setEditor(newEditor(null))}>
            New trip
          </Button>
        </EmptyState>
      )}
      {listing && trips !== null && trips.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4 p-5">
          {trips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              busy={busy}
              onShow={() => onShowTrip({ id: trip.id, name: trip.name })}
              onEdit={() => {
                setResult(null);
                setEditor(editorOf(trip));
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

/**
 * One trip, as an album card. Its cover and name open the Library at the trip's photos.
 * @param props - Component props.
 * @param props.trip - the trip
 * @param props.busy - a job or check is running, so editing waits
 * @param props.onShow - open the Library showing only this trip
 * @param props.onEdit - open the trip in the editor
 * @param props.onDelete - preview deleting the trip
 * @returns the row
 */
function TripRow({
  trip,
  busy,
  onShow,
  onEdit,
  onDelete,
}: {
  trip: TripInfo;
  busy: boolean;
  onShow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <li className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <button
        type="button"
        onClick={onShow}
        aria-label={`See ${trip.name} in the Library`}
        className={`group relative aspect-3/2 w-full overflow-hidden bg-raised focus-visible:outline-offset-[-3px] ${HOVER_RING}`}
      >
        <Cover sample={trip.sample} />
        <span
          aria-hidden="true"
          className={`absolute inset-x-0 bottom-0 h-1 ${tripBg(trip.colour)}`}
        />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 pt-2.5 pb-2">
        <button
          type="button"
          onClick={onShow}
          title="See this trip's photos in the Library"
          className="max-w-full self-start text-left text-[16px] font-semibold wrap-break-word hover:underline hover:underline-offset-4"
        >
          {trip.name}
        </button>
        <p className="text-[13px] text-muted">
          {rangeText(trip.startAt, trip.endAt)} · {count(trip.files, "photo", "photos")}
        </p>
        <p className="selectable truncate text-[13px] text-faint" title={`Trips\\${trip.folder}`}>
          Trips\{trip.folder}
        </p>
        <div className="mt-1 -ml-2 flex flex-wrap gap-1">
          <Button variant="ghost" onClick={onEdit} busy={busy}>
            Edit
          </Button>
          <Button variant="ghost" onClick={onDelete} busy={busy}>
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * A trip card's cover: four of its photos in a square mosaic, or one when it has fewer.
 * @param props - Component props.
 * @param props.sample - photos spread through the trip
 * @returns the cover, or nothing for a trip with no photos
 */
function Cover({ sample }: { sample: SampleTile[] }): ReactElement | null {
  if (sample.length === 0) return null;
  const shown = sample.length >= 4 ? spreadPick(sample, 4) : sample.slice(0, 1);
  return (
    <span
      className={`grid h-full w-full gap-0.5 ${shown.length === 4 ? "grid-cols-2 grid-rows-2" : ""}`}
    >
      {shown.map((tile) => (
        <CoverImage key={tile.id} tile={tile} />
      ))}
    </span>
  );
}

/**
 * One photo in a {@link Cover}, left as an empty tile if it fails to load.
 * @param props - Component props.
 * @param props.tile - the photo
 * @returns the image
 */
function CoverImage({ tile }: { tile: SampleTile }): ReactElement {
  const [failed, setFailed] = useState(false);
  return (
    <span className="block min-h-0 overflow-hidden bg-raised">
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

/**
 * The trip form: name and dates at the top, then every photo from those dates with a tick, so
 * photos that weren't part of the trip can be left out of it.
 * @param props - Component props.
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
}): ReactElement {
  const { settings } = useSettings();
  const { form, trip, left, picked } = editor;
  const matches = useTripMatches(form, trip?.id ?? null);
  const tiles = matches?.tiles ?? NO_TILES;
  const ids = useMemo(() => tiles.map((t) => t.id), [tiles]);
  const source = useLibrarySource(ids);
  const ready =
    form.name.trim() !== "" && hasValidRange(form) && matches !== null && !matches.problem;
  const ticked = tiles.filter((t) => !left.has(t.id)).length;
  /**
   * Setter for one form field, for the inputs' change handlers.
   * @param field - the form field to set
   * @returns a function that stores a new value for that field
   */
  const set =
    (field: keyof TripForm) =>
    (value: string): void =>
      onChange({ ...editor, form: { ...form, [field]: value }, changed: true });
  /**
   * Store new unticked photos; a manual change ends the Library picks' hold on the ticks.
   * @param next - ids of the photos unticked
   */
  const setLeft = (next: ReadonlySet<number>): void => {
    onChange({ ...editor, left: next, picked: null, changed: true });
  };

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

  /**
   * Preview the save with the unticked photos left out, once the form is usable.
   * @param event - the form submit, kept from reloading the page
   */
  function submit(event: FormEvent): void {
    event.preventDefault();
    if (ready && !busy) onReview(tiles.filter((t) => left.has(t.id)).map((t) => t.id));
  }

  return (
    <div className="flex flex-1 flex-col">
      <form onSubmit={submit} className="flex flex-col gap-3 px-5 pt-4 pb-3">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <Field label="Name">
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name")(e.target.value)}
              placeholder="Japan"
              maxLength={80}
              autoFocus
              className={`${INPUT} w-72 max-w-full`}
            />
          </Field>
          <Field label="Starts">
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => set("startDate")(e.target.value)}
              required
              className={INPUT}
            />
          </Field>
          <Field label="Ends">
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => set("endDate")(e.target.value)}
              required
              className={INPUT}
            />
          </Field>
        </div>
        {cleanName(form.name) !== "" && hasValidRange(form) && (
          <p className="text-[14px] text-faint">
            Folder:{" "}
            <span className="selectable break-all">
              {tripFolder(namingOf(settings).trips, form.startDate, form.name, form.endDate)}
            </span>
          </p>
        )}

        <MatchSummary form={form} matches={matches} />

        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" disabled={!ready} busy={busy}>
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
            hint="Deselected ones stay in their month folders."
            onAll={(pick) => setLeft(pick ? NONE_LEFT : new Set(tiles.map((t) => t.id)))}
          />
          <div className={`flex border-t border-line ${LIST_FILL}`}>
            <PhotoPicker
              tiles={tiles}
              left={left}
              onChange={setLeft}
              tileSize={tileSizeOf(settings)}
              source={source}
              tickLabel="Part of this trip"
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the dates take in, when there's no photo grid to show it: why the dates can't be used
 * yet, or that no photos match them.
 * @param props - Component props.
 * @param props.form - the trip form
 * @param props.matches - the photos the dates take in, or null while counting
 * @returns the message, or nothing when the grid shows the photos
 */
function MatchSummary({
  form,
  matches,
}: {
  form: TripForm;
  matches: TripMatches | null;
}): ReactElement | null {
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
  return (
    <p>No photos or videos from these dates yet. Photos added later still go into the trip.</p>
  );
}
