import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/** Keep the menu this far from the window edges. */
const EDGE = 8;

/**
 * Right-click menu at the pointer. Closes on Escape, a click elsewhere, scrolling or resizing.
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
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Flip the menu back inside the window when it would spill past an edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - height - EDGE)),
    });
    el.querySelector<HTMLButtonElement>("button")?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
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

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-52 rounded-md border border-line bg-surface py-1 shadow-lg shadow-brand/20"
      style={position}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className="block min-h-11 w-full px-4 py-2.5 text-left text-[16px] hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
