import type { KeyboardEvent, ReactElement } from "react";
import { PHOTO_SIZES, stepPhotoSize } from "../lib/display";

/**
 * Photo size for the grid toolbar: one small button per size, each a square drawn in proportion
 * to its tiles. Arrow keys step between them, held at either end like Ctrl+wheel.
 * @param props - Component props.
 * @param props.value - the size on show, a {@link PHOTO_SIZES} value
 * @param props.onChange - called with the size picked
 * @returns the control
 */
export function PhotoSizeControl({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  /**
   * Arrow keys pick the next size up or down and move focus with it.
   * @param event - the key press on the group
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Alt+arrows are the app's Back and Forward.
    if (event.altKey) return;
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = stepPhotoSize(value, step);
    onChange(next);
    const at = PHOTO_SIZES.findIndex((size) => size.value === next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[at]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Photo size"
      onKeyDown={onKeyDown}
      className="flex items-center rounded-md border border-line-strong/60"
    >
      {PHOTO_SIZES.map((size) => {
        const chosen = size.value === value;
        const edge = Math.round(size.tile / 18);
        return (
          <button
            key={size.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={`${size.label} photos`}
            title={`${size.label} photos (Ctrl+wheel)`}
            tabIndex={chosen ? 0 : -1}
            onClick={() => onChange(size.value)}
            className={`flex size-8 items-center justify-center rounded-[5px] transition-colors ${
              chosen ? "bg-line text-ink" : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className="rounded-xs bg-current"
              style={{ width: edge, height: edge }}
            />
          </button>
        );
      })}
    </div>
  );
}
