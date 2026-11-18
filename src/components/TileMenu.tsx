import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useLayer } from "../lib/layers";

/** One entry in a {@link TileMenu}. */
export interface MenuItem {
  /** Stable key for the item; the label stands in when there's none. */
  id?: string;
  label: string;
  onSelect: () => void;
  /** The keys that do the same, shown at the right, e.g. "Ctrl+C". */
  shortcut?: string;
  /** Shown greyed out and skipped by the arrow keys. */
  disabled?: boolean;
  /** Draw a line above it, to start a new group. */
  divided?: boolean;
}

/** Enabled items only, for focus and the arrow keys. */
const ITEMS = "button:not(:disabled)";

/** Keep the menu this far from the window edges. */
const EDGE = 8;

/**
 * Right-click menu at the pointer. Closes on Escape, a click elsewhere, scrolling or resizing,
 * and hands focus back to what had it.
 *
 * It's drawn on the body, above the photo viewer, so it stays usable while the viewer makes the
 * app's root inert, and it takes the top of the layer stack so the viewer's keys (Escape, the
 * arrows, Delete) stand aside while it's open.
 * @param props - Component props.
 * @param props.x - pointer x in viewport pixels
 * @param props.y - pointer y in viewport pixels
 * @param props.items - menu entries, in order
 * @param props.onClose - called when the menu should go away
 * @returns the menu
 */
export function TileMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayer();

  // Declared before the effect that focuses the first item, so it notes what had focus first.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Flip the menu back inside the window when it would spill past an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
    el.querySelector<HTMLButtonElement>(ITEMS)?.focus();
  }, [x, y]);

  useEffect(() => {
    /**
     * Close on a mouse press outside the menu.
     * @param event - the window's mousedown
     */
    const away = (event: Event): void => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    /** Close on any scroll, resize or loss of focus. */
    const close = (): void => {
      onClose();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("wheel", close, { passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("wheel", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [onClose]);

  /**
   * Escape closes the menu; the arrow keys move focus between items, wrapping at the ends. Every
   * key stops here, as in a dialog, so the shortcuts of what's behind (the viewer's zoom and turn
   * keys, the menu bar's) don't act while the menu is open.
   * @param event - the key press inside the menu
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-52 rounded-md border border-line bg-surface py-1 shadow-lg shadow-black/50"
      style={position}
    >
      {items.map((item) => (
        <button
          key={item.id ?? item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          aria-keyshortcuts={item.shortcut?.replace(/\bCtrl\b/g, "Control")}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex min-h-8.5 w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[15px] whitespace-nowrap hover:bg-raised focus-visible:bg-raised focus-visible:outline-none active:bg-line disabled:text-muted disabled:hover:bg-transparent ${item.divided ? "mt-1 border-t border-line" : ""}`}
        >
          {item.label}
          {item.shortcut && (
            <span className="shrink-0 text-[13px] text-muted tabular-nums">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
