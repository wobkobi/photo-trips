// Line icons drawn on a 20px grid, stroked with the current text colour.

const PATHS = {
  library: "M3 4h6v6H3zM11 4h6v6h-6zM3 12h6v4H3zM11 12h6v4h-6z",
  trips: "M4 17V4l6 3 6-3v13l-6 3-6-3zM10 7v13",
  suggest: "M10 2v3M10 15v3M2 10h3M15 10h3M4.5 4.5l2 2M13.5 13.5l2 2M4.5 15.5l2-2M13.5 6.5l2-2",
  import: "M10 3v10M6 9l4 4 4-4M3 15v2h14v-2",
  duplicates: "M7 7h9v9H7zM4 4h9v2M4 4v9h2",
  history: "M4 10a6 6 0 1 0 2-4.5M4 3v3h3M10 7v3l2 2",
  settings:
    "M10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4",
  folder: "M2 5h6l2 2h8v9H2z",
  close: "M5 5l10 10M15 5L5 15",
  play: "M7 5l8 5-8 5z",
  warn: "M10 3l8 14H2zM10 8v4M10 14v1",
  undo: "M5 8h8a4 4 0 0 1 0 8H8M5 8l3-3M5 8l3 3",
  check: "M4 10l4 4 8-8",
  chevron: "M8 5l5 5-5 5",
  open: "M11 3h6v6M17 3l-8 8M14 12v5H3V6h5",
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5",
  back: "M12 5l-5 5 5 5",
  layers: "M10 3l7 4-7 4-7-4zM3 11l7 4 7-4",
  pin: "M10 18s-5-5.2-5-9a5 5 0 0 1 10 0c0 3.8-5 9-5 9zM10 7.5v2",
  sort: "M3 5h14M3 10h10M3 15h6M15 12v6M12.5 15.5L15 18l2.5-2.5",
  card: "M6 2.5h6.5L15 5v12.5H6zM8.5 5v2.5M10.5 5v2.5M12.5 5.5v2",
  phone: "M6.5 2.5h7v15h-7zM9.25 15h1.5",
  zoom: "M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.5 12.5L17 17M8.5 6.5v4M6.5 8.5h4",
  zoomOut: "M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.5 12.5L17 17M6.5 8.5h4",
  map: "M3 5.5l4.5-2 5 2 4.5-2v11l-4.5 2-5-2-4.5 2zM7.5 3.5v11M12.5 5.5v11",
} as const;

export type IconName = keyof typeof PATHS;

/**
 * Inline SVG icon.
 * @param props.name - which icon to draw
 * @param props.size - rendered size in px (default 18)
 * @param props.className - extra classes
 * @returns the icon element
 */
export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
