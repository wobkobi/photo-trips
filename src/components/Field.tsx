import type { ReactNode } from "react";

/** Classes shared by the text, date and time inputs on trip forms. */
export const INPUT =
  "rounded-md border border-line-strong bg-surface px-3 py-1.5 text-ink placeholder:text-faint focus:border-accent focus:outline-none";

/**
 * A form control with its label above it.
 * @param props.label - what the control is for
 * @param props.children - the control
 * @returns the label wrapping both
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
