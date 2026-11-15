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
  /**
   * "move"; "trash" for a file sent to the Recycle Bin (`to` is then empty); "copy" for a file
   * copied in from a card, phone or folder; "import" for a file moved in from a folder.
   */
  op: "move" | "trash" | "copy" | "import";
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
  /** Photos and videos in the trip, not counting any taken out of it. */
  files: number;
  sample: SampleTile[];
  /** Ids of every file taken out of the trip. */
  excluded: number[];
}

/** What a trip's dates take in, for the trip form. */
export interface TripMatches {
  /** Every photo and video taken within the dates, newest first, without trip bands. */
  tiles: Tile[];
  /** Why the dates can't be used (they overlap another trip). */
  problem: string | null;
}

export interface TripDraft {
  name: string;
  startAt: string;
  endAt: string;
  /**
   * Photos within the dates to leave out of the trip; they stay in their month folders.
   * Omitted keeps an edited trip's exclusions as they are.
   */
  excluded?: number[];
}

export type TripChange =
  | { action: "create"; draft: TripDraft }
  | { action: "update"; id: number; draft: TripDraft }
  | { action: "delete"; id: number };

/** Photos or videos that are identical, byte for byte. Mirrors DupSet in duplicates.rs. */
export interface DupSet {
  hash: string;
  size: number;
  kind: "photo" | "raw" | "video";
  /** Suggested keeper first. */
  copies: DupCopy[];
}

export interface DupCopy {
  id: number;
  version: number;
  /** Relative to the library folder. */
  path: string;
  /** Already in the trip or month folder it belongs in. */
  inPlace: boolean;
  /** Other files that travel with this copy (a Live Photo video, a sidecar). */
  extra: number;
}

export interface DupReport {
  sets: DupSet[];
  /** Files that share a size with another but haven't been compared yet. */
  unchecked: number;
  /** Copies beyond the first in every set. */
  extra: number;
  /** Space those extra copies take. */
  bytes: number;
}

/** One set's outcome: the copy to keep and the copies to send to the Recycle Bin. */
export interface DupChoice {
  keep: number;
  remove: number[];
}

/** A memory card or phone that is plugged in. Mirrors Device in devices.rs. */
export interface ImportDevice {
  /** "drive": a removable drive with a DCIM folder; "phone": a phone or camera over USB. */
  kind: "drive" | "phone";
  /** The drive's root folder, or the phone's Windows device id. */
  id: string;
  name: string;
}

/** Where to import from. Mirrors SourceSpec in import.rs. */
export type ImportSource =
  | { kind: "folder"; path: string; moveFiles: boolean }
  | { kind: "drive"; path: string; name: string }
  | { kind: "phone"; id: string; name: string };

/** What an import will do. Mirrors ImportPreview in import.rs. */
export interface ImportPreview {
  id: number;
  /** "EOS_DIGITAL (E:)", a phone's name, or a folder's name. */
  source: string;
  /** What was looked through, so it can be checked again. */
  spec: ImportSource;
  /** Files are moved in from a folder rather than copied. */
  moving: boolean;
  /** Files that will come in, and their total size. */
  files: number;
  bytes: number;
  /** Files already in the library (or found twice at the source). */
  already: number;
  alreadyBytes: number;
  /** Sidecar files whose photo isn't there, never brought in. */
  leftAlone: number;
  /** Files at the source that aren't photos or videos. */
  otherFiles: number;
  /** Groups that get a number added to their names because the name is taken. */
  renamed: number;
  folders: { folder: string; files: number }[];
  items: ImportItem[];
}

/**
 * One incoming photo plus its companions. Items are listed in plan order, so an item's index
 * is what {@link api.applyImport} is told to leave out.
 */
export interface ImportItem {
  /** Thumbnail id, "i<preview id>-<n>". */
  thumb: string;
  version: number;
  /** Relative to the source. */
  from: string;
  /** Relative to the library folder. */
  to: string;
  extra: number;
  /** Size of the photo and its companions together. */
  bytes: number;
  takenAt: string;
  /** Date guessed from the file's modified time. */
  uncertain: boolean;
  kind: MediaKind;
  ext: string;
  renamed: boolean;
}

/** A file in an import preview, for the viewer. Mirrors ImportFile in import.rs. */
export interface ImportFile {
  path: string;
  /** A photo the webview can show as it is. */
  viewable: boolean;
  /** A video the webview can play. */
  playable: boolean;
}

/** A stretch of days that looks like a trip. Mirrors Suggestion in suggest.rs. */
export interface Suggestion {
  /** First and last day, "YYYY-MM-DD". */
  startDay: string;
  endDay: string;
  /** A place name, or "Trip 12-18 Mar 2025". */
  name: string;
  /** The name came from where the photos were taken. */
  namedByPlace: boolean;
  /** Photos and videos taken during those days. */
  files: number;
  /** Days spent more than 50 km from home. */
  awayDays: number;
  /** How far from home those days were, in km. */
  awayKm: number | null;
  sample: SampleTile[];
}

export interface Suggestions {
  /** Newest first. */
  suggestions: Suggestion[];
  /** Where home is, when it's set or could be worked out. */
  home: { place: string | null; set: boolean } | null;
  /** Suggestions hidden because they were dismissed. */
  dismissed: number;
  /** Photos and videos in a day for it to count as busy. */
  minPhotos: number;
  /** Photos and videos with a location. */
  located: number;
}

/** Sent with the full device list whenever a card or phone comes or goes. */
export const DEVICES_CHANGED = "devices://changed";

/** What the inbox watcher is doing. Mirrors WatchStatus in watch.rs. */
export interface WatchStatus {
  /** Folders being watched (or that would be, when paused). */
  folders: string[];
  /** Inbox folders that can't be found, so aren't watched. */
  missing: string[];
  paused: boolean;
  /** Files seen arriving that haven't finished copying yet. */
  waiting: number;
}

/** Sent with a WatchStatus whenever the folders, the pause or the waiting count change. */
export const WATCH_CHANGED = "watch://changed";

/** Codecs Windows gets from Microsoft Store extensions. */
export type Codec = "heif" | "hevc" | "raw" | "av1";
/** Store pages: one per codec, plus the paid HEVC listing for PCs the free one isn't offered on. */
export type StoreProduct = Codec | "hevc_paid";

/** How month and trip folders are named. Mirrors Naming in naming.rs. */
export interface Naming {
  /** "2026\2026-03", "2026\03 March" or "2026\March 2026". */
  months: "year-month" | "number-name" | "name-year";
  /** "2026-03-12 Japan", "Japan 2026" or "2026 Japan". */
  trips: "date-name" | "name-year" | "year-name";
}

/** Sent with a {@link SettingChange} when the menu bar saves a setting. */
export const SETTING_CHANGED = "settings://changed";

export interface SettingChange {
  key: string;
  value: string;
}

/** Sent with the new on/off state whenever Start with Windows changes. */
export const AUTOSTART_CHANGED = "autostart://changed";

/** A newer version of Pic Cabinet on offer. */
export interface UpdateAvailable {
  version: string;
  /** Its changelog section, in the release script's markdown. */
  notes: string | null;
}

/** How far an update install has got. */
export type UpdateProgress =
  /** `total` is null when the server doesn't give a size. */
  | { stage: "downloading"; done: number; total: number | null }
  /** Downloaded; waiting for the running job of this kind to finish. */
  | { stage: "waiting"; kind: string }
  /** The installer is starting and the app is about to close. */
  | { stage: "installing" };

/** Sent with an {@link UpdateAvailable} whenever a check (the daily one too) finds a newer version. */
export const UPDATE_AVAILABLE = "update://available";
/** Sent with an {@link UpdateProgress} while an update installs. */
export const UPDATE_PROGRESS = "update://progress";

export const api = {
  /** Tells the engine the page loaded, so it doesn't restart to fix a blank window. */
  frontendReady: () => invoke<void>("frontend_ready"),
  getSettings: () => invoke<Settings>("get_settings"),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  /** Turn Start with Windows on or off; the menu bar's tick follows. */
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  /** Run a menu bar item by id, for its keyboard shortcut. */
  menuAction: (id: string) => invoke<void>("menu_action", { id }),
  /** The update the last check found, without checking again. */
  updateStatus: () => invoke<UpdateAvailable | null>("update_status"),
  /** Ask the releases page for a newer version; null when this is the latest. */
  checkForUpdate: () => invoke<UpdateAvailable | null>("check_for_update"),
  /** Download and install the update, then reopen the app (progress on UPDATE_PROGRESS). */
  installUpdate: () => invoke<void>("install_update"),
  indexLibrary: () => invoke<void>("index_library"),
  jobStatus: () => invoke<JobProgress | null>("job_status"),
  cancelJob: () => invoke<void>("cancel_job"),
  libraryTiles: () => invoke<Tile[]>("library_tiles"),
  mediaDetail: (id: number) => invoke<MediaDetail>("media_detail", { id }),
  openMedia: (id: number) => invoke<void>("open_media", { id }),
  revealMedia: (id: number) => invoke<void>("reveal_media", { id }),
  openNotices: () => invoke<void>("open_notices"),
  installedExtensions: () => invoke<Codec[]>("installed_extensions"),
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
  /** Preview renaming every sorted folder to new presets; apply it with {@link api.applyPlan}. */
  planNaming: (naming: Naming) => invoke<Preview>("plan_naming", { naming }),
  /** Compare same-size files in the background (job kind "duplicates"). */
  findDuplicates: () => invoke<void>("find_duplicates"),
  listDuplicates: () => invoke<DupReport>("list_duplicates"),
  /** Send copies to the Recycle Bin in the background (job kind "remove"). */
  removeDuplicates: (choices: DupChoice[]) => invoke<void>("remove_duplicates", { choices }),
  importSources: () => invoke<ImportDevice[]>("import_sources"),
  /** Look through a source in the background (job kind "import-scan", result ImportPreview). */
  scanImport: (source: ImportSource) => invoke<void>("scan_import", { source }),
  /** The latest import preview, if it hasn't been used. */
  importPreview: () => invoke<ImportPreview | null>("import_preview"),
  /**
   * Bring a previewed import in (job kind "import", result ApplySummary), leaving out the
   * items at the `skip` indexes.
   */
  applyImport: (id: number, skip: number[]) => invoke<void>("apply_import", { id, skip }),
  /** Drop an import preview (and any phone files copied off for it). */
  discardImport: (id: number) => invoke<void>("discard_import", { id }),
  importFile: (id: number, item: number) => invoke<ImportFile>("import_file", { id, item }),
  openImportFile: (id: number, item: number) => invoke<void>("open_import_file", { id, item }),
  revealImportFile: (id: number, item: number) => invoke<void>("reveal_import_file", { id, item }),
  suggestTrips: () => invoke<Suggestions>("suggest_trips"),
  /** Hide a suggestion while its dates overlap these. */
  dismissSuggestion: (startDay: string, endDay: string) =>
    invoke<void>("dismiss_suggestion", { startDay, endDay }),
  /** Show every dismissed suggestion again. */
  restoreDismissed: () => invoke<void>("restore_dismissed"),
  watchStatus: () => invoke<WatchStatus>("watch_status"),
  /** Pause or resume the inbox watcher (job kind "inbox" moves in what arrives). */
  setWatchPaused: (paused: boolean) => invoke<WatchStatus>("set_watch_paused", { paused }),
  /** The town nearest a typed "lat, lon", e.g. "Auckland, New Zealand"; null out at sea. */
  homePlace: (location: string) => invoke<string | null>("home_place", { location }),
};

/**
 * Image URL for a media id on the thumb:// scheme.
 * @param id - media id (the group leader for tiles), or an import preview's thumbnail id
 * @param version - file version, so a changed file never shows a stale cached image
 * @param full - the full-size preview instead of the grid thumbnail
 * @returns the URL
 */
export function thumbUrl(id: number | string, version: number, full = false): string {
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
