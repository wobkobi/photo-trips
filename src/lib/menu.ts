// Keyboard shortcuts for the window's menu bar. Keys pressed in the page never reach the native
// menu, so the page matches them here and asks the backend to run the same menu item.

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";

/** What the menu asks the page to do, on the "menu://action" event. */
export type MenuRequest = "refresh" | "about" | "updates";

/** Menu item ids by key combination, as written beside each item in menu.rs. */
const SHORTCUTS: Record<string, string> = {
  "Ctrl+I": "menu-import",
  F5: "menu-refresh",
  "Ctrl+W": "menu-close",
  "Ctrl+Q": "menu-quit",
  "Ctrl+,": "menu-settings",
  "Ctrl+1": "menu-page-library",
  "Ctrl+2": "menu-page-sort",
  "Ctrl+3": "menu-page-trips",
  "Ctrl+4": "menu-page-suggestions",
  "Ctrl+5": "menu-page-import",
  "Ctrl+6": "menu-page-duplicates",
  "Ctrl+7": "menu-page-history",
};

type KeyPress = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * The menu item a key press picks. Digits go by the physical key, so Ctrl+1 works on layouts
 * where 1 needs Shift; letters go by the character, so Ctrl+Q stays on Q under AZERTY.
 * @param event - the keydown
 * @returns the menu item id, or null when the keys aren't a menu shortcut
 */
export function shortcutFor(event: KeyPress): string | null {
  if (event.altKey || event.shiftKey || event.metaKey) return null;
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const key = digit ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  return SHORTCUTS[`${event.ctrlKey ? "Ctrl+" : ""}${key}`] ?? null;
}

/**
 * Runs menu shortcuts typed in the page, and hands the page the menu requests only it can
 * carry out.
 * @param onRequest - called with each request from the menu (or a shortcut for one)
 */
export function useMenuBar(onRequest: (request: MenuRequest) => void) {
  // Kept in a ref so a new callback each render doesn't re-subscribe.
  const handler = useRef(onRequest);
  useEffect(() => {
    handler.current = onRequest;
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const id = shortcutFor(event);
      if (!id) return;
      // Also stops WebView2's own use of the keys, like F5 reloading the page.
      event.preventDefault();
      if (!event.repeat) void api.menuAction(id);
    }
    window.addEventListener("keydown", onKeyDown);
    const unlisten = listen<MenuRequest>("menu://action", (event) =>
      handler.current(event.payload),
    );
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unlisten.then((off) => off());
    };
  }, []);
}
