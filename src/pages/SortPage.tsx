import { useCallback, useEffect, useState } from "react";
import type { PageId } from "../App";
import { Icon } from "../components/Icon";
import { LeftAlone, MovingProgress, PlanView, ResultBanner } from "../components/PlanPreview";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { api, errorText, type ApplySummary, type Preview } from "../lib/api";
import { count } from "../lib/format";
import { useJobDone, useJobs } from "../lib/useJobs";

/**
 * Sort the library into trip and year/month folders: review every move first, then apply it
 * as one change that can be undone.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function SortPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { running } = useJobs();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);

  const load = useCallback(() => {
    api.planOrganise().then(
      (loaded) => {
        setPreview(loaded);
        setError(null);
        setChecking(false);
      },
      (err) => {
        setError(errorText(err));
        setChecking(false);
      },
    );
  }, []);

  useEffect(load, [load]);
  useJobDone("index", load);
  useJobDone("apply", (done) => {
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setError(done.error);
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  function checkAgain() {
    setChecking(true);
    load();
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const moving = running?.kind === "apply" || running?.kind === "undo";
  const ready = preview !== null && preview.files > 0 && !moving;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sort"
        detail={
          <>
            Every photo and video goes in its trip&apos;s folder, or a folder for the month it was
            taken, like <span className="text-paper">2025\2025-03</span>.
          </>
        }
        actions={
          ready && (
            <>
              <Button onClick={checkAgain} disabled={checking || running !== null}>
                <Icon name="refresh" size={16} />
                Check again
              </Button>
              <Button
                variant="primary"
                onClick={() => run(() => api.applyPlan(preview.id))}
                disabled={checking || running !== null}
              >
                Move {count(preview.files, "file", "files")}
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
      {result && !moving && (
        <ResultBanner
          result={result}
          busy={running !== null}
          onUndo={() => run(() => api.undoBatch(result.batchId))}
          onHistory={() => onNavigate("history")}
        />
      )}

      {moving && running && <MovingProgress job={running} />}
      {!moving && preview === null && !error && (
        <p className="px-8 py-6 text-muted">Working out where everything goes</p>
      )}
      {!moving && preview !== null && preview.files === 0 && <NothingToDo preview={preview} />}
      {ready && <PlanView preview={preview} />}
    </div>
  );
}

function NothingToDo({ preview }: { preview: Preview }) {
  if (preview.inPlace === 0) {
    return (
      <EmptyState title="Nothing to sort">
        <p>Your library folder has no photos or videos yet.</p>
      </EmptyState>
    );
  }
  return (
    <EmptyState title="Everything is in its folder">
      <p>
        {preview.inPlace === 1
          ? "Your one photo is already in its folder."
          : `All ${count(preview.inPlace, "photo", "photos and videos")} are already in their folders.`}
      </p>
      {preview.leftAlone > 0 && <LeftAlone files={preview.leftAlone} />}
    </EmptyState>
  );
}
