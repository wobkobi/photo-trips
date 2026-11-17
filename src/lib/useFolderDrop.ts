import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { modalOnScreen } from "./menu";

/**
 * Watch for things dragged onto the window. A drop hands over its first folder, or null when it
 * held only files. Drops while a modal (the viewer, a dialog, the tour) is on screen are ignored,
 * and no hint shows for them, since the modal covers the page the folder would open.
 * @param enabled - listen at all (off until a library folder is chosen)
 * @param onDrop - called with the dropped folder, or null for files only
 * @returns true while something is being dragged over the window
 */
export function useFolderDrop(enabled: boolean, onDrop: (folder: string | null) => void): boolean {
  const [dragging, setDragging] = useState(false);
  // The listener is added once, so it calls the latest onDrop through a ref.
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });
  useEffect(() => {
    if (!enabled) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      const over = payload.type === "enter" || payload.type === "over";
      setDragging(over && !modalOnScreen());
      if (payload.type !== "drop" || modalOnScreen()) return;
      // A drop that can't be looked at does nothing, rather than claiming it held only files.
      api.droppedFolder(payload.paths).then(
        (folder) => onDropRef.current(folder),
        () => undefined,
      );
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [enabled]);
  return enabled && dragging;
}
