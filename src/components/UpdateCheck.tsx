// Settings > About: check for a newer version and install it.

import type { UpdateProgress } from "../lib/api";
import { formatBytes } from "../lib/format";
import { parseReleaseNotes } from "../lib/releaseNotes";
import { JOB_NAMES } from "../lib/useJobs";
import { useUpdates } from "../lib/useUpdates";
import { Button, Progress } from "./ui";

/**
 * Check for updates, and show a newer version's notes with a button that installs it.
 * @returns the update controls
 */
export function UpdateCheck() {
  const { check, update, progress, error, runCheck, install } = useUpdates();

  return (
    <div className="mt-5 border-t border-line pt-4">
      {update ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h3 className="font-semibold">Version {update.version} is available</h3>
            <Button variant="primary" disabled={progress !== null} onClick={install}>
              Install and restart
            </Button>
          </div>
          {update.notes && <Notes notes={update.notes} />}
          {progress && (
            <div className="mt-4">
              <InstallProgress progress={progress} />
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="text-[15px] text-muted">
            {check === "latest"
              ? "You have the latest version."
              : "Pic Cabinet checks for updates once a day."}
          </p>
          <Button disabled={check === "checking"} onClick={runCheck}>
            {check === "checking" ? "Checking..." : "Check for updates"}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[15px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A release's changes, grouped as in the changelog.
 * @param props.notes - the release notes markdown
 * @returns the notes
 */
function Notes({ notes }: { notes: string }) {
  return (
    <div className="selectable mt-3 space-y-3 text-[15px]">
      {parseReleaseNotes(notes).map((group, i) => (
        <div key={i}>
          {group.heading && <h4 className="font-semibold text-muted">{group.heading}</h4>}
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {group.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Download bar, then what the install is waiting on.
 * @param props.progress - the latest install progress
 * @returns the progress element
 */
function InstallProgress({ progress }: { progress: UpdateProgress }) {
  switch (progress.stage) {
    case "downloading":
      return (
        <Progress
          done={progress.done}
          total={progress.total ?? 0}
          count={false}
          label={
            progress.total
              ? `Downloading ${formatBytes(progress.done)} of ${formatBytes(progress.total)}`
              : "Downloading"
          }
        />
      );
    case "waiting": {
      const task = JOB_NAMES[progress.kind] ?? "the current task";
      return (
        <Progress
          done={0}
          total={0}
          label={`Downloaded. It installs once this is done: ${task.toLowerCase()}.`}
        />
      );
    }
    case "installing":
      return (
        <Progress done={1} total={1} count={false} label="Installing. Pic Cabinet will reopen." />
      );
  }
}
