// Small shared building blocks: buttons, page header, empty state.

import { useContext, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { JOB_NAMES, JobsContext } from "../lib/useJobs";
import { Icon } from "./Icon";

/**
 * For the photo grid or move list that fills the rest of a page. It grows into the space left
 * under the page's header and notes, so the page itself doesn't scroll while everything fits. It
 * never goes below 60% of the window (or 18rem), so tall notes (Details open, a large text size,
 * a small window) can't squeeze it to a strip; the page scrolls instead.
 *
 * The boxes between the page and the list must not have `min-h-0`, or they shrink and the list
 * overflows them. Without that they size to their content, which would include every row of a
 * virtual list; size containment makes the list count as empty there, so only its minimum height
 * reaches them.
 */
export const LIST_FILL = "min-h-[max(18rem,60vh)] flex-1 contain-size";

/**
 * A hover mark for a photo tile: a thin ring inside its edge, drawn by `::after` so it sits over
 * the picture and doesn't clash with a selection ring on the tile itself. Fading the photo on
 * hover reads as a web page; desktop photo apps outline it. The element must be positioned.
 */
export const HOVER_RING =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:opacity-0 after:ring-2 after:ring-ink/40 after:transition-opacity after:ring-inset hover:after:opacity-100";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  // Violet for the main action, filled grey for the rest, and no fill at all for minor ones.
  // Each gets a deeper fill while pressed, so a click is seen to land.
  primary:
    "bg-brand text-white hover:bg-brand-hover enabled:active:brightness-90 disabled:bg-raised disabled:text-faint",
  secondary:
    "border border-line-strong/60 bg-raised text-ink hover:border-line-strong hover:bg-line enabled:active:bg-line-strong/50 disabled:text-faint disabled:hover:border-line-strong/60 disabled:hover:bg-raised",
  ghost:
    "text-muted hover:bg-raised hover:text-ink enabled:active:bg-line disabled:text-faint disabled:hover:bg-transparent",
  danger:
    "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/15 enabled:active:bg-danger/25",
};

/**
 * Standard button. Disabled while a background job runs, it says which job in its tooltip
 * unless it has a title of its own, since most buttons wait for the job to finish.
 * @param props - Component props.
 * @param props.variant - visual weight (default secondary)
 * @param props.className - extra classes
 * @returns the button element
 */
export function Button({
  variant = "secondary",
  className = "",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant }): ReactElement {
  // Read without useJobs, which throws, so a button outside the jobs provider still works.
  const running = useContext(JobsContext)?.running;
  const waiting =
    rest.disabled && running
      ? `Busy: ${(JOB_NAMES[running.kind] ?? "working").toLowerCase()}`
      : undefined;
  return (
    <button
      type="button"
      title={waiting}
      className={`inline-flex min-h-8.5 items-center justify-center gap-2 rounded-md px-3.5 py-1.5 text-[15px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

/**
 * The toolbar along the top of a page: its name, a short note beside it (a count, say), and
 * actions on the right. It stays in view while the page scrolls.
 * @param props - Component props.
 * @param props.title - page title
 * @param props.detail - a short note after the title
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
    <header className="sticky top-0 z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-2">
      <div className="flex min-w-0 flex-1 basis-60 flex-wrap items-baseline gap-x-3">
        <h1 className="text-[20px] font-semibold">{title}</h1>
        {detail && <p className="text-[14px] text-muted">{detail}</p>}
      </div>
      {/* Buttons that don't fit move to the next line whole, rather than breaking their words. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * The top of a review (an import, a sort, duplicates): a one-line headline and totals, with the
 * fuller notes folded away under Details, so the photos or moves below get the room.
 * @param props - Component props.
 * @param props.title - the headline
 * @param props.summary - a short line or two under it (totals, a folder path)
 * @param props.notes - the fuller notes, one paragraph each, shown when Details is opened
 * @param props.className - extra classes, such as a border
 * @returns the summary section
 */
export function ReviewHead({
  title,
  summary,
  notes,
  className = "",
}: {
  title: ReactNode;
  summary?: ReactNode;
  notes?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <section className={`px-5 pt-3 pb-2 ${className}`}>
      <p className="text-[18px] font-semibold">{title}</p>
      {summary && <div className="mt-0.5 text-[14px] text-muted">{summary}</div>}
      {notes && (
        <details className="group mt-1 text-[14px] text-muted">
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-faint hover:text-ink">
            <Icon
              name="chevron"
              size={14}
              className="shrink-0 transition-transform group-open:rotate-90"
            />
            Details
          </summary>
          <div className="flex max-w-3xl flex-col gap-1 pb-1 pl-5">{notes}</div>
        </details>
      )}
    </section>
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
      <h2 className="text-[20px] font-semibold">{title}</h2>
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
