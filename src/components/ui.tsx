// Small shared building blocks: buttons, page header, dialog, empty state.

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { layers } from "../lib/layers";
import { historyStepForButton, historyStepForKey, isTextEntry, modalOnScreen } from "../lib/menu";
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
 * Standard button. One held back by `busy` while a background job runs says which job in its
 * tooltip, unless it has a title of its own; one disabled for any other reason says nothing.
 * @param props - Component props.
 * @param props.variant - visual weight (default secondary)
 * @param props.className - extra classes
 * @param props.busy - disabled because work is under way; the tooltip names a running job
 * @param props.disabled - disabled for a reason other than work under way; no tooltip
 * @returns the button element
 */
export function Button({
  variant = "secondary",
  className = "",
  busy = false,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; busy?: boolean }): ReactElement {
  // Read without useJobs, which throws, so a button outside the jobs provider still works.
  const running = useContext(JobsContext)?.running;
  const waiting =
    busy && !disabled && running
      ? `Busy: ${(JOB_NAMES[running.kind] ?? "working").toLowerCase()}`
      : undefined;
  return (
    <button
      type="button"
      title={waiting}
      disabled={busy || disabled}
      className={`inline-flex min-h-8.5 items-center justify-center gap-2 rounded-md px-3.5 py-1.5 text-[15px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}

/**
 * The toolbar along the top of a page: its name, a short note beside it (a count, say), and
 * actions on the right. It stays in view while the page scrolls.
 *
 * A sub-step of a page (a review, a form) passes `onBack`, which puts a back arrow before the
 * title and makes Escape, Alt+Left and the mouse's back button step back too, ahead of the app's
 * own back through the places visited. The keys are left alone when something else has already
 * handled them, when they're for a box being typed in, and while a modal (the photo viewer, the
 * tour, an open dialog) is on screen, since it handles its own keys.
 *
 * A step holding work that stepping back would lose (a changed form, an import being checked)
 * passes `backKeys={false}`: only the arrow steps back, and Alt+Left and the mouse's back button
 * are marked used without moving, so the app's own back doesn't leave the page either.
 *
 * After a back, focus that was in the header or went with the old step moves to the new step's
 * title, so the keyboard carries on from the top of the page rather than from nowhere.
 * @param props - Component props.
 * @param props.title - page title, or the step's name on a sub-step
 * @param props.detail - a short note after the title
 * @param props.actions - buttons for the right side
 * @param props.onBack - leave the sub-step for the screen it came from; omit on a top-level page
 * @param props.backKeys - whether Escape, Alt+Left and the mouse's back button step back too
 *   (default true); false keeps them from leaving a step with unsaved work
 * @returns the header element
 */
export function PageHeader({
  title,
  detail,
  actions,
  onBack,
  backKeys = true,
}: {
  title: string;
  detail?: ReactNode;
  actions?: ReactNode;
  onBack?: () => void;
  backKeys?: boolean;
}): ReactElement {
  // The listener reads the latest handler from the ref, so it's only added and removed when the
  // back arrow comes and goes, not on every render that passes a new function.
  const back = useRef(onBack);
  useEffect(() => {
    back.current = onBack;
  });
  const header = useRef<HTMLElement>(null);
  // Step back, then once the next step has drawn, move focus to its title if focus is in the
  // header or went with the old step. Focus the next step put somewhere itself stays there. The
  // page may have changed, so the title is looked up afresh.
  const goBack = useCallback(() => {
    back.current?.();
    requestAnimationFrame(() => {
      const now = document.activeElement;
      const lost = now === null || now === document.body || !now.isConnected;
      if (!lost && !header.current?.contains(now)) return;
      document.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
    });
  }, []);
  const hasBack = onBack !== undefined;
  useEffect(() => {
    if (!hasBack) return;
    /**
     * Escape or Alt+Left steps back. A held key steps back once, not through every step.
     * @param event - the document's keydown
     */
    function onKey(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey) return;
      if (event.shiftKey || isTextEntry(event.target) || modalOnScreen()) return;
      const altLeft = historyStepForKey(event) === "back";
      if (!backKeys) {
        // Kept from the app's history back too, which would leave the page and the work.
        if (altLeft) event.preventDefault();
        return;
      }
      const escape = event.key === "Escape" && !event.altKey;
      if (!escape && !altLeft) return;
      // Marks the key as used, so a page's own Escape handler (clearing a selection) and the
      // app's history back both skip it.
      event.preventDefault();
      goBack();
    }
    /**
     * The mouse's back button steps back, as Alt+Left does.
     * @param event - the document's mouseup
     */
    function onMouse(event: MouseEvent): void {
      if (event.defaultPrevented || historyStepForButton(event.button) !== "back") return;
      if (modalOnScreen()) return;
      event.preventDefault();
      if (backKeys) goBack();
    }
    // On the document rather than the window, so these run before the app's history back and
    // forward, which listen on the window and leave a key or button already used here alone.
    document.addEventListener("keydown", onKey);
    document.addEventListener("mouseup", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mouseup", onMouse);
    };
  }, [hasBack, backKeys, goBack]);

  return (
    <header
      ref={header}
      className="sticky top-0 z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-5 py-2"
    >
      <div className="flex min-w-0 flex-1 basis-60 flex-wrap items-baseline gap-x-3">
        {hasBack && (
          // Negative margins keep the button within the title's line height, so centring it on
          // that line lines its arrow up with the title's letters rather than pushing them down.
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            title={backKeys ? "Back (Esc)" : "Back"}
            className="-my-1 -mr-1 -ml-1.5 inline-flex size-8 shrink-0 items-center justify-center self-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink active:bg-line"
          >
            <Icon name="back" size={20} />
          </button>
        )}
        <h1 tabIndex={-1} className="text-[20px] font-semibold outline-none">
          {title}
        </h1>
        {detail && <p className="text-[14px] text-muted">{detail}</p>}
      </div>
      {/* Buttons that don't fit move to the next line whole, rather than breaking their words. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** The button row along the foot of a {@link Dialog}: the main action first, then Cancel. */
export const DIALOG_BUTTONS = "mt-6 flex flex-wrap items-center justify-end gap-2";

/**
 * A question or small form over everything else, the photo viewer and menus included, on a
 * native `<dialog>` shown modal: the browser keeps focus inside it and makes the rest of the
 * window inert. The component that owns the question renders it while the question is open.
 *
 * Focus starts on the element marked `data-autofocus` (the main button, or the box to type in),
 * so Enter answers at once, and goes back to what had it when the dialog closes. Escape cancels.
 *
 * Keys pressed in the dialog stop here, as a Windows dialog holds its window's keys, so the
 * page's own shortcuts (Delete, Ctrl+A, the viewer's zoom) don't act behind it. Handlers that
 * listen on the window's capture phase run before the dialog sees a key, so those check the
 * layer stack in `layers.ts` and stand aside while a dialog is open over them.
 * @param props - Component props.
 * @param props.title - the dialog's heading, which also names it to screen readers
 * @param props.children - the text and buttons; {@link DIALOG_BUTTONS} lays out the button row
 * @param props.onCancel - close without doing anything, from Escape or the owner's Cancel button
 * @returns the dialog element
 */
export function Dialog({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Layout effect, so the dialog is modal and on the layer stack before the next key arrives.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const layer = layers.push();
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")?.focus();
    return () => {
      dialog.close();
      layers.pop(layer);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // On the body, outside the app's root, so it stays usable while the viewer makes the root inert.
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // React's stopPropagation also stops the native event at the body, so the document
      // and window listeners behind never see it. Escape cancels here rather than through the
      // browser's own close, which can shut the dialog while its owner still has it open.
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-6 text-ink shadow-lg shadow-black/50 backdrop:bg-black/60 motion-safe:animate-dialog-in"
    >
      <h2 id={titleId} className="text-[20px] font-semibold">
        {title}
      </h2>
      {children}
    </dialog>,
    document.body,
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
