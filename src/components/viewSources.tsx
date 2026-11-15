// What the viewer shows for library photos and for files waiting in an import preview.

import { useMemo } from "react";
import {
  api,
  fileUrl,
  thumbUrl,
  type ImportFile,
  type ImportItem,
  type ImportPreview,
  type MediaDetail,
} from "../lib/api";
import { count, formatBytes, formatTaken, sourceText, splitPath } from "../lib/format";
import { Fact, KIND_NAMES, type ViewItem, type ViewSource } from "./Viewer";

/**
 * Viewer source for library files.
 * @param ids - media ids (group leaders), in the order the viewer steps through them
 * @returns the source, the same object until the ids change
 */
export function useLibrarySource(ids: number[]): ViewSource {
  return useMemo(
    () => ({
      count: ids.length,
      key: (index) => `m${ids[index]}`,
      load: async (index) => libraryItem(await api.mediaDetail(ids[index])),
      open: (index) => api.openMedia(ids[index]),
      reveal: (index) => api.revealMedia(ids[index]),
    }),
    [ids],
  );
}

function libraryItem(detail: MediaDetail): ViewItem {
  const shown = detail.kind === "video" ? detail.playable : detail.viewable;
  return {
    name: detail.name,
    kind: detail.kind,
    original: shown ? fileUrl(detail.path) : null,
    preview: thumbUrl(detail.id, detail.version, true),
    facts: <LibraryFacts detail={detail} />,
  };
}

function LibraryFacts({ detail }: { detail: MediaDetail }) {
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

      {detail.lat !== null && detail.lon !== null && (
        <Fact label="Location">
          <p className="selectable">
            {detail.lat.toFixed(4)}, {detail.lon.toFixed(4)}
          </p>
        </Fact>
      )}

      <Fact label="File">
        <p>
          {KIND_NAMES[detail.kind]}, {formatBytes(detail.size)}
        </p>
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
 * Viewer source for the files in an import preview. A phone's files are copied to this PC before
 * the preview exists, but that copy is temporary, so a phone gets no "Show in folder".
 * @param preview - the import preview
 * @param order - item indexes, in the order the viewer steps through them
 * @returns the source, the same object until the preview or order change
 */
export function useImportSource(preview: ImportPreview, order: number[]): ViewSource {
  return useMemo(() => {
    const { id, items, spec } = preview;
    const at = (index: number) => order[index];
    return {
      count: order.length,
      key: (index) => `i${id}-${at(index)}`,
      load: async (index) => importItem(items[at(index)], await api.importFile(id, at(index))),
      open: (index) => api.openImportFile(id, at(index)),
      reveal: spec.kind === "phone" ? undefined : (index) => api.revealImportFile(id, at(index)),
    };
  }, [preview, order]);
}

function importItem(item: ImportItem, file: ImportFile): ViewItem {
  const shown = item.kind === "video" ? file.playable : file.viewable;
  return {
    name: splitPath(item.from).name,
    kind: item.kind,
    original: shown ? fileUrl(file.path) : null,
    preview: thumbUrl(item.thumb, item.version, true),
    facts: <ImportFacts item={item} />,
  };
}

function ImportFacts({ item }: { item: ImportItem }) {
  const { folder } = splitPath(item.to);
  return (
    <>
      <Fact label="Taken">
        <p>{formatTaken(item.takenAt)}</p>
        {item.uncertain && <p className="mt-1 text-[14px] text-warn">{sourceText("modified")}</p>}
      </Fact>

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
