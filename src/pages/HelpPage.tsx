import type { ReactElement } from "react";
import type { PageId } from "../App";
import { Icon, type IconName } from "../components/Icon";
import { Button, PageHeader } from "../components/ui";

/** What each page is for, in menu order. */
const PAGES: { id: PageId; title: string; icon: IconName; text: string }[] = [
  {
    id: "library",
    title: "Library",
    icon: "library",
    text: "Everything in your library, newest first. Filter by year or type, and click a photo to see it full size.",
  },
  {
    id: "trips",
    title: "Trips",
    icon: "trips",
    text: "Name a trip and pick its first and last day. Photos from those days get their own folder. The newest trips are listed in the menu under Trips.",
  },
  {
    id: "import",
    title: "Import",
    icon: "import",
    text: "Imports photos from a memory card, a phone or a folder. Ones already in your library are skipped, and nothing on the card or phone changes.",
  },
  {
    id: "sort",
    title: "Sort",
    icon: "sort",
    text: "Moves photos and videos into year and month folders, and trip photos into Trips. You see every move before anything changes.",
  },
  {
    id: "suggestions",
    title: "Suggestions",
    icon: "suggest",
    text: "Busy stretches, or days away from home, that could be trips. Make one a trip or dismiss it.",
  },
  {
    id: "duplicates",
    title: "Duplicates",
    icon: "duplicates",
    text: "Finds exact copies and sends the extras to the Recycle Bin, keeping one.",
  },
  {
    id: "history",
    title: "History",
    icon: "history",
    text: "Every change Pic Cabinet makes. Undo puts the files back where they were.",
  },
  {
    id: "settings",
    title: "Settings",
    icon: "settings",
    text: "The library folder, inbox folders, folder names, text size and updates.",
  },
];

/** Keyboard shortcuts, as bound in menu.rs and menu.ts. */
const SHORTCUTS: [keys: string, does: string][] = [
  ["Ctrl+1 to Ctrl+7", "Library to History"],
  ["Ctrl+I", "Import"],
  ["F5", "Refresh"],
  ["Ctrl+F", "Find"],
  ["Ctrl+Z", "Undo the last change, after asking"],
  ["Ctrl+,", "Settings"],
  ["F1", "Help"],
  ["Arrow keys", "Move between photos in the Library"],
  ["Ctrl+A", "Select every item shown in the Library"],
  ["Delete", "Send the selected items to the Recycle Bin"],
  ["Left and Right", "Previous and next photo, full size"],
  ["Home and End", "First and last photo, full size"],
  ["+ and -", "Zoom in and out on a photo, full size"],
  ["0", "Fit the photo to the window again"],
  ["R", "Rotate a photo, full size"],
  ["Esc", "Close a photo, or deselect"],
];

/**
 * What each page is for, with a way to open it, and the keyboard shortcuts.
 * @param props - Component props.
 * @param props.onNavigate - open another page
 * @param props.onTour - start the tour again
 * @returns the help page
 */
export function HelpPage({
  onNavigate,
  onTour,
}: {
  onNavigate: (page: PageId) => void;
  onTour: () => void;
}): ReactElement {
  return (
    <div>
      <PageHeader title="Help" actions={<Button onClick={onTour}>Take the tour</Button>} />
      <div className="max-w-3xl px-5 py-3">
        <ul className="divide-y divide-line">
          {PAGES.map((page) => (
            <li key={page.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
              <Icon name={page.icon} size={18} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1 basis-60">
                <h2 className="font-semibold">{page.title}</h2>
                <p className="mt-0.5 text-[14px] text-muted">{page.text}</p>
              </div>
              <Button variant="ghost" onClick={() => onNavigate(page.id)}>
                Open
                <span className="sr-only">{page.title}</span>
              </Button>
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-[18px] font-semibold">Shortcuts</h2>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[14px]">
          {SHORTCUTS.map(([keys, does]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 text-[14px] font-semibold">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-muted">{does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
