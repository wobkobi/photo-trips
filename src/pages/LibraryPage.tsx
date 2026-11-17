import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { BinDialog } from "../components/BinDialog";
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

import { tileSizeOf } from "../lib/display";
import { count as countOf } from "../lib/format";
import {
  clearFilters,
  filterTiles,
  isFilteredBesidesTrip,
  NO_FILTER,
  tripOf,
  type FilterTrip,
  type LibraryFilter,
} from "../lib/libraryFilter";
import { isTextEntry, modalOnScreen } from "../lib/menu";
import {
  addEdit,
  editDone,
  editLabel,
  nearestTrips,
  pickedEdits,
  type TripEdit,
} from "../lib/tripEdits";
import { EMPTY_FORM, rangeOfTiles, rangeText, type TripStart } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useLibrary } from "../lib/useLibrary";
import { useSettings } from "../lib/useSettings";
import { useTripReview } from "../lib/useTripReview";

/** How many nearby trips the menus offer to add photos to. */
const ADD_CHOICES = 4;
/** How long after a try tiles without a thumbnail wait before asking again, in ms. */
const THUMB_RETRY_MS = 60_000;

/**
 * The whole library as a month-by-month timeline, with a viewer for single photos. The photos,
 * filter, selection and open photo live in the library store, so they are as they were on
 * coming back. "Make a trip" turns clicks into selecting, so the photos to make a trip from can
 * be chosen without knowing any shortcuts; Ctrl-click, Shift-click and right-click select too.
 *
 * A trip in the filter makes the page that trip's: its name as the title, its dates and count
 * beside it, Edit, and a back arrow to where it was opened from. Its other filters narrow within
 * the trip, and Clear filters keeps the trip.
 * @param props - Component props.
 * @param props.onCreateTrip - start a new trip over the picked photos' days, with only those
 *   photos ticked
 * @param props.onImport - open the Import page
 * @param props.onNavigate - switch to another page, for History from the result banner
 * @param props.onShowTrip - show one trip, from the viewer's trip name
 * @param props.onLeaveTrip - leave the trip on show for the page it was opened from
 * @param props.onEditTrip - open the trip on show in the Trips page's editor
 * @param props.refreshRequested - File > Refresh (F5) was picked; refresh on opening
 * @param props.onRefreshStarted - called once that refresh has been asked for
 * @param props.findRequested - View > Find (Ctrl+F) was picked; focus the file name box
 * @param props.onFindStarted - called once that box has been focused, or can't be
 * @returns the page
 */
export function LibraryPage({
  onCreateTrip,
  onImport,
  onNavigate,
  onShowTrip,
  onLeaveTrip,
  onEditTrip,
  refreshRequested,
  onRefreshStarted,
  findRequested,
  onFindStarted,
}: {
  onCreateTrip: (start: TripStart) => void;
  onImport: () => void;
  onNavigate: (page: PageId) => void;
  onShowTrip: (trip: FilterTrip) => void;
  onLeaveTrip: () => void;
  onEditTrip: (trip: TripInfo) => void;
  refreshRequested: boolean;
  onRefreshStarted: () => void;
  findRequested: boolean;
  onFindStarted: () => void;
}): ReactElement {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const {
    tiles: allTiles,
    trips,
    summary,
    error: loadError,
    filter,
    setFilter,
    selected,
    setSelected,
    picking,
    setPicking,
    anchorId,
    setAnchorId,
    openId,
    setOpenId,
    place,
    clearSelection: clearPicks,
    reload,
  } = useLibrary();
  const tiles = useMemo(() => allTiles && filterTiles(allTiles, filter), [allTiles, filter]);
  // The trip on show, read from the store by id so a rename shows; its name in the filter is
  // kept for a trip deleted since.
  const trip = tripOf(filter);
  const tripInfo = trip && trips.find((t) => t.id === trip.id);
  // Every photo in the place on show, before its other filters: the trip's, or the library's.
  const placeTiles = useMemo(
    () => (allTiles && trip ? filterTiles(allTiles, { ...NO_FILTER, trip }) : allTiles),
    [allTiles, trip],
  );
  const [error, setError] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Tile[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Photos waiting for the user to confirm sending them to the Recycle Bin. */
  const [binning, setBinning] = useState<Tile[] | null>(null);

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
  // The grid reports each jump done, and it's dropped then, so a grid mounted again later (after a
  // trip review) goes back to its kept place instead of replaying it.
  const [jump, setJump] = useState<TileJump | null>(null);
  const jumpDone = useCallback(() => setJump(null), []);
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
  const open = openId === null ? null : (indexOf.get(openId) ?? null);
  // A photo that left the list (binned, or filtered out by a new date) closes the viewer for
  // good, rather than reopening if it comes back.
  const openGone = openId !== null && tiles !== null && open === null;
  useEffect(() => {
    if (openGone) setOpenId(null);
  }, [openGone, setOpenId]);
  const closeViewer = useCallback(() => {
    if (open !== null) setJump({ index: open, align: "auto" });
    setOpenId(null);
  }, [open, setOpenId]);
  const source = useLibrarySource(ids, revision);
  const clearSelection = useCallback(() => {
    clearPicks();
    setMenu(null);
  }, [clearPicks]);

  /** Re-read the library folder for new and changed files. */
  function refresh(): void {
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }

  useEffect(() => {
    if (!refreshRequested) return;
    onRefreshStarted();
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }, [refreshRequested, onRefreshStarted]);

  // Find closes the viewer, which covers the file name box. The focus below waits for the
  // commit that unmounts the viewer, so it lands after the viewer's cleanup hands focus back
  // to the tile.
  useEffect(() => {
    if (findRequested && open !== null) setOpenId(null);
  }, [findRequested, open, setOpenId]);
  // The box only shows once the list has loaded, so Find waits for that.
  const loaded = allTiles !== null;
  useEffect(() => {
    if (!findRequested || open !== null || !loaded) return;
    onFindStarted();
    searchBox.current?.focus();
  }, [findRequested, onFindStarted, open, loaded]);

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
  const reviewOpen = tripReview.review !== null;
  const gridShown = open === null && !reviewOpen;
  // Capture phase, so Escape deselects before the header's back arrow sees it: inside a trip the
  // first Escape clears the selection and the second leaves the trip. A text box (the name search
  // clears itself), a menu, the viewer or a modal on screen keeps its own Escape.
  useEffect(() => {
    if (!selecting || !gridShown) return;
    /**
     * Escape stops selecting and marks the key handled.
     * @param event - the window's keydown, caught before the page sees it
     */
    function onEscape(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || isTextEntry(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      if (modalOnScreen()) return;
      event.preventDefault();
      clearSelection();
    }
    window.addEventListener("keydown", onEscape, true);
    return () => window.removeEventListener("keydown", onEscape, true);
  }, [selecting, gridShown, clearSelection]);

  useEffect(() => {
    /**
     * Ctrl+A selects every photo shown and Delete asks to bin the selected ones, unless the key
     * is for a text box.
     * @param event - the key pressed
     */
    const onKey = (event: KeyboardEvent): void => {
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
  }, [gridShown, ids, picked, setSelected, setAnchorId]);

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
      await reload();
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
   * Show a new filter; the store drops the selection and the open photo, which belong to the
   * old list.
   * @param next - the filter to apply
   */
  function changeFilter(next: LibraryFilter): void {
    setMenu(null);
    setFilter(next);
  }

  const indexing = running?.kind === "index";
  const total = allTiles?.length ?? 0;
  const placeTotal = placeTiles?.length ?? 0;
  const count = tiles?.length ?? 0;
  const { review } = tripReview;
  const moving = tripReview.applying && (running?.kind === "apply" || running?.kind === "undo");
  // A trip change under review or being made takes the grid's place.
  const reviewing = review !== null || moving;
  let title = "Library";
  if (review !== null && !moving) title = "Preview";
  else if (trip) title = tripInfo?.name ?? trip.name;
  // One back arrow at a time: a review's own steps back to the grid.
  let onBack: (() => void) | undefined;
  if (review !== null && !tripReview.applying) onBack = tripReview.back;
  else if (trip && !reviewing) onBack = onLeaveTrip;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={title}
        detail={
          // The Library's counts don't describe a trip change under review.
          review !== null && !moving ? undefined : (
            <Detail
              count={tiles === null ? null : count}
              total={placeTotal}
              dates={tripInfo ? rangeText(tripInfo.startAt, tripInfo.endAt) : undefined}
              summary={summary}
              indexing={indexing && total === 0}
            />
          )
        }
        onBack={onBack}
        actions={
          reviewing ? (
            review !== null &&
            !moving && (
              <Button
                variant="primary"
                onClick={() => void tripReview.apply()}
                busy={running !== null}
              >
                {review.action}
              </Button>
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
              {tripInfo && (
                <Button onClick={() => onEditTrip(tripInfo)} busy={running !== null}>
                  Edit
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
      {(error ?? loadError) && <p className="mx-5 mt-3 text-danger">{error ?? loadError}</p>}
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

      {!reviewing && placeTiles !== null && placeTotal > 0 && (
        <LibraryFilterBar
          tiles={placeTiles}
          filter={filter}
          onChange={changeFilter}
          searchBox={searchBox}
        />
      )}

      {!reviewing && total > 0 && trip && placeTotal === 0 && (
        <EmptyState title="No photos in this trip">
          {tripInfo && (
            <Button variant="primary" onClick={() => onEditTrip(tripInfo)} busy={running !== null}>
              Edit trip
            </Button>
          )}
        </EmptyState>
      )}
      {placeTotal > 0 && count === 0 && isFilteredBesidesTrip(filter) && (
        <EmptyState title="Nothing matches">
          <p>Try fewer filters.</p>
          <Button variant="primary" onClick={() => changeFilter(clearFilters(filter))}>
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
          onJumpDone={jumpDone}
          place={place}
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
                onShow={onShowTrip}
              />
              <ViewerDate
                tile={tiles[open]}
                busy={savingDate}
                onChange={() => setDating([tiles[open]])}
                onFileDate={() => void saveDates([tiles[open]], null)}
              />
            </>
          }
        />
      )}
      {/* After the viewer, though either dialog would show over it from anywhere in the page:
          a modal dialog is drawn in the top layer, above the viewer's portal. */}
      {binning !== null && !reviewing && (
        <BinDialog
          tiles={binning}
          busy={running !== null}
          onConfirm={confirmBin}
          onCancel={() => setBinning(null)}
        />
      )}
      {dating !== null && !reviewing && (
        <DateEditor
          items={dating.length}
          initial={dating[0].takenAt}
          busy={savingDate}
          onSave={(date) => void saveDates(dating, date)}
          onCancel={() => setDating(null)}
        />
      )}
    </div>
  );
}

/**
 * The count beside the title, after a trip's dates when one is on show, with how many other
 * files are left alone in its tooltip.
 * @param props - Component props.
 * @param props.count - photos and videos the filter shows, or null until the photos have loaded
 * @param props.total - photos and videos in the library, or in the trip on show
 * @param props.dates - the trip's dates, when one is on show
 * @param props.summary - the last library read, for its count of other files
 * @param props.indexing - the first read is still running
 * @returns the detail text, or null while there's nothing to count yet
 */
function Detail({
  count,
  total,
  dates,
  summary,
  indexing,
}: {
  count: number | null;
  total: number;
  dates?: string;
  summary: IndexSummary | null;
  indexing: boolean;
}): ReactElement | null {
  if (indexing) return <>Reading the library folder</>;
  // No count until the photos are in, so the header never flashes a 0 on the way.
  if (count === null) return dates ? <>{dates}</> : null;
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
      {dates && `${dates} · `}
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
 * The viewer's date buttons for one photo: change its date in the Set date dialog, or go back to
 * the file's own date once one has been set.
 * @param props - Component props.
 * @param props.tile - the photo on show
 * @param props.busy - a date change is being saved
 * @param props.onChange - open the Set date dialog for this photo
 * @param props.onFileDate - go back to the file's own date
 * @returns the buttons
 */
function ViewerDate({
  tile,
  busy,
  onChange,
  onFileDate,
}: {
  tile: Tile;
  busy: boolean;
  onChange: () => void;
  onFileDate: () => void;
}): ReactElement {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button onClick={onChange}>
        <Icon name="calendar" size={16} />
        Change date
      </Button>
      {tile.dateSet && (
        <Button variant="ghost" onClick={onFileDate} busy={busy}>
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
