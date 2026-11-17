// The app's icons, from Lucide, picked by name so pages don't import icons themselves.

import {
  ArrowDownWideNarrow,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Folder,
  HistoryIcon,
  Images,
  Layers,
  LayoutGrid,
  LoaderCircle,
  Luggage,
  MapIcon,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Settings,
  Smartphone,
  Sparkles,
  TriangleAlert,
  Undo2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

/** A camera's memory card. Lucide has none, so this is drawn on its grid in its style. */
const MemoryCard = createLucideIcon("memory-card", [
  ["path", { d: "M6 22a2 2 0 0 1-2-2V6l4-4h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2Z", key: "body" }],
  ["path", { d: "M8 10V7", key: "pin1" }],
  ["path", { d: "M12 6v4", key: "pin2" }],
  ["path", { d: "M16 6v4", key: "pin3" }],
]);

const ICONS = {
  library: LayoutGrid,
  trips: Luggage,
  suggest: Sparkles,
  import: Download,
  duplicates: Images,
  history: HistoryIcon,
  settings: Settings,
  folder: Folder,
  close: X,
  play: Play,
  pause: Pause,
  sound: Volume2,
  soundOff: VolumeX,
  warn: TriangleAlert,
  undo: Undo2,
  check: Check,
  chevron: ChevronRight,
  open: ExternalLink,
  refresh: RefreshCw,
  back: ChevronLeft,
  layers: Layers,
  pin: MapPin,
  sort: ArrowDownWideNarrow,
  card: MemoryCard,
  phone: Smartphone,
  zoom: ZoomIn,
  zoomOut: ZoomOut,
  rotate: RotateCw,
  copy: Copy,
  map: MapIcon,
  calendar: CalendarDays,
  help: CircleHelp,
  busy: LoaderCircle,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/**
 * Line icon, stroked with the current text colour.
 * @param props - Component props.
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
}): ReactElement {
  const Glyph = ICONS[name];
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" className={className} />;
}
