// Fullscreen for the photo viewer. The engine owns the state, since hiding to the tray leaves
// fullscreen too, and reports every change on "fullscreen://changed".

import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

type KeyPress = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/**
 * Whether a key press asks to enter or leave fullscreen: F or F11 with no modifier. Caps Lock
 * gives "F" without Shift, so either case counts.
 * @param event - the keydown
 * @returns true for F or F11 on its own
 */
export function isFullscreenKey(event: KeyPress): boolean {
  if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return false;
  return event.key === "f" || event.key === "F" || event.key === "F11";
}

/**
 * Fullscreen for as long as the calling component is mounted: it is left on unmount, so closing
 * the viewer always gives the window back with its menu bar.
 * @returns whether the window is fullscreen, and a setter that asks the engine to change it
 */
export function useFullscreen(): { on: boolean; set: (on: boolean) => void } {
  const [on, setOn] = useState(false);
  // What was last asked for or reported, read on unmount. A ref, so a request still on its way
  // when the viewer closes is undone too.
  const wanted = useRef(false);

  useEffect(() => {
    const unlisten = listen<boolean>("fullscreen://changed", (event) => {
      wanted.current = event.payload;
      setOn(event.payload);
    });
    return () => {
      void unlisten.then((off) => off());
      if (wanted.current) void api.setFullscreen(false).catch(() => undefined);
    };
  }, []);

  const set = useCallback((next: boolean) => {
    wanted.current = next;
    api.setFullscreen(next).then(
      () => setOn(next),
      () => {
        wanted.current = !next;
      },
    );
  }, []);

  return useMemo(() => ({ on, set }), [on, set]);
}
