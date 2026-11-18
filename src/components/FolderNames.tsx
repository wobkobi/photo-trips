import { useState, type ReactElement } from "react";
import { api, errorText, type Naming, type Preview } from "../lib/api";
import { MONTH_STYLES, monthFolder, namingOf, TRIP_STYLES, tripFolder } from "../lib/naming";
import { useSettings } from "../lib/useSettings";
import { INPUT } from "./Field";
import { Row, Section } from "./SettingParts";
import { Button } from "./ui";

/** Every example uses a photo from 12 March of this year, and a trip to Japan starting then. */
const EXAMPLE_YEAR = new Date().getFullYear();
const EXAMPLE_DAY = `${EXAMPLE_YEAR}-03-12`;
/** A trip over New Year, which a year-named folder gives both years. */
const NEW_YEAR_START = `${EXAMPLE_YEAR}-12-28`;
const NEW_YEAR_END = `${EXAMPLE_YEAR + 1}-01-03`;

/**
 * Settings section for how month and trip folders are named. Each drop-down lists its presets
 * as example folders, and a sentence underneath shows where a photo and a trip would go. A
 * change only takes effect through a previewed batch that renames the folders already there.
 * @param props - Component props.
 * @param props.busy - a job or check is running, so the button waits
 * @param props.onReview - called with the preview of the renames
 * @returns the section
 */
export function FolderNames({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: (preview: Preview) => void;
}): ReactElement {
  const { settings } = useSettings();
  const saved = namingOf(settings);
  const [picked, setPicked] = useState<Naming | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const naming = picked ?? saved;
  const changed = naming.months !== saved.months || naming.trips !== saved.trips;

  /**
   * Pick a naming to preview, clearing the last error.
   * @param next - the month and trip styles chosen
   */
  function choose(next: Naming): void {
    setError(null);
    setPicked(next);
  }

  /** Plan the renames for the picked naming and hand the preview on for review. */
  async function check(): Promise<void> {
    setError(null);
    setChecking(true);
    try {
      onReview(await api.planNaming(naming));
      setPicked(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <Section
      title="Folder names"
      detail="How the folders photos are sorted into are named. A change renames the folders already in your library too, once you've checked the moves."
      error={error}
    >
      <Row title="Month folders" detail="Inside a folder for each year.">
        <select
          aria-label="Month folders"
          value={naming.months}
          onChange={(e) => choose({ ...naming, months: e.target.value as Naming["months"] })}
          className={INPUT}
        >
          {MONTH_STYLES.map((style) => (
            <option key={style} value={style}>
              {monthFolder(style, EXAMPLE_DAY)}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Trip folders" detail="Inside the Trips folder.">
        <select
          aria-label="Trip folders"
          value={naming.trips}
          onChange={(e) => choose({ ...naming, trips: e.target.value as Naming["trips"] })}
          className={INPUT}
        >
          {TRIP_STYLES.map((style) => (
            <option key={style} value={style}>
              {tripFolder(style, EXAMPLE_DAY, "Japan")}
            </option>
          ))}
        </select>
      </Row>
      <div className="flex flex-col gap-1 border-t border-line pt-4 text-[15px]">
        <p>
          A photo taken on 12 March {EXAMPLE_YEAR} goes in{" "}
          <span className="selectable font-semibold">
            {monthFolder(naming.months, EXAMPLE_DAY)}
          </span>
          .
        </p>
        <p>
          A trip called Japan starting that day goes in{" "}
          <span className="selectable font-semibold">
            {tripFolder(naming.trips, EXAMPLE_DAY, "Japan")}
          </span>
          . If two trips would get the same folder name, the later one has (2) added.
        </p>
        <p>
          One called Tairua from 28 December to 3 January goes in{" "}
          <span className="selectable font-semibold">
            {tripFolder(naming.trips, NEW_YEAR_START, "Tairua", NEW_YEAR_END)}
          </span>
          .
        </p>
      </div>
      {changed && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={check} disabled={checking} busy={busy}>
            Check the moves
          </Button>
          <Button variant="ghost" onClick={() => choose(saved)} disabled={checking}>
            Keep the names as they are
          </Button>
        </div>
      )}
    </Section>
  );
}
