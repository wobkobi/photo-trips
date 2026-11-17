// The viewer's side-panel details for library photos and for files waiting in an import preview.

import { useCallback, useState, type ReactElement } from "react";
import {
  api,
  errorText,
  type ImportItem,
  type MediaDetail,
  type MediaKind,
  type MediaMember,
} from "../lib/api";
import { importKey, libraryKey } from "../lib/factsAhead";
import {
  count,
  dateNote,
  formatBytes,
  formatTaken,
  libraryFolder,
  sourceText,
  splitPath,
} from "../lib/format";
import { located, useFileDetails } from "../lib/useFileDetails";
import { useSettings } from "../lib/useSettings";
import { CameraFact, Measures } from "./FileFacts";
import { Icon } from "./Icon";
import { LocationFact } from "./LocationFact";
import { Fact } from "./Viewer";

const KIND_NAMES: Record<MediaKind, string> = {
  photo: "Photo",
  raw: "RAW",
  video: "Video",
  companion: "Sidecar",
};

/**
 * Details of a library file. Sections that come and go or change height between files sit
 * lowest, so the rest stays put while stepping through photos: the map, then the list of files
 * that move with this one, which changes most often.
 * @param props - Component props.
 * @param props.detail - the file's indexed details
 * @returns the facts for the viewer's side panel
 */
export function LibraryFacts({ detail }: { detail: MediaDetail }): ReactElement {
  const load = useCallback(() => api.mediaDetails(detail.id), [detail.id]);
  const details = useFileDetails(libraryKey(detail), load);
  const { settings } = useSettings();
  const note = dateNote(detail.dateSource);
  // The index keeps the location; the file's own is used only when the index has none.
  const spot =
    detail.lat !== null && detail.lon !== null
      ? { lat: detail.lat, lon: detail.lon }
      : located(details);
  return (
    <>
      <Fact label="Taken">
        <p title={sourceText(detail.dateSource)}>{formatTaken(detail.takenAt)}</p>
        {note && (
          <p className="mt-1 text-[14px] text-faint" title={sourceText(detail.dateSource)}>
            {note}
          </p>
        )}
      </Fact>

      <Fact label="File">
        <p>
          {KIND_NAMES[detail.kind]}, {formatBytes(detail.size)}
        </p>
        <Measures details={details} video={detail.kind === "video"} />
        <p className="selectable mt-1 text-[14px] break-all text-faint" title={detail.folder}>
          {libraryFolder(detail.folder, settings?.library_root)}
        </p>
      </Fact>

      {details && <CameraFact details={details} />}
      {spot && <LocationFact lat={spot.lat} lon={spot.lon} />}

      {detail.members.length > 1 && (
        <LinkedFiles key={detail.id} members={detail.members.filter((m) => m.id !== detail.id)} />
      )}
    </>
  );
}

/**
 * The files that move with the one on show, each a button that opens it in its own app. A RAW
 * copy can be shown in its folder too, for editing in another app. A failure shows under the
 * list; callers key it by the file on show, so the failure goes with it.
 * @param props - Component props.
 * @param props.members - the other files in the tile
 * @returns the "Moves together with" block
 */
function LinkedFiles({ members }: { members: MediaMember[] }): ReactElement {
  const [error, setError] = useState<string | null>(null);

  /**
   * Run an open or show-in-folder call, keeping any failure on show.
   * @param action - the call
   */
  function run(action: Promise<void>): void {
    setError(null);
    action.catch((err: unknown) => setError(errorText(err)));
  }

  return (
    <Fact label="Moves together with">
      <ul className="-mx-2 flex flex-col">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-1">
            <button
              type="button"
              title={`Open ${m.name}`}
              onClick={() => run(api.openMedia(m.id))}
              className="flex min-w-0 flex-1 justify-between gap-3 rounded-md px-2 py-1 text-left text-[15px] transition-colors hover:bg-raised active:bg-line"
            >
              <span className="truncate">{m.name}</span>
              <span className="shrink-0 text-faint">{KIND_NAMES[m.kind]}</span>
            </button>
            {m.kind === "raw" && (
              <button
                type="button"
                title="Show in folder"
                aria-label={`Show ${m.name} in folder`}
                onClick={() => run(api.revealMedia(m.id))}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink active:bg-line"
              >
                <Icon name="folder" size={18} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-1 text-[14px] text-danger">{error}</p>}
    </Fact>
  );
}

/**
 * Details of a file waiting in an import preview, in the same order as {@link LibraryFacts}:
 * steady sections first, the map last.
 * @param props - Component props.
 * @param props.previewId - the import preview the file belongs to
 * @param props.index - the file's index in the preview's items
 * @param props.item - the preview's entry for the file
 * @returns the facts for the viewer's side panel
 */
export function ImportFacts({
  previewId,
  index,
  item,
}: {
  previewId: number;
  index: number;
  item: ImportItem;
}): ReactElement {
  const load = useCallback(() => api.importFileDetails(previewId, index), [previewId, index]);
  const details = useFileDetails(importKey(previewId, index), load);
  const spot = located(details);
  const { folder } = splitPath(item.to);
  return (
    <>
      <Fact label="Taken">
        <p>{formatTaken(item.takenAt)}</p>
        {item.uncertain && (
          <p className="mt-1 text-[14px] text-faint" title={sourceText("modified")}>
            {dateNote("modified")}
          </p>
        )}
      </Fact>

      <Fact label="Goes into">
        <p className="selectable break-all">{folder || "The library folder"}</p>
        {item.renamed && (
          <p className="mt-1 text-[14px] text-faint">Gets a number added; that name is taken</p>
        )}
      </Fact>

      <Fact label="File">
        <p>
          {KIND_NAMES[item.kind]}, {formatBytes(item.bytes)}
        </p>
        <Measures details={details} video={item.kind === "video"} />
        {item.extra > 0 && (
          <p className="mt-1 text-[14px] text-faint" title="Such as a Live Photo video or RAW copy">
            With {count(item.extra, "linked file", "linked files")}
          </p>
        )}
      </Fact>

      {details && <CameraFact details={details} />}
      {spot && <LocationFact lat={spot.lat} lon={spot.lon} />}
    </>
  );
}
