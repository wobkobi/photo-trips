// The To the Point Tech chip mark (logo.svg in the website's public/source), drawn in the
// current text colour so it can sit on the violet sidebar.

/** Centres of the twelve pins along each side, in the logo's own units. */
const PINS = [
  302.1, 423.95, 545.73, 667.57, 797, 918.85, 1040.7, 1162.55, 1291.96, 1413.8, 1535.63, 1657.45,
];
const PIN_LONG = 159.88;
const PIN_SHORT = 60.93;

/**
 * The To the Point Tech chip: two nested squares with pins on all four sides.
 * @param props.size - width and height in pixels
 * @param props.className - extra classes; the colour comes from `color`
 * @returns the svg, hidden from screen readers since the name is written beside it
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="-20.24 -20.22 2000 2000"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M1741.21 1733.598H225.956V218.303H1741.21zm-1454.362-60.93h1393.43V279.233H286.847z" />
      <path d="M1573.68 1566.068H393.446V385.836h1180.236zm-1119.346-60.93H1512.75V446.767H454.334z" />
      {PINS.map((c) => (
        <g key={c}>
          <rect x={c - PIN_SHORT / 2} y={20.39} width={PIN_SHORT} height={PIN_LONG} />
          <rect x={c - PIN_SHORT / 2} y={1779.29} width={PIN_SHORT} height={PIN_LONG} />
          <rect x={20.35} y={c - PIN_SHORT / 2} width={PIN_LONG} height={PIN_SHORT} />
          <rect x={1779.28} y={c - PIN_SHORT / 2} width={PIN_LONG} height={PIN_SHORT} />
        </g>
      ))}
    </svg>
  );
}
