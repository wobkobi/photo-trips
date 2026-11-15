import { useEffect, useState, type ReactElement } from "react";
import { api, type Codec, type StoreProduct, type Tile } from "../lib/api";
import { missingCodecs } from "../lib/codecs";
import { Icon } from "./Icon";
import { Button } from "./ui";

interface Listing {
  /** Store listing title, so the button matches the page it opens. */
  name: string;
  what: string;
  /** Another listing to try when the Store won't offer this one on the PC. */
  fallback?: { product: StoreProduct; name: string; note: string };
}

const LISTINGS: Record<Codec, Listing> = {
  heif: { name: "HEIF Image Extension", what: "iPhone and Samsung photos (HEIC)" },
  hevc: {
    name: "HEVC Video Extensions from the Device Manufacturer",
    what: "phone videos and HEIC photos",
    fallback: {
      product: "hevc_paid",
      name: "HEVC Video Extensions",
      note: "The same extension for a small one-off charge.",
    },
  },
  raw: { name: "Raw Image Extension", what: "camera RAW files" },
  av1: { name: "AV1 Video Extension", what: "AVIF photos" },
};

/**
 * Banner shown when Windows couldn't draw thumbnails and a Store extension that isn't installed
 * would fix them.
 * @param props - Component props.
 * @param props.failed - tiles whose thumbnails failed this session
 * @param props.onDismiss - hide the hint for good
 * @returns the banner, or nothing when no missing extension is implicated
 */
export function CodecHint({
  failed,
  onDismiss,
}: {
  failed: Tile[];
  onDismiss: () => void;
}): ReactElement | null {
  const [installed, setInstalled] = useState<Codec[] | null>(null);
  const anyFailed = failed.length > 0;

  useEffect(() => {
    if (!anyFailed) return;
    /** Ask which Store extensions are installed; a failed check counts as none. */
    const check = (): void => {
      api.installedExtensions().then(setInstalled, () => setInstalled([]));
    };
    check();
    // Checking again on return from the Store makes the hint go once the extension is in.
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [anyFailed]);

  // Until the check answers, any suggestion could be for something already installed.
  if (installed === null) return null;
  const missing = missingCodecs(failed, installed);
  if (missing.length === 0) return null;

  return (
    <div className="mx-8 mt-5 flex flex-wrap gap-3 rounded-md border border-warn-line bg-warn-soft p-4">
      <Icon name="warn" className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 basis-64">
        <p>
          Windows can&apos;t preview some of your files. They are still sorted normally. These
          extensions from the Microsoft Store add the missing previews:
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {missing.map((codec) => {
            const listing = LISTINGS[codec];
            const { fallback } = listing;
            return (
              <li key={codec} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button onClick={() => api.openStorePage(codec)}>
                    <Icon name="open" size={16} />
                    {listing.name}
                  </Button>
                  <span className="text-[15px] text-muted">for {listing.what}. Free.</span>
                </div>
                {fallback && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4">
                    <span className="text-[15px] text-muted">
                      If the Store says it isn&apos;t available for this PC:
                    </span>
                    <Button onClick={() => api.openStorePage(fallback.product)}>
                      <Icon name="open" size={16} />
                      {fallback.name}
                    </Button>
                    <span className="text-[15px] text-muted">{fallback.note}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <Button variant="ghost" onClick={onDismiss} className="shrink-0 self-start">
        Don&apos;t show again
      </Button>
    </div>
  );
}
