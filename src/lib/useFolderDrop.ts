import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Watch for things dragged onto the window. A drop hands over its first folder; dropped files
 * are passed over, so a stray photo dropped on the window does nothing.
 * @param enabled - listen at all (off until a library folder is chosen)
 * @param onFolder - called with the dropped folder
 * @returns true while something is being dragged over the window
 */
export function useFolderDrop(enabled: boolean, onFolder: (path: string) => void): boolean {
  const [dragging, setDragging] = useState(false);
  // The listener is added once, so it calls the latest onFolder through a ref.
  const onFolderRef = useRef(onFolder);
  useEffect(() => {
    onFolderRef.current = onFolder;
  });
  useEffect(() => {
    if (!enabled) return;
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      setDragging(payload.type === "enter" || payload.type === "over");
      if (payload.type !== "drop") return;
      // A drop that can't be looked at is treated like a drop of files: nothing happens.
      api.droppedFolder(payload.paths).then(
        (folder) => {
          if (folder !== null) onFolderRef.current(folder);
        },
        () => undefined,
      );
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, [enabled]);
  return enabled && dragging;
}
