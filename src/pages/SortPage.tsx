import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
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
 * @param props - Component props.
 * @param props.onNavigate - switch to another page
 * @returns the page
 */
export function SortPage({ onNavigate }: { onNavigate: (page: PageId) => void }): ReactElement {
  const { running } = useJobs();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);
  /** Photos unticked to stay where they are, by media id. A new plan ticks everything again. */
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(new Set());

  const load = useCallback(() => {
    api.planOrganise().then(
      (loaded) => {
        setPreview(loaded);
        setSkipped(new Set());
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
  useJobDone(["index", "remove", "import", "inbox"], load);
  useJobDone("apply", (done) => {
    if (done.ok) setResult(done.result as ApplySummary);
    else if (done.error) setError(done.error);
    load();
  });
  useJobDone("undo", () => {
    setResult(null);
    load();
  });

  /** Work the plan out again, showing the buttons as busy until it's back. */
  function checkAgain(): void {
    setChecking(true);
    load();
  }

  /**
   * Run an action, showing any failure as the page error.
   * @param action - the API call to make
   */
  async function run(action: () => Promise<void>): Promise<void> {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    }
  }

  /**
   * Tick or untick one photo.
   * @param id - its media id
   */
  function toggle(id: number): void {
    const next = new Set(skipped);
    if (!next.delete(id)) next.add(id);
    setSkipped(next);
  }

  // Each unticked photo keeps its companions with it.
  const files = useMemo(
    () =>
      (preview?.items ?? []).reduce(
        (sum, item) => (skipped.has(item.id) ? sum : sum + 1 + item.extra),
        0,
      ),
    [preview, skipped],
  );
  const moving = running?.kind === "apply" || running?.kind === "undo";
  const ready = preview !== null && preview.files > 0 && !moving;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Sort"
        actions={
          ready && (
            <>
              {skipped.size > 0 && (
                <Button variant="ghost" onClick={() => setSkipped(new Set())}>
                  Tick all
                </Button>
              )}
              <Button onClick={checkAgain} disabled={checking || running !== null}>
                <Icon name="refresh" size={16} />
                Check again
              </Button>
              <Button
                variant="primary"
                onClick={() => run(() => api.applyPlan(preview.id, [...skipped]))}
                disabled={checking || running !== null || files === 0}
              >
                Move {count(files, "file", "files")}
              </Button>
            </>
          )
        }
      />
      {error && (
        <p role="alert" className="mx-5 mt-3 text-danger">
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
      {ready && <PlanView preview={preview} skipped={skipped} onToggle={toggle} />}
    </div>
  );
}

/**
 * Shown when every photo is already where the plan would put it, or the library is empty.
 * @param props - Component props.
 * @param props.preview - the plan with no moves in it
 * @returns the empty state
 */
function NothingToDo({ preview }: { preview: Preview }): ReactElement {
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
