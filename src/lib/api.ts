// Typed wrappers around the Rust commands (src-tauri/src/commands.rs and library.rs).

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
