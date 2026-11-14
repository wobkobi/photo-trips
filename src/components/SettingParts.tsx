// Building blocks of the Settings page: sections, rows, switches and text boxes that save.

import { useState, type ReactNode } from "react";
import { INPUT } from "./Field";

/**
 * A group of related settings under a heading.
 * @param props.title - section heading
 * @param props.detail - what the section is for, under the heading
 * @param props.error - the last failed save in this section
 * @param props.children - the rows
 * @returns the section element
 */
export function Section({
  title,
  detail,
  error,
  children,
}: {
  title: string;
  detail?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="font-display text-[22px] font-semibold tracking-tight">{title}</h2>
      {detail && <div className="mt-1.5 space-y-2 text-[13px] text-muted">{detail}</div>}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * One setting: title and explanation on the left, control on the right.
 * @param props.title - setting name
 * @param props.detail - what it does
 * @param props.children - the control
 * @returns the row element
 */
export function Row({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-line py-4">
      <div className="min-w-0">
        <h3 className="font-medium">{title}</h3>
        {detail && <p className="mt-1 text-[13px] break-words text-muted">{detail}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * On/off switch.
 * @param props.checked - current state
 * @param props.label - accessible name
 * @param props.disabled - greys the switch out
 * @param props.onChange - called with the new state
 * @returns the switch element
 */
export function Toggle({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full border transition-colors disabled:opacity-40 ${
        checked ? "border-paper bg-paper" : "border-line bg-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-[18px] w-[18px] rounded-full transition-transform ${
          checked ? "translate-x-5 bg-ground" : "bg-muted"
        }`}
      />
    </button>
  );
}

/**
 * A text box that saves when it loses focus or on Enter. Escape puts the saved value back.
 * Assumes nothing else changes the setting while the page is open.
 * @param props.value - the saved value
 * @param props.label - accessible name
 * @param props.placeholder - shown while empty
 * @param props.className - width and other extra classes
 * @param props.tidy - turns typed text into the form that's saved (default: trim)
 * @param props.onSave - called with the tidied text when it differs from the saved value
 * @param props.onRevert - called when Escape puts the saved value back, e.g. to clear an error
 * @returns the input element
 */
export function SavedText({
  value,
  label,
  placeholder,
  className = "",
  tidy = (text) => text.trim(),
  onSave,
  onRevert,
}: {
  value: string;
  label: string;
  placeholder?: string;
  className?: string;
  tidy?: (text: string) => string;
  onSave: (text: string) => void;
  onRevert?: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <input
      type="text"
      spellCheck={false}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const next = tidy(text);
        setText(next);
        if (next !== value) onSave(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setText(value);
          onRevert?.();
          // Blur after the reset lands, so the blur handler sees the saved value and skips saving.
          const input = event.currentTarget;
          requestAnimationFrame(() => input.blur());
        }
      }}
      className={`${INPUT} ${className}`}
    />
  );
}
