// Small shared building blocks: buttons, page header, empty state.

import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  // Primary is inverted paper-on-graphite: colour stays reserved for trips.
  primary: "bg-paper text-ground hover:bg-white disabled:bg-raised disabled:text-faint",
  secondary:
    "bg-raised text-paper hover:bg-line disabled:text-faint disabled:hover:bg-raised border border-line",
  ghost: "text-muted hover:text-paper hover:bg-raised disabled:text-faint",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 border border-danger/40",
};

/**
 * Standard button.
 * @param props.variant - visual weight (default secondary)
 * @param props.className - extra classes
 * @returns the button element
 */
export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

/**
 * Page title row with optional actions on the right.
 * @param props.title - page title
 * @param props.detail - one line under the title
 * @param props.actions - buttons for the right side
 * @returns the header element
 */
export function PageHeader({
  title,
  detail,
  actions,
}: {
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 pt-7 pb-5">
      <div>
        <h1 className="font-display text-[34px] leading-none font-semibold tracking-tight">
          {title}
        </h1>
        {detail && <p className="mt-2 text-muted">{detail}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Centred message for empty pages, phrased as the next step to take.
 * @param props.title - what's missing
 * @param props.children - how to fix it (text and buttons)
 * @returns the empty-state element
 */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <div className="mt-3 text-muted [&_button]:mt-5">{children}</div>
    </div>
  );
}

/**
 * Thin progress bar with a caption.
 * @param props.done - completed units
 * @param props.total - total units (0 = unknown, shows an indeterminate bar)
 * @param props.label - caption under the bar
 * @returns the progress element
 */
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="w-full">
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full bg-paper transition-[width] ${pct === null ? "w-1/3 animate-pulse" : ""}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {label}
        {pct !== null && total > 0 && ` - ${done.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
    </div>
  );
}
