import { useState, type ReactElement } from "react";
import { INPUT } from "./Field";
import { Button } from "./ui";

/** What a datetime-local box holds when filled in: date, hours and minutes. */
const FILLED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * A date and time box with Set date and Cancel, for photos whose own date is wrong or a guess.
 * @param props - Component props.
 * @param props.initial - the date to start from, `YYYY-MM-DDTHH:MM:SS`
 * @param props.busy - a change is being saved, so Set date waits
 * @param props.onSave - set this date, `YYYY-MM-DDTHH:MM:SS`
 * @param props.onCancel - close without changing anything
 * @returns the form
 */
export function DateEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave: (date: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial.slice(0, 16));
  const filled = FILLED.test(value);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (filled) onSave(`${value}:00`);
      }}
    >
      <input
        type="datetime-local"
        aria-label="New date"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className={INPUT}
      />
      <Button variant="primary" type="submit" disabled={!filled} busy={busy}>
        Set date
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
