// Keyboard shortcuts for the window's menu bar, and the keys and mouse buttons that go back and
// forward. Keys pressed in the page never reach the native menu, so the page matches them here and
// asks the backend to run the same menu item.

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { api } from "./api";

/**
 * What the menu asks the page to do, on the "menu://action" event. "undo" has no menu item; it
 * comes only from Ctrl+Z pressed in the page.
 */
export type MenuRequest = "refresh" | "find" | "about" | "updates" | "undo";

/** Menu item ids by key combination, as written beside each item in menu.rs. */
const SHORTCUTS: Record<string, string> = {
  "Ctrl+I": "menu-import",
  F5: "menu-refresh",
  "Ctrl+F": "menu-find",
  "Ctrl+W": "menu-close",
  "Ctrl+Q": "menu-quit",
  "Ctrl+,": "menu-settings",
  F1: "menu-help",
  "Ctrl+1": "menu-page-library",
  "Ctrl+2": "menu-page-trips",
  "Ctrl+3": "menu-page-import",
  "Ctrl+4": "menu-page-sort",
  "Ctrl+5": "menu-page-suggestions",
  "Ctrl+6": "menu-page-duplicates",
  "Ctrl+7": "menu-page-history",
};

/** The parts of a key press that shortcuts are matched on. */
export type KeyPress = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;

/**
 * A key press written the way a shortcut is, e.g. "Ctrl+Shift+C", "F5" or "Delete". Digits go
 * by the physical key, so Ctrl+1 works on layouts where 1 needs Shift; letters go by the
 * character, so Ctrl+Q stays on Q under AZERTY.
 * @param event - the keydown
 * @returns the keys, or null with the Windows key held, which no shortcut uses
 */
export function keyCombo(event: KeyPress): string | null {
  if (event.metaKey) return null;
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const key = digit ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const ctrl = event.ctrlKey ? "Ctrl+" : "";
  const alt = event.altKey ? "Alt+" : "";
  const shift = event.shiftKey ? "Shift+" : "";
  return `${ctrl}${alt}${shift}${key}`;
}

/**
 * The menu item a key press picks.
 * @param event - the keydown
 * @returns the menu item id, or null when the keys aren't a menu shortcut
 */
export function shortcutFor(event: KeyPress): string | null {
  const combo = keyCombo(event);
  return combo === null ? null : (SHORTCUTS[combo] ?? null);
}

/**
 * Whether a key press is Ctrl+Z, by the character so it stays on Z under AZERTY.
 * @param event - the keydown
 * @returns true for Ctrl+Z with no other modifier
 */
export function isUndoKey(event: KeyPress): boolean {
  if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return false;
  return event.key.toLowerCase() === "z";
}

/** A step through the places visited. */
export type HistoryStep = "back" | "forward";

/**
 * The step Alt+Left or Alt+Right asks for.
 * @param event - the keydown
 * @returns back or forward, or null for any other keys
 */
export function historyStepForKey(event: KeyPress): HistoryStep | null {
  if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return null;
  if (event.key === "ArrowLeft") return "back";
  if (event.key === "ArrowRight") return "forward";
  return null;
}

/**
 * The step a mouse's side button asks for. `MouseEvent.button` counts from 0, so the buttons
 * Windows calls 4 (back) and 5 (forward) arrive as 3 and 4.
 * @param button - the event's `button`
 * @returns back or forward, or null for any other button
 */
export function historyStepForButton(button: number): HistoryStep | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

/** Input types that take no typing, so keys on one are free for the page. */
const NOT_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
]);

/**
 * A key press aimed at a box that takes typing, where Escape and the arrows belong to the box.
 * @param target - the key press's target
 * @returns true for a text-like input, a textarea, a select or editable text
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
    return true;
  }
  return target instanceof HTMLInputElement && !NOT_TEXT_INPUTS.has(target.type);
}

/**
 * Whether a modal is on screen, which handles its own keys. The viewer and the tour mark
 * themselves aria-modal; a native dialog is open when shown.
 * @returns true while one is showing
 */
export function modalOnScreen(): boolean {
  return document.querySelector('dialog[open], [aria-modal="true"]') !== null;
}

/**
 * Whether the open page holds work that leaving it would lose (a changed trip form, an import
 * being checked, photos unticked on Sort). Its PageHeader marks itself `data-holds-work`.
 * @returns true while such a page is open
 */
export function holdsWork(): boolean {
  return document.querySelector("[data-holds-work]") !== null;
}

/**
 * Runs menu shortcuts typed in the page, and hands the page the menu requests only it can
 * carry out.
 * @param onRequest - called with each request from the menu (or a shortcut for one)
 */
export function useMenuBar(onRequest: (request: MenuRequest) => void): void {
  // Kept in a ref so a new callback each render doesn't re-subscribe.
  const handler = useRef(onRequest);
  useEffect(() => {
    handler.current = onRequest;
  });

  useEffect(() => {
    /**
     * Run the menu item bound to a key press, if any. Ctrl+Z asks the page to undo the last
     * change, unless it's for a box being typed in (which undoes its own typing), a modal on
     * screen, a handler that already used it, or a page holding work that opening History would
     * lose.
     * @param event - the key press
     */
    function onKeyDown(event: KeyboardEvent): void {
      if (isUndoKey(event)) {
        if (event.defaultPrevented || isTextEntry(event.target) || modalOnScreen()) return;
        if (holdsWork()) return;
        event.preventDefault();
        if (!event.repeat) handler.current("undo");
        return;
      }
      const id = shortcutFor(event);
      if (!id) return;
      // Also stops WebView2's own use of the keys, like F5 reloading the page or Ctrl+F opening
      // its find bar. Release builds turn those off anyway (win.rs); dev builds keep them.
      event.preventDefault();
      if (!event.repeat) void api.menuAction(id);
    }
    window.addEventListener("keydown", onKeyDown);
    const unlisten = listen<MenuRequest>("menu://action", (event) =>
      handler.current(event.payload),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      void unlisten.then((off) => off());
    };
  }, []);
}
