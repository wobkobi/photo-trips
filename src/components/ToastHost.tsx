import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import type { PageId } from "../App";
import { api, errorText } from "../lib/api";
import type { Toast } from "../lib/toastQueue";
import { useJobs } from "../lib/useJobs";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useToastList } from "../lib/useToasts";
import { Icon } from "./Icon";
import { Button } from "./ui";

/** How long a toast with nothing wrong stays, in ms, counted afresh after each hover or focus. */
const FADE_AFTER_MS = 6000;
/** Length of the fade out, in ms; matches `duration-200` below. */
const FADE_MS = 200;

/**
 * The toasts reporting finished changes, along the foot of the window. Mount once.
 *
 * On the body, outside the app's root, so they stay usable over the photo viewer, which makes
 * the root inert; above the viewer but below menus. Not modal: they never take focus, and a
 * dialog's backdrop covers them like the rest of the window. The stack is one live region, so a
 * screen reader reads each new result without moving there.
 * @param props - Component props.
 * @param props.onShow - open a page, for a toast's Show or History button
 * @returns the toast stack
 */
export function ToastHost({ onShow }: { onShow: (page: PageId) => void }): ReactElement {
  const { toasts, dismiss } = useToastList();

  // Escape on a focused toast dismisses it, and nothing else: the viewer and the Library's
  // selection catch Escape on the window's capture phase, ahead of the toast's own handler. This
  // listener is added once when the shell first draws, before theirs, so it runs first.
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  });
  useEffect(() => {
    /**
     * Dismiss the focused toast on Escape.
     * @param event - the window's keydown, caught before any other capture listener
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape" || !(event.target instanceof Element)) return;
      const toast = event.target.closest<HTMLElement>("[data-toast]");
      if (!toast) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      dismissRef.current(Number(toast.dataset.toast));
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div
      role="status"
      aria-label="Results"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-45 flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onShow={onShow} />
      ))}
    </div>,
    document.body,
  );
}

/**
 * One toast: what happened, Undo while the batch can still be put back, a link, and a close
 * button. One with nothing wrong fades after a few seconds unless the pointer or focus is on it.
 * @param props - Component props.
 * @param props.toast - the toast
 * @param props.onShow - open a page, for the link
 * @returns the toast
 */
function ToastCard({
  toast,
  onShow,
}: {
  toast: Toast;
  onShow: (page: PageId) => void;
}): ReactElement {
  const { dismiss, fail } = useToastList();
  const { running } = useJobs();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const held = hovered || focused;

  useEffect(() => {
    if (toast.problem || held || leaving) return;
    const timer = window.setTimeout(() => setLeaving(true), FADE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [toast.problem, held, leaving]);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => dismiss(toast.id), reduced ? 0 : FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving, reduced, dismiss, toast.id]);

  /** Put the batch back; the undo job's end removes this toast. */
  function undo(): void {
    if (toast.batchId === null) return;
    api.undoBatch(toast.batchId).catch((err) => fail(toast.id, errorText(err)));
  }

  return (
    <div
      data-toast={toast.id}
      // The pointer or focus coming back while it fades keeps it.
      onMouseEnter={() => {
        setHovered(true);
        setLeaving(false);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        setLeaving(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
      className={`pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-surface py-2.5 pr-2.5 pl-4 text-ink shadow-lg shadow-black/50 transition-opacity duration-200 motion-safe:animate-toast-in ${
        toast.problem ? "border-warn-line" : "border-line"
      } ${leaving ? "opacity-0" : ""}`}
    >
      <Icon
        name={toast.problem ? "warn" : "check"}
        className={`shrink-0 ${toast.problem ? "text-warn" : "text-accent"}`}
      />
      <p className="min-w-0 flex-1 basis-48 text-[14px]">{toast.text}</p>
      <div className="flex items-center gap-1.5">
        {toast.batchId !== null && (
          <Button onClick={undo} busy={running !== null}>
            <Icon name="undo" size={16} />
            Undo
          </Button>
        )}
        {toast.link && (
          <Button
            variant="ghost"
            onClick={() => {
              if (toast.link) onShow(toast.link.page);
              dismiss(toast.id);
            }}
          >
            {toast.link.label}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => dismiss(toast.id)}
          aria-label="Dismiss"
          title="Dismiss (Esc)"
          className="px-2"
        >
          <Icon name="close" size={16} />
        </Button>
      </div>
    </div>
  );
}
