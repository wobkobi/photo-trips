import { useEffect, useState, type ReactElement, type RefObject } from "react";
import { pinnedMonth, type RailMonth } from "../lib/timelineLayout";

/** How far into a month the view must be before its label pins: about half its heading gone. */
const PIN_AFTER = 24;
/**
 * How close the next month's top may come before it pushes the label up. Its heading text sits
 * 18px into the row and the label ends 36px down the grid, so this keeps 4px between them.
 */
const PIN_ROOM = 22;

/**
 * The label of the month at the top of a scrolling grid, pinned over its top-left corner once
 * that month's own heading has scrolled away, and pushed out by the next heading. It lets clicks
 * through to the tiles under it and is hidden from screen readers, since the headings and the
 * date rail already name the month.
 * @param props - Component props.
 * @param props.months - the grid's month headings, in order, each with where it starts
 * @param props.scrollRef - the element the grid scrolls in
 * @param props.inset - left offset in pixels, to line the label up with the grid's tiles
 * @returns the pinned label, invisible at the top of the grid
 */
export function MonthPin({
  months,
  scrollRef,
  inset,
}: {
  months: RailMonth[];
  scrollRef: RefObject<HTMLDivElement | null>;
  inset: number;
}): ReactElement {
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    /** Follow the grid's scroll position. */
    const onScroll = (): void => {
      setScrollTop(el.scrollTop);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  const pin = pinnedMonth(months, scrollTop, PIN_AFTER, PIN_ROOM);
  // Kept mounted with the first month's label at the top, the only place there's no pin, so it
  // fades out and back in rather than popping.
  const label = months.length > 0 ? months[pin?.index ?? 0].label : "";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 h-12 overflow-hidden"
      style={{ paddingLeft: inset }}
    >
      <span
        className={`mt-2 inline-block rounded-md border border-line bg-raised/95 px-2.5 py-1.5 text-[14px] leading-none font-semibold whitespace-nowrap text-ink shadow-md transition-opacity motion-reduce:transition-none ${
          pin ? "opacity-100" : "opacity-0"
        }`}
        style={{ transform: `translateY(${pin?.shift ?? 0}px)` }}
      >
        {label}
      </span>
    </div>
  );
}
