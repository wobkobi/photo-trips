// Pic Cabinet's own icon, drawn from the SVG the Windows icons are generated from, so the menu and
// About match the title bar, taskbar and tray.
import type { ReactElement } from "react";
import iconUrl from "../../src-tauri/icons/app-icon.svg";

/**
 * Pic Cabinet's icon: tilted photos on a navy tile.
 * @param props - Component props.
 * @param props.size - width and height in pixels
 * @param props.className - extra classes
 * @returns the icon, hidden from screen readers since the name is written beside it
 */
export function AppIcon({
  size = 28,
  className = "",
}: {
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <img
      src={iconUrl}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`block ${className}`}
    />
  );
}
