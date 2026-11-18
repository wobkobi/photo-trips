// Settings > About: check for a newer version and install it.

import type { ReactElement } from "react";
import type { UpdateProgress } from "../lib/api";
import { formatBytes } from "../lib/format";
import { parseReleaseNotes } from "../lib/releaseNotes";
import { useAction } from "../lib/useAction";
import { JOB_NAMES } from "../lib/useJobs";
import { useSettings } from "../lib/useSettings";
import { useUpdates } from "../lib/useUpdates";
import { Row, Toggle } from "./SettingParts";
import { Button, Progress } from "./ui";

/**
 * Check for updates, and show a newer version's notes with a button that installs it. Below,
 * the Beta updates switch picks which feed the checks read.
 * @returns the update controls
 */
export function UpdateCheck(): ReactElement {
  const { check, update, progress, error, runCheck, install } = useUpdates();
  const { settings, save } = useSettings();
  const beta = useAction();

  /**
   * Save the switch, then check again so the answer comes from the feed now chosen.
   * @param on - whether to take pre-release versions
   */
  async function setBeta(on: boolean): Promise<void> {
    const saved = await beta.run(() => save("beta_updates", on ? "true" : "false"));
    if (saved && check !== "checking" && progress === null) await runCheck();
  }

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
      <div className="mt-4">
        <Row
          title="Beta updates"
          detail="Try new versions before they're released. They may have bugs."
        >
          <Toggle
            checked={settings?.beta_updates === "true"}
            disabled={settings === null}
            label="Beta updates"
            onChange={(on) => void setBeta(on)}
          />
        </Row>
        {beta.error && (
          <p role="alert" className="text-[15px] text-danger">
            {beta.error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * A release's changes, grouped as in the changelog.
 * @param props - Component props.
 * @param props.notes - the release notes markdown
 * @returns the notes
 */
function Notes({ notes }: { notes: string }): ReactElement {
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
 * @param props - Component props.
 * @param props.progress - the latest install progress
 * @returns the progress element
 */
function InstallProgress({ progress }: { progress: UpdateProgress }): ReactElement {
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
