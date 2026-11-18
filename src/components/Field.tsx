import type { ReactElement, ReactNode } from "react";

/** Classes shared by the text, date and time inputs on trip forms. */
export const INPUT =
  "min-h-8.5 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-ink placeholder:text-faint focus:border-brand-hover focus:outline-none focus:ring-2 focus:ring-brand-hover/30";

/**
 * A form control with its label above it.
 * @param props - Component props.
 * @param props.label - what the control is for
 * @param props.children - the control
 * @returns the label wrapping both
 */
export function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[15px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
