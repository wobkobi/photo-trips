// The strip of years down the right of a photo grid: drag or click it to jump to a month.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
} from "react";

/** A month heading in the grid: its label and how far down the grid it starts, in pixels. */
export interface RailMonth {
  key: string;
  label: string;
  top: number;
}

/** Year labels closer together than this, in pixels, would overlap, so the later one is left out. */
const LABEL_GAP = 18;
/** How long the month bubble stays after scrolling stops, in milliseconds. */
const BUBBLE_MS = 900;

/**
 * The month at `offset` pixels down the grid: the last one starting at or above it.
 * @param months - months in grid order
 * @param offset - pixels from the top of the grid
 * @returns the month's index in `months`
 */
function monthAt(months: RailMonth[], offset: number): number {
  let lo = 0;
  let hi = months.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (months[mid].top <= offset + 1) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * A rail beside a scrolling grid of months, showing where each year starts at its place in the
 * grid. Dragging or clicking scrolls the grid to that point; hovering names the month there. As a
 * slider, arrow keys step a month, Page Up and Page Down a year, and Home and End go to the ends.
 * @param props - Component props.
 * @param props.months - the grid's month headings, newest first, each with where it starts
 * @param props.total - the grid's full height in pixels
 * @param props.scrollRef - the element the grid scrolls in
 * @returns the rail
 */
export function DateRail({
  months,
  total,
  scrollRef,
}: {
  months: RailMonth[];
  total: number;
  scrollRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const railRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrolling, setScrolling] = useState(false);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const dragging = useRef(false);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  // Follow the grid's scrolling, showing the month bubble until it settles.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = 0;
    /** Track the scroll position and keep the bubble up while it moves. */
    const onScroll = (): void => {
      setScrollTop(el.scrollTop);
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), BUBBLE_MS);
    };
    setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [scrollRef]);

  const scale = total > 0 ? height / total : 0;
  const current = monthAt(months, scrollTop);

  // The first month of each year, labelled where it starts unless it would overlap the last label.
  const years = useMemo(() => {
    const shown: { year: string; y: number }[] = [];
    let previous = "";
    for (const month of months) {
      const year = month.key.slice(0, 4);
      if (year === previous) continue;
      previous = year;
      const y = month.top * scale;
      const last = shown[shown.length - 1] as { year: string; y: number } | undefined;
      if (!last || y - last.y >= LABEL_GAP) shown.push({ year, y });
    }
    return shown;
  }, [months, scale]);

  /**
   * Scroll the grid so `offset` pixels down it is at the top.
   * @param offset - pixels from the top of the grid
   */
  function seek(offset: number): void {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, offset);
  }

  /**
   * The grid offset under a pointer on the rail.
   * @param event - the pointer event
   * @returns the rail-relative y and its grid offset
   */
  function pointAt(event: PointerEvent<HTMLDivElement>): { y: number; offset: number } {
    const box = event.currentTarget.getBoundingClientRect();
    const y = Math.min(Math.max(0, event.clientY - box.top), box.height);
    return { y, offset: scale > 0 ? y / scale : 0 };
  }

  /**
   * Arrow keys step a month, Page Up and Page Down a year, Home and End to the ends.
   * @param event - the key press on the rail
   */
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const year = months[current].key.slice(0, 4);
    let target: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") target = current + 1;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") target = current - 1;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = months.length - 1;
    // Newest first, so the next year down the grid is the previous calendar year.
    if (event.key === "PageDown") {
      const next = months.findIndex((m, i) => i > current && m.key.slice(0, 4) !== year);
      target = next < 0 ? months.length - 1 : next;
    }
    if (event.key === "PageUp") {
      const start = months.findIndex((m) => m.key.slice(0, 4) === year);
      const earlier = start > 0 ? months[start - 1].key.slice(0, 4) : null;
      const previousYear = months.findIndex((m) => m.key.slice(0, 4) === earlier);
      target = start < current ? start : Math.max(0, previousYear);
    }
    if (target === null) return;
    event.preventDefault();
    seek(months[Math.min(Math.max(0, target), months.length - 1)].top);
  }

  const bubbleY = hoverY ?? scrollTop * scale;
  const bubbleMonth = hoverY !== null ? months[monthAt(months, hoverY / scale)] : months[current];
  const showBubble = hoverY !== null || scrolling;

  return (
    <div
      ref={railRef}
      role="slider"
      tabIndex={0}
      aria-label="Jump to a month"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={months.length - 1}
      aria-valuenow={current}
      aria-valuetext={months[current].label}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        const { y, offset } = pointAt(event);
        setHoverY(y);
        seek(offset);
      }}
      onPointerMove={(event) => {
        const { y, offset } = pointAt(event);
        setHoverY(y);
        if (dragging.current) seek(offset);
      }}
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerLeave={() => {
        if (!dragging.current) setHoverY(null);
      }}
      onLostPointerCapture={() => {
        dragging.current = false;
        setHoverY(null);
      }}
      className="relative my-2 mr-1 w-14 shrink-0 cursor-row-resize touch-none rounded-md select-none hover:bg-raised/60 focus-visible:outline-offset-0"
    >
      {months.map((month) => (
        <span
          key={month.key}
          aria-hidden="true"
          className="absolute right-1.5 h-px w-1.5 bg-line-strong"
          style={{ top: month.top * scale }}
        />
      ))}
      {years.map(({ year, y }) => (
        <span
          key={year}
          aria-hidden="true"
          className="absolute right-4 -translate-y-1/2 text-[12px] leading-none font-semibold text-muted tabular-nums"
          style={{ top: Math.min(Math.max(y, 6), Math.max(6, height - 6)) }}
        >
          {year}
        </span>
      ))}
      {/* Where the view is now. */}
      <span
        aria-hidden="true"
        className="absolute inset-x-1 h-0.5 rounded-full bg-accent"
        style={{ top: Math.min(scrollTop * scale, Math.max(0, height - 2)) }}
      />
      {showBubble && bubbleMonth && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-full z-10 mr-2 -translate-y-1/2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-[14px] font-semibold whitespace-nowrap text-ink shadow-lg"
          style={{ top: Math.min(Math.max(bubbleY, 16), Math.max(16, height - 16)) }}
        >
          {bubbleMonth.label}
        </span>
      )}
    </div>
  );
}
