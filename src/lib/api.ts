// Typed wrappers around the Rust commands (src-tauri/src/*.rs).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Settings = Record<string, string>;

export type MediaKind = "photo" | "raw" | "video" | "companion";

/** Where a file's date came from, best first. Mirrors DateSource in dates.rs. */
export type DateSource = "exif" | "video" | "windows" | "exiftool" | "filename" | "modified";

/** One grid tile: a photo or video plus any files that travel with it. */
export interface Tile {
  id: number;
  takenAt: string;
  kind: MediaKind;
  ext: string;
  /** Date guessed from the file's modified time. */
  uncertain: boolean;
  /** Companion files (Live Photo video, RAW twin, sidecars). */
  extra: number;
  version: number;
  /** Trip the photo was taken during. */
  trip: TileTrip | null;
}

/** Enough of a trip to draw its band on a tile. */
export interface TileTrip {
  id: number;
  name: string;
  /** 1 to 6: which trip colour to use. */
  colour: number;
}

export interface MediaMember {
  id: number;
  name: string;
  kind: MediaKind;
  size: number;
}

export interface MediaDetail {
  id: number;
  path: string;
  name: string;
  folder: string;
  takenAt: string;
  dateSource: DateSource;
  size: number;
  lat: number | null;
  lon: number | null;
  kind: MediaKind;
  viewable: boolean;
  playable: boolean;
  version: number;
  members: MediaMember[];
}

export interface JobProgress {
  kind: string;
  stage: string;
  done: number;
  /** 0 while the total isn't known yet. */
  total: number;
}

export interface JobDone<T = unknown> {
  kind: string;
  ok: boolean;
  cancelled: boolean;
  error: string | null;
  result: T;
}

export interface IndexSummary {
  files: number;
  added: number;
  updated: number;
  removed: number;
  otherFiles: number;
}

/** A previewed set of moves, waiting to be applied. Mirrors Preview in organise.rs. */
export interface Preview {
  id: number;
  /** Files that will move. */
  files: number;
  /** Groups that get a number added to their names because the name is taken. */
  renamed: number;
  /** Groups already in the right folder. */
  inPlace: number;
  /** Files never moved: sidecars without their photo, files outside the library. */
  leftAlone: number;
  folders: { folder: string; files: number }[];
  items: PreviewItem[];
}

/** One photo (plus companions) that will move. Paths are relative to the library folder. */
export interface PreviewItem {
  id: number;
  version: number;
  from: string;
  to: string;
  extra: number;
  renamed: boolean;
}

export interface ApplySummary {
  batchId: number;
  moved: number;
  failed: number;
  cancelled: boolean;
}

export interface UndoSummary {
  batchId: number;
  restored: number;
  failed: number;
  cancelled: boolean;
}

export type BatchStatus =
  | "running"
  | "done"
  | "partial"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "undoing"
  | "undone"
  | "partly_undone";

/** One undoable change in History. Mirrors BatchInfo in history.rs. */
export interface BatchInfo {
  id: number;
  kind: string;
  label: string;
  status: BatchStatus;
  /** Unix seconds. */
  createdAt: number;
  undoneAt: number | null;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  undone: number;
  canUndo: boolean;
}

export type EntryStatus = "pending" | "done" | "failed" | "skipped" | "undoing" | "undone";

export interface BatchEntry {
  seq: number;
  from: string;
  to: string;
  status: EntryStatus;
  error: string | null;
}

/** A thumbnail for a trip sample. */
export interface SampleTile {
  id: number;
  version: number;
}

/** One trip on the Trips page. Mirrors TripInfo in trips.rs. */
export interface TripInfo {
  id: number;
  name: string;
  /** Inclusive local wall-clock times, "YYYY-MM-DDTHH:MM:SS". */
  startAt: string;
  endAt: string;
  /** Folder name under Trips. */
  folder: string;
  colour: number;
  /** Photos and videos taken during the trip. */
  files: number;
  sample: SampleTile[];
}

/** What a trip's dates take in, for the trip form. */
export interface TripMatches {
  files: number;
  sample: SampleTile[];
  /** Why the dates can't be used (they overlap another trip). */
  problem: string | null;
}

export interface TripDraft {
  name: string;
  startAt: string;
  endAt: string;
}

export type TripChange =
  | { action: "create"; draft: TripDraft }
  | { action: "update"; id: number; draft: TripDraft }
  | { action: "delete"; id: number };

/** Free Microsoft Store codec extensions the app can point to. */
export type StoreProduct = "heif" | "hevc" | "raw" | "av1";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  indexLibrary: () => invoke<void>("index_library"),
  jobStatus: () => invoke<JobProgress | null>("job_status"),
  cancelJob: () => invoke<void>("cancel_job"),
  libraryTiles: () => invoke<Tile[]>("library_tiles"),
  mediaDetail: (id: number) => invoke<MediaDetail>("media_detail", { id }),
  openMedia: (id: number) => invoke<void>("open_media", { id }),
  revealMedia: (id: number) => invoke<void>("reveal_media", { id }),
  openStorePage: (product: StoreProduct) => invoke<void>("open_store_page", { product }),
  planOrganise: () => invoke<Preview>("plan_organise"),
  applyPlan: (id: number) => invoke<void>("apply_plan", { id }),
  listBatches: () => invoke<BatchInfo[]>("list_batches"),
  batchEntries: (batchId: number) => invoke<BatchEntry[]>("batch_entries", { batchId }),
  undoBatch: (batchId: number) => invoke<void>("undo_batch", { batchId }),
  listTrips: () => invoke<TripInfo[]>("list_trips"),
  tripMatches: (startAt: string, endAt: string, editing: number | null) =>
    invoke<TripMatches>("trip_matches", { startAt, endAt, editing }),
  /** Preview a trip change; apply it with {@link api.applyPlan}. */
  planTrip: (change: TripChange) => invoke<Preview>("plan_trip", { change }),
};

/**
 * Image URL for a media id on the thumb:// scheme.
 * @param id - media id (the group leader for tiles)
 * @param version - file version, so a changed file never shows a stale cached image
 * @param full - the full-size preview instead of the grid thumbnail
 * @returns the URL
 */
export function thumbUrl(id: number, version: number, full = false): string {
  return `${convertFileSrc(String(id), "thumb")}?v=${version}${full ? "&full" : ""}`;
}

/**
 * URL of an original file in the library (asset protocol, supports video seeking).
 * @param path - absolute path inside the library folder
 * @returns the URL
 */
export function fileUrl(path: string): string {
  return convertFileSrc(path);
}

/** Error text from a rejected command (commands reject with a plain string). */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
