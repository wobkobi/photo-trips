import { useEffect, useRef, useState, type ReactElement } from "react";
import { api, type Codec, type MediaKind, type StoreProduct, type Tile } from "../lib/api";
import { codecsFor, missingCodecs } from "../lib/codecs";
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
 * A Store button for each extension, with what it's for, and the paid listing to fall back on
 * where the free one isn't offered on every PC.
 * @param props - Component props.
 * @param props.codecs - the extensions to offer
 * @returns the list of buttons
 */
export function ExtensionButtons({ codecs }: { codecs: readonly Codec[] }): ReactElement {
  return (
    <ul className="flex flex-col gap-2">
      {codecs.map((codec) => {
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
  );
}

/**
 * For the viewer, when one file can't be shown: the Store extensions its type needs that aren't
 * installed, or nothing when they all are (then the file itself is at fault).
 * @param props - Component props.
 * @param props.ext - the file's extension, lower case without the dot
 * @param props.kind - what sort of file it is
 * @returns the offer, or nothing
 */
export function MissingExtensions({
  ext,
  kind,
}: {
  ext: string;
  kind: MediaKind;
}): ReactElement | null {
  const [installed, setInstalled] = useState<Codec[] | null>(null);
  useEffect(() => {
    api.installedExtensions().then(setInstalled, () => setInstalled([]));
  }, []);
  if (installed === null) return null;
  const missing = codecsFor(ext, kind).filter((codec) => !installed.includes(codec));
  if (missing.length === 0) return null;
  return (
    <div className="mt-5 text-left">
      <p className="mb-3 text-muted">Windows needs an extension from the Microsoft Store:</p>
      <ExtensionButtons codecs={missing} />
    </div>
  );
}

/**
 * Banner shown when Windows couldn't draw thumbnails and a Store extension that isn't installed
 * would fix them.
 * @param props - Component props.
 * @param props.failed - tiles whose thumbnails failed this session
 * @param props.shown - every tile on show, so a type the list has only one or two of needs fewer
 *   failures before an extension is named
 * @param props.onDismiss - hide the hint for good
 * @param props.onChange - an extension came or went since the last check, so tiles without a
 *   thumbnail are worth asking again
 * @returns the banner, or nothing when no missing extension is implicated
 */
export function CodecHint({
  failed,
  shown,
  onDismiss,
  onChange,
}: {
  failed: Tile[];
  shown: readonly Tile[];
  onDismiss: () => void;
  onChange?: () => void;
}): ReactElement | null {
  const [installed, setInstalled] = useState<Codec[] | null>(null);
  const anyFailed = failed.length > 0;
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!anyFailed) return;
    let last: string | null = null;
    /** Ask which Store extensions are installed; a failed check counts as none. */
    const check = (): void => {
      api.installedExtensions().then(
        (found) => {
          const now = [...found].sort().join(",");
          if (last !== null && now !== last) onChangeRef.current?.();
          last = now;
          setInstalled(found);
        },
        () => setInstalled([]),
      );
    };
    check();
    // Checking again on return from the Store makes the hint go once the extension is in.
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [anyFailed]);

  // Until the check answers, any suggestion could be for something already installed.
  if (installed === null) return null;
  const missing = missingCodecs(failed, installed, shown);
  if (missing.length === 0) return null;

  return (
    <div className="mx-8 mt-5 flex flex-wrap gap-3 rounded-md border border-warn-line bg-warn-soft p-4">
      <Icon name="warn" className="mt-0.5 shrink-0 text-warn" />
      <div className="min-w-0 flex-1 basis-64">
        <p>
          Windows can&apos;t preview some of your files. They are still sorted normally. These
          extensions from the Microsoft Store add the missing previews:
        </p>
        <div className="mt-3">
          <ExtensionButtons codecs={missing} />
        </div>
      </div>
      <Button variant="ghost" onClick={onDismiss} className="shrink-0 self-start">
        Don&apos;t show again
      </Button>
    </div>
  );
}
