// Building blocks of the Settings page: sections, rows, switches and text boxes that save.

import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { INPUT } from "./Field";
import { Icon } from "./Icon";

/**
 * A group of related settings under a heading.
 * @param props - Component props.
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
}): ReactElement {
  return (
    <section className="mt-10 first:mt-0">
      <h2 className="text-[18px] font-semibold">{title}</h2>
      {detail && <div className="mt-1 space-y-2 text-[14px] text-muted">{detail}</div>}
      {error && (
        <p role="alert" className="mt-3 text-[15px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * One setting: title and explanation on the left, control on the right.
 * @param props - Component props.
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
}): ReactElement {
  return (
    // The control drops under the words when both can't share a line, rather than squeezing the
    // words to one per line.
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line py-4">
      <div className="min-w-0 flex-1 basis-60">
        <h3 className="font-semibold">{title}</h3>
        {detail && <p className="mt-0.5 text-[14px] wrap-break-word text-muted">{detail}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * On/off switch with its state written beside it, so it doesn't rely on position or colour.
 * @param props - Component props.
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
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center gap-3 rounded-lg px-1 disabled:opacity-40"
    >
      <span className="w-8 text-right text-[16px] font-semibold" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
      <span
        className={`relative h-8 w-14 rounded-full border-2 transition-colors ${
          checked ? "border-brand bg-brand" : "border-line-strong bg-raised"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full transition-transform ${
            checked ? "translate-x-6 bg-white" : "bg-muted"
          }`}
        />
      </span>
    </button>
  );
}

/**
 * A text box that saves when it loses focus or on Enter. Escape puts the saved value back.
 * Assumes nothing else changes the setting while the page is open.
 * @param props - Component props.
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
}): ReactElement {
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

/**
 * A setting picked from a few named sizes, shown as a row of large buttons with the title and
 * explanation above, so every option is visible without opening a list. Arrow keys move between
 * options, as in any radio group.
 * @param props - Component props.
 * @param props.title - setting name
 * @param props.detail - what it does
 * @param props.value - the chosen option's value
 * @param props.options - the options, each with a value, a label and an optional sample to show
 * @param props.onChange - called with the newly chosen value
 * @returns the row element
 */
export function Choices({
  title,
  detail,
  value,
  options,
  onChange,
}: {
  title: string;
  detail?: ReactNode;
  value: string;
  options: { value: string; label: string; sample?: ReactNode }[];
  onChange: (value: string) => void;
}): ReactElement {
  /**
   * Arrow keys pick the next or previous option, wrapping round, and move focus with it.
   * @param event - the key press on the radio group
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = options.findIndex((option) => option.value === value);
    const next = options[(at + step + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
    buttons[options.indexOf(next)]?.focus();
  }

  return (
    <div className="border-t border-line py-4">
      <h3 className="font-semibold">{title}</h3>
      {detail && <p className="mt-0.5 text-[14px] text-muted">{detail}</p>}
      <div
        role="radiogroup"
        aria-label={title}
        onKeyDown={onKeyDown}
        className="mt-3 flex flex-wrap gap-2"
      >
        {options.map((option) => {
          const chosen = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={chosen}
              tabIndex={chosen ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={`flex min-h-11 min-w-24 flex-col items-center justify-end gap-1.5 rounded-md border px-3 py-2.5 text-[14px] transition-colors ${
                chosen
                  ? "border-accent bg-accent/10 font-semibold text-ink ring-1 ring-accent"
                  : "border-line bg-raised/50 text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {option.sample}
              <span className="flex items-center gap-1.5">
                {chosen && <Icon name="check" size={16} />}
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
