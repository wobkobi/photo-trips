// Typed wrappers around the Rust commands (src-tauri/src/*.rs).

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type Settings = Record<string, string>;

export type MediaKind = "photo" | "raw" | "video" | "companion";

/** Where a file's date came from, best first. Mirrors DateSource in dates.rs. */
export type DateSource =
  "set" | "exif" | "video" | "windows" | "exiftool" | "filename" | "modified";

/** One grid tile: a photo or video plus any files that travel with it. */
export interface Tile {
  id: number;
  takenAt: string;
  kind: MediaKind;
  ext: string;
  /** The file name, for finding it by name. */
  name: string;
  /** Date guessed from the file's modified time. */
  uncertain: boolean;
  /** Date set in Pic Cabinet, over the file's own. */
  dateSet: boolean;
  /** Companion files (Live Photo video, RAW twin, sidecars). */
  extra: number;
  /** A photo with its Live Photo clip. */
  live: boolean;
  /** A photo with a RAW copy of itself. */
  rawTwin: boolean;
  /** Names of the companion files, so a name search finds the tile by them. */
  linked: string[];
  version: number;
  /** Trip the photo was taken during. */
  trip: TileTrip | null;
  /** The file is 0 bytes, so it has no picture whatever codecs are installed. */
  empty: boolean;
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
  path: string;
  name: string;
  kind: MediaKind;
  size: number;
  /** A video the built-in player should try. */
  playable: boolean;
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
  /** Gone from disk since the library was last looked through (deleted or moved in Explorer). */
  missing: boolean;
  /** The file on disk is 0 bytes, usually from a copy that didn't finish. */
  empty: boolean;
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
  /** Folders that couldn't be read; their photos stay listed until they can be. */
  unreadable: number;
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
  /**
   * Id of the tile this copy belongs to. A copied Live Photo or RAW+JPEG pair makes one set
   * per kind, and its copies share these ids across the sets.
   */
  group: number;
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
  /** Phone files that couldn't be read, left on the phone with the files that go with them. */
  unreadable: number;
  /** Empty (0 byte) files, usually from a copy that didn't finish. Left out. */
  empty: number;
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
  /** Gone since the preview was made (deleted, or the card removed). */
  missing: boolean;
}

/**
 * What a file says about itself, read when the viewer shows it. Mirrors Details in details.rs;
 * each field is null when the file doesn't record it.
 */
export interface FileDetails {
  make: string | null;
  model: string | null;
  lens: string | null;
  /** Pixels as the photo is shown, so a portrait photo is taller than wide. */
  width: number | null;
  height: number | null;
  /** A video's length in seconds. */
  duration: number | null;
  fNumber: number | null;
  /** Seconds. */
  exposure: number | null;
  iso: number | null;
  /** Millimetres, as fitted and as the full-frame equivalent. */
  focalLength: number | null;
  focal35: number | null;
  lat: number | null;
  lon: number | null;
}

/** A town named on a location map. Mirrors Label in map.rs. */
export interface MapLabel {
  name: string;
  x: number;
  y: number;
  /** The name goes left of the dot, since it would run off the right edge. */
  left: boolean;
  /** False for the town under the pin: the name sits beside the pin and there's no dot. */
  dot: boolean;
  /** The town nearest the photo. */
  nearest: boolean;
}

/** The offline map around a photo's location, the photo at the centre. Mirrors MapView in map.rs. */
export interface MapView {
  width: number;
  height: number;
  /** SVG path data. */
  land: string;
  lakes: string;
  borders: string;
  labels: MapLabel[];
  scaleLength: number;
  scaleLabel: string;
  /** "Rotorua, Bay of Plenty, New Zealand", or null when no town is near enough to name. */
  place: string | null;
}

/** A stretch of days that looks like a trip. Mirrors Suggestion in suggest.rs. */
export interface Suggestion {
  /** First and last day, "YYYY-MM-DD". */
  startDay: string;
  endDay: string;
  /** A place name, or just "Trip"; the trip folder name adds the dates. */
  name: string;
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
  /**
   * Tells the engine the page loaded, so it doesn't restart to fix a blank window.
   * @returns resolves once the engine has noted it
   */
  frontendReady: () => invoke<void>("frontend_ready"),
  /**
   * Read every stored setting.
   * @returns the settings
   */
  getSettings: () => invoke<Settings>("get_settings"),
  /**
   * Store one setting; the engine refuses unknown keys and invalid values.
   * @param key - setting name
   * @param value - new value, as text
   * @returns resolves once stored, rejects with the reason it was refused
   */
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  /**
   * Turn Start with Windows on or off; the menu bar's tick follows.
   * @param enabled - whether the app starts with Windows
   * @returns resolves once changed
   */
  setAutostart: (enabled: boolean) => invoke<void>("set_autostart", { enabled }),
  /**
   * Run a menu bar item by id, for its keyboard shortcut.
   * @param id - menu item id
   * @returns resolves once the item has run
   */
  menuAction: (id: string) => invoke<void>("menu_action", { id }),
  /**
   * Put the window in or out of fullscreen; the menu bar hides while it is in.
   * @param on - true to enter fullscreen, false to leave it
   * @returns resolves once changed
   */
  setFullscreen: (on: boolean) => invoke<void>("set_fullscreen", { on }),
  /**
   * The update the last check found, without checking again.
   * @returns the update, or null when none was found
   */
  updateStatus: () => invoke<UpdateAvailable | null>("update_status"),
  /**
   * Ask the releases page for a newer version; null when this is the latest.
   * @returns the newer version, or null
   */
  checkForUpdate: () => invoke<UpdateAvailable | null>("check_for_update"),
  /**
   * Download and install the update, then reopen the app (progress on UPDATE_PROGRESS).
   * @returns resolves once the install has started
   */
  installUpdate: () => invoke<void>("install_update"),
  /**
   * Start indexing the library in the background.
   * @returns resolves once the job has started
   */
  indexLibrary: () => invoke<void>("index_library"),
  /**
   * The running job's latest progress.
   * @returns the progress, or null when idle
   */
  jobStatus: () => invoke<JobProgress | null>("job_status"),
  /**
   * Ask the running job to stop.
   * @returns resolves once the request is sent
   */
  cancelJob: () => invoke<void>("cancel_job"),
  /**
   * Every group in the library, newest first.
   * @returns the tiles
   */
  libraryTiles: () => invoke<Tile[]>("library_tiles"),
  /**
   * One indexed file's path, date and where the date came from.
   * @param id - media id
   * @returns the detail
   */
  mediaDetail: (id: number) => invoke<MediaDetail>("media_detail", { id }),
  /**
   * Camera, size and settings, read from the file itself.
   * @param id - media id
   * @returns the file's details
   */
  mediaDetails: (id: number) => invoke<FileDetails>("media_details", { id }),
  /**
   * The offline map around a location, `spanKm` from top to bottom.
   * @param lat - latitude in degrees
   * @param lon - longitude in degrees
   * @param spanKm - map height in kilometres
   * @returns the map
   */
  locationMap: (lat: number, lon: number, spanKm: number) =>
    invoke<MapView>("location_map", { lat, lon, spanKm }),
  /**
   * Open an indexed file in its default Windows app.
   * @param id - media id
   * @returns resolves once opened
   */
  openMedia: (id: number) => invoke<void>("open_media", { id }),
  /**
   * Show an indexed file selected in Explorer.
   * @param id - media id
   * @returns resolves once shown
   */
  revealMedia: (id: number) => invoke<void>("reveal_media", { id }),
  /**
   * Put an indexed file on the clipboard, to paste into a folder, an email or a chat.
   * @param id - media id
   * @returns resolves once it's on the clipboard
   */
  copyMedia: (id: number) => invoke<void>("copy_media", { id }),
  /**
   * Set the date of photos, with the files that go with them, in Pic Cabinet only: the files
   * aren't changed. History can undo it.
   * @param ids - the photos' media ids
   * @param date - local time, `YYYY-MM-DDTHH:MM:SS`, or null to go back to the files' own dates
   * @returns the History batch id, for an Undo button
   */
  setDates: (ids: number[], date: string | null) => invoke<number>("set_dates", { ids, date }),
  /**
   * Send photos and the files that go with them to the Recycle Bin, in the background, as one
   * change History can undo.
   * @param ids - the photos' media ids
   * @returns resolves once the job has started
   */
  recycleMedia: (ids: number[]) => invoke<void>("recycle_media", { ids }),
  /**
   * Open the library folder in Explorer.
   * @returns resolves once opened
   */
  openLibrary: () => invoke<void>("open_library"),
  /**
   * Open the third-party notices installed with the app.
   * @returns resolves once opened
   */
  openNotices: () => invoke<void>("open_notices"),
  /**
   * Name of the app Windows opens this extension with, or null when it would ask.
   * @param ext - file extension
   * @returns the app name, or null
   */
  defaultApp: (ext: string) => invoke<string | null>("default_app", { ext }),
  /**
   * The codecs this user already has, so the Library only suggests ones that would help.
   * @returns the installed codecs
   */
  installedExtensions: () => invoke<Codec[]>("installed_extensions"),
  /**
   * Open an extension's page in the Microsoft Store app.
   * @param product - the extension
   * @returns resolves once opened
   */
  openStorePage: (product: StoreProduct) => invoke<void>("open_store_page", { product }),
  /**
   * Work out the moves that would put every file in its trip or year and month folder.
   * @returns the preview; apply it with {@link api.applyPlan}
   */
  planOrganise: () => invoke<Preview>("plan_organise"),
  /**
   * Run a previewed plan in the background as one undoable batch.
   * @param id - preview id
   * @param skip - photos (leader media ids) to leave where they are; a sort only
   * @returns resolves once the job has started
   */
  applyPlan: (id: number, skip: number[] = []) => invoke<void>("apply_plan", { id, skip }),
  /**
   * Every undoable change, for History, newest first.
   * @param limit - how many to list
   * @returns the batches
   */
  listBatches: (limit: number) => invoke<BatchInfo[]>("list_batches", { limit }),
  /**
   * The files one batch touched, in the order it touched them.
   * @param batchId - batch id
   * @returns the entries
   */
  batchEntries: (batchId: number) => invoke<BatchEntry[]>("batch_entries", { batchId }),
  /**
   * Show a file a batch touched selected in Explorer, wherever it is now.
   * @param batchId - batch id
   * @param seq - the file's place in the batch
   * @returns resolves once shown
   */
  revealEntry: (batchId: number, seq: number) => invoke<void>("reveal_entry", { batchId, seq }),
  /**
   * Open a file a batch touched in its default app, wherever it is now.
   * @param batchId - batch id
   * @param seq - the file's place in the batch
   * @returns resolves once opened
   */
  openEntry: (batchId: number, seq: number) => invoke<void>("open_entry", { batchId, seq }),
  /**
   * Put back the files a batch moved, in the background.
   * @param batchId - batch id
   * @returns resolves once the job has started, rejects when the batch can't be undone
   */
  undoBatch: (batchId: number) => invoke<void>("undo_batch", { batchId }),
  /**
   * Every saved trip.
   * @returns the trips
   */
  listTrips: () => invoke<TripInfo[]>("list_trips"),
  /**
   * The photos a draft's dates take in, and whether the dates can be used.
   * @param startAt - first moment of the trip
   * @param endAt - last moment of the trip
   * @param editing - id of the trip being edited, so it doesn't overlap itself; null for a new one
   * @returns the matches
   */
  tripMatches: (startAt: string, endAt: string, editing: number | null) =>
    invoke<TripMatches>("trip_matches", { startAt, endAt, editing }),
  /**
   * Preview a trip change; apply it with {@link api.applyPlan}.
   * @param change - the trip to create, update or delete
   * @returns the preview
   */
  planTrip: (change: TripChange) => invoke<Preview>("plan_trip", { change }),
  /**
   * Preview renaming every sorted folder to new presets; apply it with {@link api.applyPlan}.
   * @param naming - the new presets
   * @returns the preview
   */
  planNaming: (naming: Naming) => invoke<Preview>("plan_naming", { naming }),
  /**
   * Compare same-size files in the background (job kind "duplicates").
   * @returns resolves once the job has started
   */
  findDuplicates: () => invoke<void>("find_duplicates"),
  /**
   * Every duplicate set found so far, with a suggested keeper for each.
   * @returns the report
   */
  listDuplicates: () => invoke<DupReport>("list_duplicates"),
  /**
   * Send copies to the Recycle Bin in the background (job kind "remove").
   * @param choices - which file to keep in each set
   * @returns resolves once the job has started
   */
  removeDuplicates: (choices: DupChoice[]) => invoke<void>("remove_duplicates", { choices }),
  /**
   * Cards and phones connected now.
   * @returns the devices
   */
  importSources: () => invoke<ImportDevice[]>("import_sources"),
  /**
   * Look through a source in the background (job kind "import-scan", result ImportPreview).
   * @param source - the card, phone or folder to scan
   * @returns resolves once the job has started
   */
  scanImport: (source: ImportSource) => invoke<void>("scan_import", { source }),
  /**
   * The latest import preview, if it hasn't been used.
   * @returns the preview, or null
   */
  importPreview: () => invoke<ImportPreview | null>("import_preview"),
  /**
   * Bring a previewed import in (job kind "import", result ApplySummary), leaving out the
   * items at the `skip` indexes.
   * @param id - import preview id
   * @param skip - indexes of the items to leave out
   * @returns resolves once the job has started
   */
  applyImport: (id: number, skip: number[]) => invoke<void>("apply_import", { id, skip }),
  /**
   * Drop an import preview (and any phone files copied off for it).
   * @param id - import preview id
   * @returns resolves once dropped
   */
  discardImport: (id: number) => invoke<void>("discard_import", { id }),
  /**
   * Show a file from an import preview in the viewer; its path is let into the asset protocol.
   * @param id - import preview id
   * @param item - index of the item in the preview
   * @returns the file's path and whether the webview can show it
   */
  importFile: (id: number, item: number) => invoke<ImportFile>("import_file", { id, item }),
  /**
   * What a file from an import preview says about itself: camera, size, settings and location.
   * @param id - import preview id
   * @param item - index of the item in the preview
   * @returns the file's details
   */
  importFileDetails: (id: number, item: number) =>
    invoke<FileDetails>("import_file_details", { id, item }),
  /**
   * Open a file from an import preview in its default Windows app.
   * @param id - import preview id
   * @param item - index of the item in the preview
   * @returns resolves once opened
   */
  openImportFile: (id: number, item: number) => invoke<void>("open_import_file", { id, item }),
  /**
   * Show a file from an import preview selected in Explorer.
   * @param id - import preview id
   * @param item - index of the item in the preview
   * @returns resolves once shown
   */
  revealImportFile: (id: number, item: number) => invoke<void>("reveal_import_file", { id, item }),
  /**
   * Trips the library looks like it holds, with photo counts, names and sample photos.
   * @returns the suggestions
   */
  suggestTrips: () => invoke<Suggestions>("suggest_trips"),
  /**
   * Hide a suggestion while its dates overlap these.
   * @param startDay - first day of the suggestion
   * @param endDay - last day of the suggestion
   * @returns resolves once dismissed
   */
  dismissSuggestion: (startDay: string, endDay: string) =>
    invoke<void>("dismiss_suggestion", { startDay, endDay }),
  /**
   * Show every dismissed suggestion again.
   * @returns resolves once restored
   */
  restoreDismissed: () => invoke<void>("restore_dismissed"),
  /**
   * The inbox watcher's state, for the Settings page.
   * @returns the watcher's state
   */
  watchStatus: () => invoke<WatchStatus>("watch_status"),
  /**
   * Pause or resume the inbox watcher (job kind "inbox" moves in what arrives).
   * @param paused - whether the watcher should be paused
   * @returns the watcher's new state
   */
  setWatchPaused: (paused: boolean) => invoke<WatchStatus>("set_watch_paused", { paused }),
  /**
   * The town nearest a typed "lat, lon", e.g. "Auckland, New Zealand"; null out at sea.
   * @param location - the typed coordinates
   * @returns the place name, or null
   */
  homePlace: (location: string) => invoke<string | null>("home_place", { location }),
  /**
   * Where Windows says the computer is, read once.
   * @returns "lat, lon"
   */
  currentLocation: () => invoke<string>("current_location"),
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

/**
 * Error text from a rejected command (commands reject with a plain string).
 * @param err - the rejection reason
 * @returns text to show the user
 */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
