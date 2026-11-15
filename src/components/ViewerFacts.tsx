// The viewer's side-panel details for library photos and for files waiting in an import preview.

import { useCallback, type ReactElement } from "react";
import { api, type ImportItem, type MediaDetail, type MediaKind } from "../lib/api";
import { count, formatBytes, formatTaken, sourceText, splitPath } from "../lib/format";
import { located, useFileDetails } from "../lib/useFileDetails";
import { CameraFact, Measures } from "./FileFacts";
import { LocationFact } from "./LocationFact";
import { Fact } from "./Viewer";

const KIND_NAMES: Record<MediaKind, string> = {
  photo: "Photo",
  raw: "RAW",
  video: "Video",
  companion: "Sidecar",
};

/**
 * Details of a library file: when it was taken, where, the camera, the file itself and the
 * files that move with it.
 * @param props - Component props.
 * @param props.detail - the file's indexed details
 * @returns the facts for the viewer's side panel
 */
export function LibraryFacts({ detail }: { detail: MediaDetail }): ReactElement {
  const load = useCallback(() => api.mediaDetails(detail.id), [detail.id]);
  const details = useFileDetails(`m${detail.id}`, load);
  // The index keeps the location; the file's own is used only when the index has none.
  const spot =
    detail.lat !== null && detail.lon !== null
      ? { lat: detail.lat, lon: detail.lon }
      : located(details);
  return (
    <>
      <Fact label="Taken">
        <p>{formatTaken(detail.takenAt)}</p>
        <p
          className={`mt-1 text-[14px] ${detail.dateSource === "modified" ? "text-warn" : "text-faint"}`}
        >
          {sourceText(detail.dateSource)}
        </p>
      </Fact>

      {spot && <LocationFact lat={spot.lat} lon={spot.lon} />}
      {details && <CameraFact details={details} />}

      <Fact label="File">
        <p>
          {KIND_NAMES[detail.kind]}, {formatBytes(detail.size)}
        </p>
        <Measures details={details} video={detail.kind === "video"} />
        <p className="selectable mt-1 text-[14px] break-all text-faint">{detail.folder}</p>
      </Fact>

      {detail.members.length > 1 && (
        <Fact label="Moves together with">
          <ul className="flex flex-col gap-1">
            {detail.members.slice(1).map((m) => (
              <li key={m.id} className="flex justify-between gap-3 text-[15px]">
                <span className="selectable truncate">{m.name}</span>
                <span className="shrink-0 text-faint">{KIND_NAMES[m.kind]}</span>
              </li>
            ))}
          </ul>
        </Fact>
      )}
    </>
  );
}

/**
 * Details of a file waiting in an import preview: when it was taken, where, the camera, the
 * folder it goes into and the file itself.
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
  const details = useFileDetails(`i${previewId}-${index}`, load);
  const spot = located(details);
  const { folder } = splitPath(item.to);
  return (
    <>
      <Fact label="Taken">
        <p>{formatTaken(item.takenAt)}</p>
        {item.uncertain && <p className="mt-1 text-[14px] text-warn">{sourceText("modified")}</p>}
      </Fact>

      {spot && <LocationFact lat={spot.lat} lon={spot.lon} />}
      {details && <CameraFact details={details} />}

      <Fact label="Goes into">
        <p className="selectable break-all">{folder || "The library folder"}</p>
        {item.renamed && (
          <p className="mt-1 text-[14px] text-faint">
            Gets a number added to its name, because a different file with that name is already
            there.
          </p>
        )}
      </Fact>

      <Fact label="File">
        <p>
          {KIND_NAMES[item.kind]}, {formatBytes(item.bytes)}
        </p>
        <Measures details={details} video={item.kind === "video"} />
        {item.extra > 0 && (
          <p className="mt-1 text-[14px] text-faint">
            Comes in with {count(item.extra, "other file", "other files")}, such as a Live Photo
            video or RAW copy.
          </p>
        )}
      </Fact>
    </>
  );
}
