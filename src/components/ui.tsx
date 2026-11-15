// Small shared building blocks: buttons, page header, empty state.

import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";

/**
 * For the photo grid or move list that fills the rest of a page. It grows into the space left
 * under the page's header and notes, but never below this height, so tall notes (a large text
 * size, a small window) can't squeeze it to nothing; the page scrolls instead.
 *
 * The boxes between the page and the list must not have `min-h-0`, or they shrink and the list
 * overflows them. Without that they size to their content, which would include every row of a
 * virtual list; size containment makes the list count as empty there, so only its minimum height
 * reaches them.
 */
export const LIST_FILL = "min-h-72 flex-1 contain-size";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  // Russian-violet for the main action and outlined white for the rest, as on the website.
  primary: "bg-brand text-white hover:bg-brand-hover disabled:bg-raised disabled:text-faint",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-brand disabled:text-faint disabled:hover:border-line-strong",
  // Underlined so it still reads as something to click without a hover.
  ghost:
    "text-muted underline underline-offset-4 hover:bg-raised hover:text-ink hover:no-underline disabled:text-faint disabled:no-underline",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
};

/**
 * Standard button.
 * @param props - Component props.
 * @param props.variant - visual weight (default secondary)
 * @param props.className - extra classes
 * @returns the button element
 */
export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }): ReactElement {
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-[16px] font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

/**
 * Page title row with optional actions on the right.
 * @param props - Component props.
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
}): ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-8 pt-7 pb-5">
      <div className="min-w-0">
        <h1 className="text-[34px] leading-[1.05] font-extrabold tracking-tight text-brand">
          {title}
        </h1>
        {detail && <p className="mt-2 text-muted">{detail}</p>}
      </div>
      {/* Buttons that don't fit move to the next line whole, rather than breaking their words. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * Centred message for empty pages, phrased as the next step to take.
 * @param props - Component props.
 * @param props.title - what's missing
 * @param props.children - how to fix it (text and buttons)
 * @returns the empty-state element
 */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-[min(6rem,12vh)] text-center">
      <h2 className="text-2xl font-extrabold tracking-tight text-brand">{title}</h2>
      <div className="mt-3 text-muted [&_button]:mt-5">{children}</div>
    </div>
  );
}

/**
 * Thin progress bar with a caption.
 * @param props - Component props.
 * @param props.done - completed units
 * @param props.total - total units (0 = unknown, shows an indeterminate bar)
 * @param props.label - caption under the bar
 * @param props.count - add "done of total" to the caption (default true)
 * @returns the progress element
 */
export function Progress({
  done,
  total,
  label,
  count = true,
}: {
  done: number;
  total: number;
  label: string;
  count?: boolean;
}): ReactElement {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;
  return (
    <div className="w-full">
      <div className="h-2 overflow-hidden rounded-full bg-raised">
        <div
          className={`h-full bg-accent transition-[width] ${pct === null ? "w-1/3 animate-pulse" : ""}`}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[14px] text-muted">
        {label}
        {count && pct !== null && ` - ${done.toLocaleString()} of ${total.toLocaleString()}`}
      </p>
    </div>
  );
}
