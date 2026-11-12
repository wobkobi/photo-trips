import { useCallback, useEffect, useState } from "react";
import { CodecHint } from "../components/CodecHint";
import { Icon } from "../components/Icon";
import { TimelineGrid } from "../components/TimelineGrid";
import { Viewer } from "../components/Viewer";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { api, errorText, type IndexSummary, type Tile } from "../lib/api";
import { useJobDone, useJobs } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";

/** The whole library as a month-by-month timeline, with a viewer for single photos. */
export function LibraryPage() {
  const { settings, save } = useSettings();
  const { running } = useJobs();
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [summary, setSummary] = useState<IndexSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<Tile[]>([]);

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

  const onThumbError = useCallback(
    (tile: Tile) => setFailedThumbs((prev) => (prev.length >= 50 ? prev : [...prev, tile])),
    [],
  );
  const closeViewer = useCallback(() => setOpen(null), []);

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
          <Button onClick={refresh} disabled={running !== null}>
            <Icon name="refresh" size={16} />
            Refresh
          </Button>
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
        <TimelineGrid tiles={tiles} onOpen={setOpen} onThumbError={onThumbError} />
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
