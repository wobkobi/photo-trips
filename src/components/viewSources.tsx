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
import { warmImportFacts, warmLibraryFacts } from "../lib/factsAhead";
import { splitPath } from "../lib/format";
import type { ViewItem, ViewSource } from "./Viewer";
import { ImportFacts, LibraryFacts } from "./ViewerFacts";

/**
 * Viewer source for library files.
 * @param ids - media ids (group leaders), in the order the viewer steps through them
 * @param revision - raise it after changing what files show (a date, say), so the viewer loads
 * them again instead of showing what it already has
 * @returns the source, the same object until the ids or revision change
 */
export function useLibrarySource(ids: number[], revision = 0): ViewSource {
  return useMemo(
    () => ({
      count: ids.length,
      /**
       * Keyed by media id and revision, so a load for a file no longer at this index, or from
       * before a change, is dropped.
       * @param index - position in `ids`
       * @returns the file's key
       */
      key: (index) => `m${ids[index]}-${revision}`,
      /**
       * Fetch the file's indexed details and build what the viewer shows.
       * @param index - position in `ids`
       * @returns the file, ready to show
       */
      load: async (index) => libraryItem(await api.mediaDetail(ids[index])),
      /**
       * Open the file in its default Windows app.
       * @param index - position in `ids`
       * @returns resolves once Windows has been asked to open it
       */
      open: (index) => api.openMedia(ids[index]),
      /**
       * Show the file selected in Explorer.
       * @param index - position in `ids`
       * @returns resolves once Explorer has been asked to show it
       */
      reveal: (index) => api.revealMedia(ids[index]),
      /**
       * Put the file on the clipboard.
       * @param index - position in `ids`
       * @returns resolves once it's on the clipboard
       */
      copy: (index) => api.copyMedia(ids[index]),
      gone: "Look for new photos to bring the library up to date.",
      refresh: { label: "Look for new photos", run: api.indexLibrary },
    }),
    [ids, revision],
  );
}

/**
 * What the viewer shows for a library file. Videos and photos the webview can't handle get no
 * original, so the viewer falls back to the large thumbnail. The viewer loads the next files
 * ahead, so reading the side panel's details starts here too.
 * @param detail - the file's indexed details
 * @returns the viewer item
 */
function libraryItem(detail: MediaDetail): ViewItem {
  const shown = detail.kind === "video" ? detail.playable : detail.viewable;
  warmLibraryFacts(detail);
  return {
    name: detail.name,
    kind: detail.kind,
    original: shown ? fileUrl(detail.path) : null,
    missing: detail.missing,
    empty: detail.empty,
    preview: thumbUrl(detail.id, detail.version, true),
    thumb: thumbUrl(detail.id, detail.version),
    facts: <LibraryFacts detail={detail} />,
  };
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
    /**
     * Map a viewer position to the preview's item index.
     * @param index - position in `order`
     * @returns the item index
     */
    const at = (index: number): number => order[index];
    return {
      count: order.length,
      /**
       * Keyed by preview and item, so a load for a file no longer at this position is dropped.
       * @param index - position in `order`
       * @returns the file's key
       */
      key: (index) => `i${id}-${at(index)}`,
      /**
       * Fetch the file's details and build what the viewer shows.
       * @param index - position in `order`
       * @returns the file, ready to show
       */
      load: async (index) =>
        importItem(id, at(index), items[at(index)], await api.importFile(id, at(index))),
      /**
       * Open the file in its default Windows app.
       * @param index - position in `order`
       * @returns resolves once Windows has been asked to open it
       */
      open: (index) => api.openImportFile(id, at(index)),
      reveal: spec.kind === "phone" ? undefined : (index) => api.revealImportFile(id, at(index)),
      gone: "Check again to bring this import up to date.",
    };
  }, [preview, order]);
}

/**
 * What the viewer shows for a file in an import preview. Videos and photos the webview can't
 * handle get no original, so the viewer falls back to the large thumbnail. Reading the side
 * panel's details starts here, as for library files.
 * @param previewId - the import preview the file belongs to
 * @param index - the file's index in the preview's items
 * @param item - the preview's entry for the file
 * @param file - where the file can be read and whether the webview can show it
 * @returns the viewer item
 */
function importItem(
  previewId: number,
  index: number,
  item: ImportItem,
  file: ImportFile,
): ViewItem {
  const shown = item.kind === "video" ? file.playable : file.viewable;
  warmImportFacts(previewId, index);
  return {
    name: splitPath(item.from).name,
    kind: item.kind,
    original: shown ? fileUrl(file.path) : null,
    missing: file.missing,
    // Empty files are left out of an import, so none is ever previewed.
    empty: false,
    preview: thumbUrl(item.thumb, item.version, true),
    thumb: thumbUrl(item.thumb, item.version),
    facts: <ImportFacts previewId={previewId} index={index} item={item} />,
  };
}
