import { useCallback, useEffect, useState } from "react";
import { CodecHint } from "../components/CodecHint";
import { Icon } from "../components/Icon";
import { TileMenu } from "../components/TileMenu";
import { TimelineGrid, type TileEvent } from "../components/TimelineGrid";
import { Viewer } from "../components/Viewer";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { api, errorText, type IndexSummary, type Tile } from "../lib/api";
import { count as countOf } from "../lib/format";
import { rangeOfTiles, type TripRange } from "../lib/trips";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";

/**
 * The whole library as a month-by-month timeline, with a viewer for single photos.
 * Ctrl-click, Shift-click or right-click selects photos to make a trip from.
 * @param props.onCreateTrip - start a new trip covering the given days
 * @returns the page
 */
export function LibraryPage({ onCreateTrip }: { onCreateTrip: (range: TripRange) => void }) {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Tile[]>([]);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
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
  useJobDone(["apply", "undo"], load);

  const onThumbError = useCallback(
    (tile: Tile) => setFailedThumbs((prev) => (prev.length >= 50 ? prev : [...prev, tile])),
    [],
  );
  const closeViewer = useCallback(() => setOpen(null), []);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAnchor(null);
    setMenu(null);
  }, []);

  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, clearSelection]);

  /**
   * Explorer-style selection: Ctrl toggles, Shift extends from the last clicked tile, and a
   * plain click toggles while anything is selected. Otherwise a plain click opens the viewer.
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
    if (event.ctrlKey || event.metaKey || selected.size > 0) {
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
    onCreateTrip(rangeOfTiles(chosen));
  }

  async function refresh() {
    try {
      await api.indexLibrary();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const indexing = running?.kind === "index";
  const count = tiles?.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Library"
        detail={<Detail count={count} summary={summary} indexing={indexing && count === 0} />}
        actions={
          selected.size > 0 ? (
            <>
              <span className="mr-2 text-[13px] text-muted">
                {countOf(selected.size, "photo", "photos")} selected
              </span>
              <Button variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
              <Button variant="primary" onClick={createTrip}>
                <Icon name="trips" size={16} />
                Create trip
              </Button>
            </>
          ) : (
            <Button onClick={refresh} disabled={running !== null}>
              <Icon name="refresh" size={16} />
              Refresh
            </Button>
          )
        }
      />
      {error && <p className="mx-8 mt-4 text-danger">{error}</p>}
      {settings?.codec_hint_dismissed !== "true" && (
        <CodecHint failed={failedThumbs} onDismiss={() => save("codec_hint_dismissed", "true")} />
      )}

      {tiles !== null && count === 0 && !indexing && (
        <EmptyState title="No photos here yet">
          <p>
            Photo Trips didn&apos;t find any photos or videos in your library folder. Add some, or
            choose a different folder in Settings.
          </p>
        </EmptyState>
      )}
      {tiles !== null && count === 0 && indexing && (
        <EmptyState title="Looking for photos">
          <p>Your library folder is being read. Photos appear here as soon as that finishes.</p>
        </EmptyState>
      )}
      {tiles !== null && count > 0 && (
        <TimelineGrid
          tiles={tiles}
          selected={selected}
          onTileClick={onTileClick}
          onTileMenu={onTileMenu}
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
              label: `Create trip from ${countOf(selected.size, "photo", "photos")}`,
              onSelect: createTrip,
            },
            { label: "Clear selection", onSelect: clearSelection },
          ]}
        />
      )}

      {tiles && open !== null && open < tiles.length && (
        <Viewer tiles={tiles} index={open} onIndex={setOpen} onClose={closeViewer} />
      )}
    </div>
  );
}

function Detail({
  count,
  summary,
  indexing,
}: {
  count: number;
  summary: IndexSummary | null;
  indexing: boolean;
}) {
  if (indexing) return <>Reading your library folder</>;
  const items = `${count.toLocaleString()} ${count === 1 ? "photo or video" : "photos and videos"}`;
  if (!summary || summary.otherFiles === 0) return <>{items}</>;
  return (
    <>
      {items}. {summary.otherFiles.toLocaleString()} other{" "}
      {summary.otherFiles === 1 ? "file is" : "files are"} left alone.
    </>
  );
}
