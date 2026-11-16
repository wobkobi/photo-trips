import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { CodecHint } from "../components/CodecHint";
import { Icon } from "../components/Icon";
import { LibraryFilterBar } from "../components/LibraryFilterBar";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { TileMenu, type MenuItem } from "../components/TileMenu";
import { TimelineGrid, type TileEvent } from "../components/TimelineGrid";
import { Viewer } from "../components/Viewer";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useLibrarySource } from "../components/viewSources";
import { api, errorText, type IndexSummary, type Tile, type TripInfo } from "../lib/api";
import { tileSizeOf } from "../lib/display";
import { count as countOf } from "../lib/format";
import { filterTiles, isFiltered, NO_FILTER, type LibraryFilter } from "../lib/libraryFilter";
import {
  addEdit,
  editDone,
  editLabel,
  nearestTrips,
  pickedEdits,
  type TripEdit,
} from "../lib/tripEdits";
import { EMPTY_FORM, rangeOfTiles, type TripStart } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";
import { useTripReview } from "../lib/useTripReview";

/** How many nearby trips the menus offer to add photos to. */
const ADD_CHOICES = 4;

/**
 * The whole library as a month-by-month timeline, with a viewer for single photos.
 * "Pick photos for a trip" turns clicks into picking, so the photos to make a trip from can be
 * chosen without knowing any shortcuts; Ctrl-click, Shift-click and right-click pick too.
 * @param props - Component props.
 * @param props.filter - which photos to show; kept by the app so the Trips page can open the
 *   Library at one trip
 * @param props.onFilter - called with a new filter
 * @param props.onCreateTrip - start a new trip over the picked photos' days, with only those
 *   photos ticked
 * @param props.onImport - open the Import page
 * @param props.onNavigate - switch to another page, for History from the result banner
 * @param props.refreshRequested - File > Look for new photos (F5) was picked; refresh on opening
 * @param props.onRefreshStarted - called once that refresh has been asked for
 * @returns the page
 */
export function LibraryPage({
  filter,
  onFilter,
  onCreateTrip,
  onImport,
  onNavigate,
  refreshRequested,
  onRefreshStarted,
}: {
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  onCreateTrip: (start: TripStart) => void;
  onImport: () => void;
  onNavigate: (page: PageId) => void;
  refreshRequested: boolean;
  onRefreshStarted: () => void;
}): ReactElement {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const [allTiles, setTiles] = useState<Tile[] | null>(null);
  const tiles = useMemo(() => allTiles && filterTiles(allTiles, filter), [allTiles, filter]);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Tile[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // Picking was turned on with the button, so plain clicks pick even before anything is picked.
  const [picking, setPicking] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [trips, setTrips] = useState<TripInfo[]>([]);
  const tripReview = useTripReview();

  const load = useCallback(() => {
    api.libraryTiles().then(
      (loaded) => {
        setTiles(loaded);
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
    api.listTrips().then(setTrips, (err) => setError(errorText(err)));
  }, []);

  useEffect(load, [load]);
  useJobDone("index", (done) => {
    if (done.ok) setSummary(done.result as IndexSummary);
    load();
  });
  useJobDone(["apply", "undo", "remove", "import", "inbox"], load);

  const onThumbError = useCallback(
    (tile: Tile) => setFailedThumbs((prev) => (prev.length >= 50 ? prev : [...prev, tile])),
    [],
  );
  const closeViewer = useCallback(() => setOpen(null), []);
  const ids = useMemo(() => tiles?.map((t) => t.id) ?? [], [tiles]);
  const source = useLibrarySource(ids);
  const clearSelection = useCallback(() => {
    setPicking(false);
    setSelected(new Set());
    setAnchor(null);
    setMenu(null);
  }, []);

  /** Re-read the library folder for new and changed files. */
  function refresh(): void {
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }

  useEffect(() => {
    if (!refreshRequested) return;
    onRefreshStarted();
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }, [refreshRequested, onRefreshStarted]);

  const selecting = picking || selected.size > 0;
  const picked = useMemo(
    () => (allTiles ?? []).filter((t) => selected.has(t.id)),
    [allTiles, selected],
  );
  const edits = useMemo(
    () => pickedEdits(picked, trips, allTiles ?? []),
    [picked, trips, allTiles],
  );
  const addChoices = useMemo(
    () => nearestTrips(edits.free, trips, ADD_CHOICES),
    [edits.free, trips],
  );

  useEffect(() => {
    if (!selecting) return;
    /**
     * Escape stops picking.
     * @param event - the key pressed
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clearSelection]);

  /**
   * Explorer-style selection: Ctrl toggles, Shift extends from the last clicked tile, and a
   * plain click toggles while picking or while anything is picked. Otherwise a plain click
   * opens the viewer.
   * @param index - position of the clicked tile in the shown list
   * @param event - the click, for its modifier keys
   */
  function onTileClick(index: number, event: TileEvent): void {
    if (!tiles) return;
    const id = tiles[index].id;
    if (event.shiftKey && anchor !== null) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      const next = new Set(event.ctrlKey ? selected : []);
      for (let i = from; i <= to; i += 1) next.add(tiles[i].id);
      setSelected(next);
      return;
    }
    if (event.ctrlKey || event.metaKey || selecting) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
      setAnchor(index);
      return;
    }
    setOpen(index);
  }

  /**
   * Right-click opens the trip menu, picking the tile first unless it's already picked.
   * @param index - position of the tile in the shown list
   * @param event - the right-click, for where to open the menu
   */
  function onTileMenu(index: number, event: TileEvent): void {
    if (!tiles) return;
    event.preventDefault();
    const id = tiles[index].id;
    // The menu acts on the pick as it will be, so work its choices out from that pick.
    const pick = selected.has(id) ? picked : [tiles[index]];
    if (!selected.has(id)) {
      setSelected(new Set([id]));
      setAnchor(index);
    }
    const found = pickedEdits(pick, trips, allTiles ?? []);
    const adds = nearestTrips(found.free, trips, ADD_CHOICES).map((trip) =>
      addEdit(trip, found.free, allTiles ?? []),
    );
    const items = [...found.remove, ...found.putBack, ...adds].map(editItem);
    if (found.free.length > 0) {
      items.push({
        label: `Make a trip from ${countOf(found.free.length, "photo", "photos")}`,
        onSelect: createTrip.bind(null, found.free),
      });
    }
    items.push({ label: "Stop picking", onSelect: clearSelection });
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  /**
   * Start a new trip over some photos' days, with only those photos ticked.
   * @param chosen - the photos, all on no trip
   */
  function createTrip(chosen: Tile[]): void {
    if (chosen.length === 0) return;
    clearSelection();
    onCreateTrip({
      form: { ...EMPTY_FORM, ...rangeOfTiles(chosen) },
      picked: chosen.map((t) => t.id),
    });
  }

  /**
   * Preview a change to a trip's photos as file moves, in place of the grid until it's made or
   * backed out of.
   * @param edit - the change
   */
  function startEdit(edit: TripEdit): void {
    clearSelection();
    setOpen(null);
    void tripReview.check(
      { action: "update", id: edit.trip.id, draft: edit.draft },
      editDone(edit),
    );
  }

  /**
   * The menu of trips to add the picked photos to, under the button that opened it.
   * @param button - the Add to trip button
   */
  function openAddMenu(button: HTMLElement): void {
    const box = button.getBoundingClientRect();
    const items = addChoices.map((trip) => editItem(addEdit(trip, edits.free, allTiles ?? [])));
    setMenu({ x: box.left, y: box.bottom + 4, items });
  }

  /**
   * A menu entry that previews a trip change.
   * @param edit - the change
   * @returns the entry
   */
  function editItem(edit: TripEdit): MenuItem {
    return { label: editLabel(edit), onSelect: startEdit.bind(null, edit) };
  }

  /**
   * Picked photos and the viewer belong to the old list, so a new filter drops both.
   * @param next - the filter to apply
   */
  function changeFilter(next: LibraryFilter): void {
    clearSelection();
    setOpen(null);
    onFilter(next);
  }

  const indexing = running?.kind === "index";
  const total = allTiles?.length ?? 0;
  const count = tiles?.length ?? 0;
  const filtered = isFiltered(filter);
  const { review } = tripReview;
  const moving = tripReview.applying && (running?.kind === "apply" || running?.kind === "undo");
  // A trip change under review or being made takes the grid's place.
  const reviewing = review !== null || moving;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        detail={
          <Detail
            count={count}
            total={total}
            summary={summary}
            indexing={indexing && total === 0}
          />
        }
        actions={
          reviewing ? (
            review !== null &&
            !moving && (
              <>
                <Button variant="ghost" onClick={tripReview.back} disabled={running !== null}>
                  <Icon name="back" size={16} />
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void tripReview.apply()}
                  disabled={running !== null}
                >
                  {review.action}
                </Button>
              </>
            )
          ) : selecting ? (
            <>
              <span className="mr-2 text-[14px] text-muted" aria-live="polite">
                {selected.size > 0
                  ? `${countOf(selected.size, "photo", "photos")} picked`
                  : "Click photos to add"}
              </span>
              <Button variant="ghost" onClick={clearSelection}>
                Cancel
              </Button>
              {[...edits.remove, ...edits.putBack].map((edit) => (
                <Button
                  key={`${edit.kind}-${edit.trip.id}`}
                  onClick={() => startEdit(edit)}
                  disabled={tripReview.checking}
                >
                  {editLabel(edit)}
                </Button>
              ))}
              {edits.free.length > 0 && addChoices.length > 0 && (
                <Button
                  onClick={(event) => openAddMenu(event.currentTarget)}
                  disabled={tripReview.checking}
                  aria-haspopup="menu"
                >
                  Add to trip
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => createTrip(edits.free)}
                disabled={edits.free.length === 0}
                title={
                  selected.size > 0 && edits.free.length === 0
                    ? "These are already in a trip"
                    : undefined
                }
              >
                <Icon name="trips" size={18} />
                Make trip
              </Button>
            </>
          ) : (
            <>
              {count > 0 && (
                <Button onClick={() => setPicking(true)}>
                  <Icon name="check" size={18} />
                  Make a trip
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={refresh}
                disabled={running !== null}
                title="Look for new photos (F5)"
                aria-label="Look for new photos"
                className="px-2.5"
              >
                <Icon name="refresh" size={18} />
              </Button>
            </>
          )
        }
      />
      {error && <p className="mx-5 mt-3 text-danger">{error}</p>}
      {tripReview.error && (
        <p role="alert" className="mx-5 mt-3 text-danger">
          {tripReview.error}
        </p>
      )}
      {moving && running && <MovingProgress job={running} />}
      {!moving && review !== null && <PlanView preview={review.preview} />}
      {tripReview.result && !reviewing && (
        <ResultBanner
          result={tripReview.result.summary}
          intro={tripReview.result.done}
          undoable
          busy={running !== null}
          onUndo={() => void tripReview.undo()}
          onHistory={() => onNavigate("history")}
        />
      )}
      {!reviewing && settings?.codec_hint_dismissed !== "true" && (
        <CodecHint failed={failedThumbs} onDismiss={() => save("codec_hint_dismissed", "true")} />
      )}

      {!reviewing && allTiles !== null && total > 0 && (
        <LibraryFilterBar tiles={allTiles} filter={filter} onChange={changeFilter} />
      )}

      {total > 0 && count === 0 && filtered && (
        <EmptyState title="Nothing matches">
          <p>Try fewer filters.</p>
          <Button variant="primary" onClick={() => changeFilter(NO_FILTER)}>
            Clear filters
          </Button>
        </EmptyState>
      )}
      {allTiles !== null && total === 0 && !indexing && (
        <EmptyState title="No photos here yet">
          <p>
            Pic Cabinet didn&apos;t find any photos or videos in your library folder. Bring some in
            from a memory card, a phone or another folder, or choose a different library folder in
            Settings.
          </p>
          <Button variant="primary" onClick={onImport}>
            <Icon name="import" size={16} />
            Import photos
          </Button>
        </EmptyState>
      )}
      {allTiles !== null && total === 0 && indexing && (
        <EmptyState title="Looking for photos">
          <p>Your library folder is being read. Photos appear here as soon as that finishes.</p>
        </EmptyState>
      )}
      {!reviewing && tiles !== null && count > 0 && (
        <TimelineGrid
          ownsHeight
          tiles={tiles}
          tileSize={tileSizeOf(settings)}
          selecting={selecting}
          selected={selected}
          onTileClick={onTileClick}
          onTileMenu={onTileMenu}
          // While picking, a click picks, so the magnifier is the way to look at a photo.
          onTileZoom={selecting ? setOpen : undefined}
          onThumbError={onThumbError}
        />
      )}
      {menu && <TileMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}

      {tiles && open !== null && open < tiles.length && (
        <Viewer
          source={source}
          index={open}
          onIndex={setOpen}
          onClose={closeViewer}
          steps={["Newer", "Older"]}
          controls={
            <ViewerTrip
              tile={tiles[open]}
              trips={trips}
              tiles={allTiles ?? []}
              busy={running !== null || tripReview.checking}
              onEdit={startEdit}
              onShow={(trip) => changeFilter({ ...filter, trip })}
            />
          }
        />
      )}
    </div>
  );
}

/**
 * The count beside the title, with how many other files are left alone in its tooltip.
 * @param props - Component props.
 * @param props.count - photos and videos the filter shows
 * @param props.total - photos and videos in the library
 * @param props.summary - the last library read, for its count of other files
 * @param props.indexing - the first read is still running
 * @returns the detail text
 */
function Detail({
  count,
  total,
  summary,
  indexing,
}: {
  count: number;
  total: number;
  summary: IndexSummary | null;
  indexing: boolean;
}): ReactElement {
  if (indexing) return <>Reading the library folder</>;
  const items =
    count === total
      ? total.toLocaleString()
      : `${count.toLocaleString()} of ${total.toLocaleString()}`;
  const others =
    summary && summary.otherFiles > 0
      ? `${summary.otherFiles.toLocaleString()} other ${summary.otherFiles === 1 ? "file is" : "files are"} left alone.`
      : undefined;
  return <span title={others}>{items}</span>;
}

/**
 * The viewer's trip block for one photo: the trip it's in with a way to take it out, the trip
 * it was left out of with a way to put it back, or the nearest trips to add it to.
 * @param props - Component props.
 * @param props.tile - the photo on show
 * @param props.trips - every trip
 * @param props.tiles - every photo in the library, unfiltered
 * @param props.busy - a job or check is running, so the buttons wait
 * @param props.onEdit - preview a change to a trip
 * @param props.onShow - show only a trip's photos in the Library
 * @returns the block
 */
function ViewerTrip({
  tile,
  trips,
  tiles,
  busy,
  onEdit,
  onShow,
}: {
  tile: Tile;
  trips: TripInfo[];
  tiles: Tile[];
  busy: boolean;
  onEdit: (edit: TripEdit) => void;
  onShow: (trip: { id: number; name: string }) => void;
}): ReactElement {
  const { remove, putBack, free } = pickedEdits([tile], trips, tiles);
  const [edit] = [...remove, ...putBack];
  const adds = nearestTrips(free, trips, 2).map((trip) => addEdit(trip, free, tiles));
  const trip = edit?.trip;
  return (
    <section className="flex flex-col items-start gap-2">
      <h3 className="text-[14px] text-faint">Trip</h3>
      {trip && (
        <p className="text-[15px]">
          {edit.kind === "put-back" && "Left out of "}
          <button
            type="button"
            onClick={() => onShow({ id: trip.id, name: trip.name })}
            title="See this trip's photos in the Library"
            className="font-semibold underline-offset-4 hover:underline"
          >
            {trip.name}
          </button>
        </p>
      )}
      {!trip && <p className="text-[15px] text-muted">None</p>}
      <div className="flex flex-wrap gap-2">
        {[...(edit ? [edit] : []), ...adds].map((change) => (
          <Button
            key={`${change.kind}-${change.trip.id}`}
            onClick={() => onEdit(change)}
            disabled={busy}
          >
            {change.kind === "remove"
              ? "Remove from trip"
              : change.kind === "put-back"
                ? "Put back"
                : editLabel(change)}
          </Button>
        ))}
      </div>
    </section>
  );
}
