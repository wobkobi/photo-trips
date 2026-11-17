import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { CodecHint } from "../components/CodecHint";
import { DateEditor } from "../components/DateEditor";
import { Icon } from "../components/Icon";
import { LibraryFilterBar } from "../components/LibraryFilterBar";
import { MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { TileMenu, type MenuItem } from "../components/TileMenu";
import { TimelineGrid, type TileEvent, type TileJump } from "../components/TimelineGrid";
import { Viewer } from "../components/Viewer";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useLibrarySource } from "../components/viewSources";
import {
  api,
  errorText,
  type ApplySummary,
  type IndexSummary,
  type Tile,
  type TripInfo,
} from "../lib/api";
import { binQuestion } from "../lib/binText";
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
/** How long after a try tiles without a thumbnail wait before asking again, in ms. */
const THUMB_RETRY_MS = 60_000;

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
 * @param props.refreshRequested - File > Refresh (F5) was picked; refresh on opening
 * @param props.onRefreshStarted - called once that refresh has been asked for
 * @param props.findRequested - View > Find (Ctrl+F) was picked; focus the file name box
 * @param props.onFindStarted - called once that box has been focused, or can't be
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
  findRequested,
  onFindStarted,
}: {
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  onCreateTrip: (start: TripStart) => void;
  onImport: () => void;
  onNavigate: (page: PageId) => void;
  refreshRequested: boolean;
  onRefreshStarted: () => void;
  findRequested: boolean;
  onFindStarted: () => void;
}): ReactElement {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const [allTiles, setTiles] = useState<Tile[] | null>(null);
  const tiles = useMemo(() => allTiles && filterTiles(allTiles, filter), [allTiles, filter]);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The open photo and the Shift-click anchor are kept as ids, so a reload that adds or drops
  // photos can't change which one is open or where a range starts.
  const [openId, setOpenId] = useState<number | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Tile[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // Picking was turned on with the button, so plain clicks pick even before anything is picked.
  const [picking, setPicking] = useState(false);
  const [anchorId, setAnchorId] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [trips, setTrips] = useState<TripInfo[]>([]);
  /** Photos waiting for the user to confirm sending them to the Recycle Bin. */
  const [binning, setBinning] = useState<Tile[] | null>(null);
  /** Names of the files that go with a single photo waiting to be binned, once read. */
  const [binPartners, setBinPartners] = useState<{ id: number; names: string[] } | null>(null);
  /** This page started the running Recycle Bin job, so its end shows here. */
  const [binStarted, setBinStarted] = useState(false);
  const [binResult, setBinResult] = useState<ApplySummary | null>(null);
  /** Photos waiting for a new date, picked from the menu. */
  const [dating, setDating] = useState<Tile[] | null>(null);
  const [savingDate, setSavingDate] = useState(false);
  /** The last date change, for its Undo button. */
  const [dateDone, setDateDone] = useState<{ batch: number; text: string } | null>(null);
  // Raised after a date change or an undo, so the viewer shows the new date.
  const [revision, setRevision] = useState(0);
  const tripReview = useTripReview();
  const searchBox = useRef<HTMLInputElement>(null);

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

  // A single photo with linked files: read their names so the question can list them.
  const binOne = binning?.length === 1 && binning[0].extra > 0 ? binning[0].id : null;
  useEffect(() => {
    if (binOne === null) return;
    let live = true;
    api.mediaDetail(binOne).then(
      (detail) => {
        if (!live) return;
        const names = detail.members.filter((m) => m.id !== detail.id).map((m) => m.name);
        setBinPartners({ id: binOne, names });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [binOne]);

  useJobDone("index", (done) => {
    if (done.ok) setSummary(done.result as IndexSummary);
    load();
  });
  useJobDone(["apply", "undo", "remove", "import", "inbox"], load);
  useJobDone("remove", (job) => {
    if (!binStarted) return;
    setBinStarted(false);
    if (job.ok) setBinResult(job.result as ApplySummary);
    else if (job.error) setError(job.error);
  });
  useJobDone("undo", () => {
    setBinResult(null);
    setDateDone(null);
    setRevision((r) => r + 1);
  });

  // Each tile once: a retry that fails again mustn't add it twice.
  const onThumbError = useCallback(
    (tile: Tile) =>
      setFailedThumbs((prev) =>
        prev.length >= 50 || prev.some((t) => t.id === tile.id) ? prev : [...prev, tile],
      ),
    [],
  );
  // Tiles without a thumbnail ask again when a Store extension arrives (the codec hint notices),
  // and when the window comes back into focus a minute or more after the last try, as after
  // fixing a file elsewhere. Windows' own memory of the failure lasts that minute too.
  const [thumbRetry, setThumbRetry] = useState(0);
  const anyThumbFailed = failedThumbs.length > 0;
  useEffect(() => {
    if (!anyThumbFailed) return;
    const since = Date.now();
    /** Ask again if the last try is old enough for Windows to draw the files afresh. */
    const onFocus = (): void => {
      if (Date.now() - since >= THUMB_RETRY_MS) setThumbRetry((n) => n + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [anyThumbFailed, thumbRetry]);
  // Closing the viewer brings the last photo it showed into view in the grid and focuses it,
  // since stepping through photos may have gone well past the one it opened on.
  const [jump, setJump] = useState<TileJump | null>(null);
  // A new filter shows a different list, so the grid goes back to its top. Focus stays put, so
  // typing in the name box (a new filter each key) carries on. From the prop, so a trip opened
  // from elsewhere does the same.
  const [shownFilter, setShownFilter] = useState(filter);
  if (shownFilter !== filter) {
    setShownFilter(filter);
    setJump({ index: 0, focus: false });
  }
  const ids = useMemo(() => tiles?.map((t) => t.id) ?? [], [tiles]);
  const indexOf = useMemo(() => new Map(ids.map((id, index) => [id, index])), [ids]);
  // A photo that left the list (binned, or filtered out by a new date) closes the viewer for
  // good, rather than reopening if it comes back.
  if (openId !== null && tiles !== null && !indexOf.has(openId)) setOpenId(null);
  const open = openId === null ? null : (indexOf.get(openId) ?? null);
  const closeViewer = useCallback(() => {
    if (open !== null) setJump({ index: open, align: "auto" });
    setOpenId(null);
  }, [open]);
  const source = useLibrarySource(ids, revision);
  const clearSelection = useCallback(() => {
    setPicking(false);
    setSelected(new Set());
    setAnchorId(null);
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

  // Find closes the viewer, which covers the file name box. Closed here during render, so the
  // focus below runs in the commit that unmounts the viewer, after its cleanup hands focus back
  // to the tile.
  if (findRequested && openId !== null) setOpenId(null);
  // The box only shows once the list has loaded, so Find waits for that.
  const loaded = allTiles !== null;
  useEffect(() => {
    if (!findRequested || openId !== null || !loaded) return;
    onFindStarted();
    searchBox.current?.focus();
  }, [findRequested, onFindStarted, openId, loaded]);

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

  // Ctrl+A only while the grid is what's on screen, not over the viewer or a trip review.
  const gridShown = openId === null && tripReview.review === null;
  useEffect(() => {
    /**
     * Escape stops picking; Ctrl+A picks every photo shown and Delete asks to bin the picked
     * ones, unless the key is for a text box.
     * @param event - the key pressed
     */
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && selecting) clearSelection();
      if (!gridShown || isTyping(event.target)) return;
      if (event.key === "Delete" && picked.length > 0) setBinning(picked);
      const pickAll = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
      if (!pickAll || ids.length === 0) return;
      event.preventDefault();
      setSelected(new Set(ids));
      setAnchorId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clearSelection, gridShown, ids, picked]);

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
    const anchor = anchorId === null ? undefined : indexOf.get(anchorId);
    if (event.shiftKey && anchor !== undefined) {
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
      setAnchorId(id);
      return;
    }
    setOpenId(id);
  }

  /**
   * Right-click menu: the file actions for the photo under the pointer, then the trip changes
   * for the pick. Outside picking it acts on that photo alone without starting to pick; while
   * picking, an unpicked photo becomes the whole pick, as in Explorer.
   * @param index - position of the tile in the shown list
   * @param event - the right-click, for where to open the menu
   */
  function onTileMenu(index: number, event: TileEvent): void {
    if (!tiles) return;
    event.preventDefault();
    const tile = tiles[index];
    // The menu acts on the pick as it will be, so work its choices out from that pick.
    const pick = selected.has(tile.id) ? picked : [tile];
    if (selecting && !selected.has(tile.id)) {
      setSelected(new Set([tile.id]));
      setAnchorId(tile.id);
    }
    const items: MenuItem[] = [
      { label: "Open", onSelect: fileAction.bind(null, api.openMedia, tile.id) },
      { label: "Show in folder", onSelect: fileAction.bind(null, api.revealMedia, tile.id) },
      { label: "Copy", onSelect: fileAction.bind(null, api.copyMedia, tile.id) },
      { label: "Copy path", onSelect: copyPath.bind(null, tile.id) },
      {
        label:
          pick.length > 1 ? `Set date for ${countOf(pick.length, "item", "items")}` : "Set date",
        onSelect: setDating.bind(null, pick),
        divided: true,
      },
    ];
    const set = pick.filter((t) => t.dateSet);
    if (set.length > 0) {
      items.push({ label: "Use the file's date", onSelect: fileDates.bind(null, set) });
    }
    const found = pickedEdits(pick, trips, allTiles ?? []);
    const adds = nearestTrips(found.free, trips, ADD_CHOICES).map((trip) =>
      addEdit(trip, found.free, allTiles ?? []),
    );
    const tripItems = [...found.remove, ...found.putBack, ...adds].map(editItem);
    if (found.free.length > 0) {
      tripItems.push({
        label: `Make a trip from ${countOf(found.free.length, "photo", "photos")}`,
        onSelect: createTrip.bind(null, found.free),
      });
    }
    if (selecting) tripItems.push({ label: "Deselect", onSelect: clearSelection });
    if (tripItems.length > 0) tripItems[0].divided = true;
    const bin: MenuItem = {
      label:
        pick.length > 1
          ? `Send ${countOf(pick.length, "item", "items")} to the Recycle Bin`
          : "Send to the Recycle Bin",
      onSelect: setBinning.bind(null, pick),
      divided: true,
    };
    setMenu({ x: event.clientX, y: event.clientY, items: [...items, ...tripItems, bin] });
  }

  /** Send the photos waiting for confirmation to the Recycle Bin; the job's end shows the result. */
  function confirmBin(): void {
    if (binning === null) return;
    const binIds = binning.map((t) => t.id);
    setBinning(null);
    setBinResult(null);
    clearSelection();
    setOpenId(null);
    setBinStarted(true);
    api.recycleMedia(binIds).catch((err) => {
      setBinStarted(false);
      setError(errorText(err));
    });
  }

  /**
   * Set the date of some photos in Pic Cabinet, or go back to their files' own dates, then show
   * the change with its Undo. A photo open in the viewer stays open as it moves in the timeline,
   * since the viewer follows its id.
   * @param chosen - the photos
   * @param date - local time, `YYYY-MM-DDTHH:MM:SS`, or null for the files' own dates
   */
  async function saveDates(chosen: Tile[], date: string | null): Promise<void> {
    setSavingDate(true);
    try {
      const batch = await api.setDates(
        chosen.map((t) => t.id),
        date,
      );
      const photos = countOf(chosen.length, "item", "items");
      setDateDone({
        batch,
        text: date ? `Date set for ${photos}.` : `Back to the file's own date for ${photos}.`,
      });
      setDating(null);
      setTiles(await api.libraryTiles());
      setRevision((r) => r + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingDate(false);
    }
  }

  /**
   * Go back to the files' own dates for photos whose date was set in Pic Cabinet.
   * @param chosen - the photos
   */
  function fileDates(chosen: Tile[]): void {
    void saveDates(chosen, null);
  }

  /**
   * Open, reveal or copy a file, showing any failure as the page error.
   * @param action - {@link api.openMedia}, {@link api.revealMedia} or {@link api.copyMedia}
   * @param id - the file's media id
   */
  function fileAction(action: (id: number) => Promise<void>, id: number): void {
    action(id).catch((err) => setError(errorText(err)));
  }

  /**
   * Put a file's full path on the clipboard.
   * @param id - the file's media id
   */
  function copyPath(id: number): void {
    api
      .mediaDetail(id)
      .then((detail) => navigator.clipboard.writeText(detail.path))
      .catch((err) => setError(errorText(err)));
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
    setOpenId(null);
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
    setOpenId(null);
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
                <Button variant="ghost" onClick={tripReview.back} busy={running !== null}>
                  <Icon name="back" size={16} />
                  Back
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void tripReview.apply()}
                  busy={running !== null}
                >
                  {review.action}
                </Button>
              </>
            )
          ) : selecting ? (
            <>
              <span className="mr-2 text-[14px] text-muted" aria-live="polite">
                {selected.size > 0
                  ? `${countOf(selected.size, "item", "items")} selected`
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
                busy={running !== null}
                title="Refresh (F5)"
                aria-label="Refresh"
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
      {binning !== null && !reviewing && (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-warn-line bg-warn-soft p-4">
          <p className="min-w-0 flex-1 basis-60">
            {binQuestion(binning, binPartners?.id === binOne ? binPartners.names : null)} You can
            undo this from History.
          </p>
          <Button variant="primary" onClick={confirmBin} busy={running !== null}>
            Send to the Recycle Bin
          </Button>
          <Button variant="ghost" onClick={() => setBinning(null)}>
            Cancel
          </Button>
        </div>
      )}
      {dating !== null && !reviewing && (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-4">
          <p className="min-w-0 flex-1 basis-60">
            New date for {countOf(dating.length, "item", "items")}. Only Pic Cabinet uses it; the
            files aren&apos;t changed.
          </p>
          <DateEditor
            initial={dating[0].takenAt}
            busy={savingDate}
            onSave={(date) => void saveDates(dating, date)}
            onCancel={() => setDating(null)}
          />
        </div>
      )}
      {dateDone && !reviewing && (
        <div className="mx-5 mt-3 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-4">
          <p className="min-w-0 flex-1 basis-60">{dateDone.text}</p>
          <Button
            onClick={() => api.undoBatch(dateDone.batch).catch((err) => setError(errorText(err)))}
            busy={running !== null}
          >
            <Icon name="undo" size={16} />
            Undo
          </Button>
          <Button variant="ghost" onClick={() => setDateDone(null)}>
            Close
          </Button>
        </div>
      )}
      {binResult && !reviewing && (
        <ResultBanner
          result={binResult}
          destination="the Recycle Bin"
          busy={running !== null}
          onUndo={() => api.undoBatch(binResult.batchId).catch((err) => setError(errorText(err)))}
          onHistory={() => onNavigate("history")}
        />
      )}
      {!reviewing && settings?.codec_hint_dismissed !== "true" && (
        <CodecHint
          failed={failedThumbs}
          shown={allTiles ?? []}
          onDismiss={() => save("codec_hint_dismissed", "true")}
          onChange={() => setThumbRetry((n) => n + 1)}
        />
      )}

      {!reviewing && allTiles !== null && total > 0 && (
        <LibraryFilterBar
          tiles={allTiles}
          filter={filter}
          onChange={changeFilter}
          searchBox={searchBox}
        />
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
            Pic Cabinet didn&apos;t find any photos or videos in your library folder. Import some
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
          onTileZoom={selecting ? (index) => setOpenId(tiles[index].id) : undefined}
          onThumbError={onThumbError}
          thumbRetry={thumbRetry}
          showUncertain={filter.uncertain}
          jump={jump}
        />
      )}
      {menu && <TileMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}

      {tiles && open !== null && open < tiles.length && (
        <Viewer
          source={source}
          index={open}
          onIndex={(index) => setOpenId(tiles[index]?.id ?? null)}
          onClose={closeViewer}
          steps={["Newer", "Older"]}
          controls={
            <>
              <ViewerTrip
                tile={tiles[open]}
                trips={trips}
                tiles={allTiles ?? []}
                busy={running !== null || tripReview.checking}
                onEdit={startEdit}
                onShow={(trip) => changeFilter({ ...filter, trip })}
              />
              <ViewerDate
                key={tiles[open].id}
                tile={tiles[open]}
                busy={savingDate}
                onSave={(date) => void saveDates([tiles[open]], date)}
              />
            </>
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
  const unreadable = summary?.unreadable ?? 0;
  return (
    <>
      <span title={others}>{items}</span>
      {unreadable > 0 && (
        <span
          className="text-warn"
          title="Their photos stay listed. Check the drive is connected, then refresh."
        >
          {" "}
          - {countOf(unreadable, "folder", "folders")} couldn&apos;t be read
        </span>
      )}
    </>
  );
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
            busy={busy}
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

/**
 * The viewer's date buttons for one photo: change its date, or go back to the file's own date
 * once one has been set.
 * @param props - Component props.
 * @param props.tile - the photo on show
 * @param props.busy - a date change is being saved
 * @param props.onSave - set the date, `YYYY-MM-DDTHH:MM:SS`, or null for the file's own
 * @returns the buttons, or the date box while changing it
 */
function ViewerDate({
  tile,
  busy,
  onSave,
}: {
  tile: Tile;
  busy: boolean;
  onSave: (date: string | null) => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <div className="mt-4">
        <DateEditor
          initial={tile.takenAt}
          busy={busy}
          onSave={onSave}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button onClick={() => setEditing(true)}>
        <Icon name="calendar" size={16} />
        Change date
      </Button>
      {tile.dateSet && (
        <Button variant="ghost" onClick={() => onSave(null)} busy={busy}>
          Use the file&apos;s date
        </Button>
      )}
    </div>
  );
}

/**
 * Whether a key press is going into a text box, where Ctrl+A selects the text instead.
 * @param target - the key press's target
 * @returns true for a text input, text area, drop-down or editable element
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
