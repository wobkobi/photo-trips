import { useCallback, useEffect, useMemo, useState } from "react";
import { CodecHint } from "../components/CodecHint";
import { Icon } from "../components/Icon";
import { LibraryFilterBar } from "../components/LibraryFilterBar";
import { TileMenu } from "../components/TileMenu";
import { TimelineGrid, type TileEvent } from "../components/TimelineGrid";
import { Viewer } from "../components/Viewer";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useLibrarySource } from "../components/viewSources";
import { api, errorText, type IndexSummary, type Tile } from "../lib/api";
import { tileSizeOf } from "../lib/display";
import { count as countOf } from "../lib/format";
import { filterTiles, isFiltered, NO_FILTER, type LibraryFilter } from "../lib/libraryFilter";
import { EMPTY_FORM, rangeOfTiles, type TripStart } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";

/**
 * The whole library as a month-by-month timeline, with a viewer for single photos.
 * "Pick photos for a trip" turns clicks into picking, so the photos to make a trip from can be
 * chosen without knowing any shortcuts; Ctrl-click, Shift-click and right-click pick too.
 * @param props.filter - which photos to show; kept by the app so the Trips page can open the
 *   Library at one trip
 * @param props.onFilter - called with a new filter
 * @param props.onCreateTrip - start a new trip over the picked photos' days, with only those
 *   photos ticked
 * @param props.onImport - open the Import page
 * @param props.refreshRequested - File > Look for new photos (F5) was picked; refresh on opening
 * @param props.onRefreshStarted - called once that refresh has been asked for
 * @returns the page
 */
export function LibraryPage({
  filter,
  onFilter,
  onCreateTrip,
  onImport,
  refreshRequested,
  onRefreshStarted,
}: {
  filter: LibraryFilter;
  onFilter: (filter: LibraryFilter) => void;
  onCreateTrip: (start: TripStart) => void;
  onImport: () => void;
  refreshRequested: boolean;
  onRefreshStarted: () => void;
}) {
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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(() => {
    api.libraryTiles().then(
      (loaded) => {
        setTiles(loaded);
        setError(null);
      },
      (err) => setError(errorText(err)),
    );
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

  function refresh() {
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }

  useEffect(() => {
    if (!refreshRequested) return;
    onRefreshStarted();
    api.indexLibrary().catch((err) => setError(errorText(err)));
  }, [refreshRequested, onRefreshStarted]);

  const selecting = picking || selected.size > 0;

  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting, clearSelection]);

  /**
   * Explorer-style selection: Ctrl toggles, Shift extends from the last clicked tile, and a
   * plain click toggles while picking or while anything is picked. Otherwise a plain click
   * opens the viewer.
   */
  function onTileClick(index: number, event: TileEvent) {
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

  function onTileMenu(index: number, event: TileEvent) {
    if (!tiles) return;
    event.preventDefault();
    const id = tiles[index].id;
    if (!selected.has(id)) {
      setSelected(new Set([id]));
      setAnchor(index);
    }
    setMenu({ x: event.clientX, y: event.clientY });
  }

  function createTrip() {
    if (!tiles) return;
    const chosen = tiles.filter((t) => selected.has(t.id));
    if (chosen.length === 0) return;
    clearSelection();
    onCreateTrip({
      form: { ...EMPTY_FORM, ...rangeOfTiles(chosen) },
      picked: chosen.map((t) => t.id),
    });
  }

  /** Picked photos and the viewer belong to the old list, so a new filter drops both. */
  function changeFilter(next: LibraryFilter) {
    clearSelection();
    setOpen(null);
    onFilter(next);
  }

  const indexing = running?.kind === "index";
  const total = allTiles?.length ?? 0;
  const count = tiles?.length ?? 0;
  const filtered = isFiltered(filter);

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
          selecting ? (
            <>
              <span className="mr-2 text-[16px] font-semibold" aria-live="polite">
                {selected.size > 0
                  ? `${countOf(selected.size, "photo", "photos")} picked`
                  : "Click the photos to put in the trip"}
              </span>
              <Button variant="ghost" onClick={clearSelection}>
                Cancel
              </Button>
              <Button variant="primary" onClick={createTrip} disabled={selected.size === 0}>
                <Icon name="trips" size={18} />
                Make a trip from these
              </Button>
            </>
          ) : (
            <>
              {count > 0 && (
                <Button onClick={() => setPicking(true)}>
                  <Icon name="check" size={18} />
                  Pick photos for a trip
                </Button>
              )}
              <Button onClick={refresh} disabled={running !== null}>
                <Icon name="refresh" size={18} />
                Look for new photos
              </Button>
            </>
          )
        }
      />
      {error && <p className="mx-8 mt-4 text-danger">{error}</p>}
      {settings?.codec_hint_dismissed !== "true" && (
        <CodecHint failed={failedThumbs} onDismiss={() => save("codec_hint_dismissed", "true")} />
      )}

      {allTiles !== null && total > 0 && (
        <LibraryFilterBar tiles={allTiles} filter={filter} onChange={changeFilter} />
      )}

      {total > 0 && count === 0 && filtered && (
        <EmptyState title="Nothing matches">
          <p>No photos or videos fit everything chosen above. Change a choice to see more.</p>
          <Button variant="primary" onClick={() => changeFilter(NO_FILTER)}>
            Show everything
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
      {tiles !== null && count > 0 && (
        <TimelineGrid
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
      {menu && (
        <TileMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: `Make a trip from ${countOf(selected.size, "photo", "photos")}`,
              onSelect: createTrip,
            },
            { label: "Stop picking", onSelect: clearSelection },
          ]}
        />
      )}

      {tiles && open !== null && open < tiles.length && (
        <Viewer
          source={source}
          index={open}
          onIndex={setOpen}
          onClose={closeViewer}
          steps={["Newer", "Older"]}
        />
      )}
    </div>
  );
}

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
}) {
  if (indexing) return <>Reading your library folder</>;
  const noun = total === 1 ? "photo or video" : "photos and videos";
  const items =
    count === total
      ? `${total.toLocaleString()} ${noun}`
      : `Showing ${count.toLocaleString()} of ${total.toLocaleString()} ${noun}`;
  if (!summary || summary.otherFiles === 0) return <>{items}</>;
  return (
    <>
      {items}. {summary.otherFiles.toLocaleString()} other{" "}
      {summary.otherFiles === 1 ? "file is" : "files are"} left alone.
    </>
  );
}
