import { api, type StoreProduct, type Tile } from "../lib/api";
import { Icon } from "./Icon";
import { Button } from "./ui";

interface Codec {
  product: StoreProduct;
  name: string;
  what: string;
  matches: (tile: Tile) => boolean;
}

/** Free Store extensions, and which failed thumbnails suggest each one is missing. */
const CODECS: Codec[] = [
  {
    product: "heif",
    name: "HEIF Image Extensions",
    what: "iPhone and Samsung photos (HEIC)",
    matches: (t) => ["heic", "heif", "hif"].includes(t.ext),
  },
  {
    product: "hevc",
    name: "HEVC Video Extensions from Device Manufacturer",
    what: "phone videos",
    // HEVC lives in phone formats; an AVI or MTS without a preview needs some other codec.
    matches: (t) => ["mov", "mp4", "m4v", "3gp"].includes(t.ext),
  },
  {
    product: "raw",
    name: "Raw Image Extension",
    what: "camera RAW files",
    matches: (t) => t.kind === "raw",
  },
  {
    product: "av1",
    name: "AV1 Video Extension",
    what: "AVIF photos",
    matches: (t) => t.ext === "avif",
  },
];

/**
 * Banner shown when Windows couldn't draw thumbnails for formats a free extension would fix.
 * @param props.failed - tiles whose thumbnails failed this session
 * @param props.onDismiss - hide the hint for good
 * @returns the banner, or nothing when no known codec is implicated
 */
export function CodecHint({ failed, onDismiss }: { failed: Tile[]; onDismiss: () => void }) {
  const missing = CODECS.filter((codec) => failed.some(codec.matches));
  if (missing.length === 0) return null;

  return (
    <div className="mx-8 mt-5 flex gap-3 rounded-md border border-warn-line bg-warn-soft p-4">
      <Icon name="warn" className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1">
        <p>
          Windows can&apos;t preview some of your files. They are still sorted normally. These free
          extensions from the Microsoft Store add the missing previews:
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {missing.map((codec) => (
            <li key={codec.product} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Button onClick={() => api.openStorePage(codec.product)}>
                <Icon name="open" size={16} />
                {codec.name}
              </Button>
              <span className="text-[13px] text-muted">for {codec.what}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Don't show this again"
        title="Don't show this again"
        className="shrink-0 self-start text-muted hover:text-ink"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
