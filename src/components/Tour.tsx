import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import type { PageId } from "../App";
import { Button } from "./ui";

/** One stop on the tour; `page` is the menu item it rings. */
interface Step {
  title: string;
  text: string;
  page: PageId | null;
}

const STEPS: Step[] = [
  {
    title: "Welcome to Pic Cabinet",
    text: "A quick look at what's where. It takes a minute.",
    page: null,
  },
  {
    title: "Library",
    text: "Everything in your library, newest first. Click a photo to see it full size.",
    page: "library",
  },
  {
    title: "Sort",
    text: "Files photos into year and month folders. You see every move before it happens.",
    page: "sort",
  },
  {
    title: "Trips",
    text: "Give a trip a name and dates, and its photos get their own folder. Suggestions spots ones you haven't added.",
    page: "trips",
  },
  {
    title: "Import",
    text: "Bring photos in from a memory card, a phone or a folder. Ones you already have are skipped.",
    page: "import",
  },
  {
    title: "History",
    text: "Every change Pic Cabinet makes can be undone here.",
    page: "history",
  },
  {
    title: "That's it",
    text: "Help has more on each page, and the tour is there to take again.",
    page: "help",
  },
];

/**
 * A short tour of the menu, shown once after setup and again from Help. Each step rings the menu
 * item it describes; the dialog sits over the page, so the menu stays in view.
 * @param props - Component props.
 * @param props.onStep - called with the menu item the step points at, or null
 * @param props.onClose - called when the tour is finished or skipped
 * @param props.onHelp - finish the tour and open Help
 * @returns the tour dialog
 */
export function Tour({
  onStep,
  onClose,
  onHelp,
}: {
  onStep: (page: PageId | null) => void;
  onClose: () => void;
  onHelp: () => void;
}): ReactElement {
  const [index, setIndex] = useState(0);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;
  const titleId = useId();
  const primary = useRef<HTMLButtonElement>(null);

  // Ring the step's menu item, and scroll it into view on a short window.
  useEffect(() => {
    onStep(step.page);
    if (step.page) {
      document.querySelector(`[data-nav="${step.page}"]`)?.scrollIntoView({ block: "nearest" });
    }
    primary.current?.focus();
  }, [step.page, onStep]);

  // Unring the menu when the tour goes away.
  useEffect(() => () => onStep(null), [onStep]);

  useEffect(() => {
    /**
     * Escape skips the tour.
     * @param event - the key press
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-lg shadow-black/50"
      >
        <p className="text-[14px] font-semibold text-faint">
          {index + 1} of {STEPS.length}
        </p>
        <h2 id={titleId} className="mt-1 text-[20px] font-semibold">
          {step.title}
        </h2>
        <p className="mt-2 text-muted">{step.text}</p>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {!last && (
            <Button variant="ghost" className="mr-auto" onClick={onClose}>
              Skip
            </Button>
          )}
          {index > 0 && <Button onClick={() => setIndex(index - 1)}>Back</Button>}
          {last ? (
            <>
              <Button onClick={onHelp}>Open Help</Button>
              <Button ref={primary} variant="primary" onClick={onClose}>
                Done
              </Button>
            </>
          ) : (
            <Button ref={primary} variant="primary" onClick={() => setIndex(index + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
