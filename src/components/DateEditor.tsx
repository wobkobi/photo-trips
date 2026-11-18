import { useState, type ReactElement } from "react";
import { count } from "../lib/format";
import { INPUT } from "./Field";
import { Button, Dialog, DIALOG_BUTTONS } from "./ui";

/** What a datetime-local box holds when filled in: date, hours and minutes. */
const FILLED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * The Set date dialog, for photos whose own date is wrong or a guess. The grid's menu and the
 * viewer both open this one dialog. The date box starts focused, so Enter sets the date.
 * @param props - Component props.
 * @param props.items - how many photos and videos get the date
 * @param props.initial - the date to start from, `YYYY-MM-DDTHH:MM:SS`
 * @param props.busy - a change is being saved, so Set date waits
 * @param props.error - why the last save failed, shown in the dialog since the page behind it
 *   is out of reach
 * @param props.onSave - set this date, `YYYY-MM-DDTHH:MM:SS`
 * @param props.onCancel - close without changing anything
 * @returns the dialog
 */
export function DateEditor({
  items,
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  items: number;
  initial: string;
  busy: boolean;
  error?: string | null;
  onSave: (date: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(initial.slice(0, 16));
  const filled = FILLED.test(value);
  return (
    <Dialog title="Set date" onCancel={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (filled && !busy) onSave(`${value}:00`);
        }}
      >
        <p className="mt-2 text-muted">
          New date for {count(items, "item", "items")}. Only Pic Cabinet uses it; the files
          aren&apos;t changed.
        </p>
        <input
          type="datetime-local"
          aria-label="New date"
          data-autofocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`mt-4 ${INPUT}`}
        />
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
        <div className={DIALOG_BUTTONS}>
          <Button variant="primary" type="submit" disabled={!filled} busy={busy}>
            Set date
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
