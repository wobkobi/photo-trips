# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-11-13

### Added

- Inbox folders. New photos and videos put in a watched folder move into the library by themselves once they finish copying, each to its month or trip folder. Copies of photos already in the library stay where they are, and each batch can be undone from History.
- A notification says how many files came in from an inbox while Photo Trips is in the tray or behind other windows.
- Pause watching from the tray or from Settings. Anything put in an inbox while paused, or while Photo Trips wasn't running, moves in on resuming or at the next start.
- An inbox folder on a drive that's unplugged shows as missing in Settings and is watched again within about 30 seconds of the drive coming back.
- Settings for trip suggestions: how many photos and videos make a busy day, and where home is. Home is pasted from a map as latitude and longitude, and the nearest town is shown to confirm it.
- Extra photo and video file types can be added in Settings.
- An app icon and a Windows installer.
- A log file in the app's data folder (`logs\Photo Trips.log`) records problems with background work like the inbox watcher.

## [0.7.0] - 2026-11-13

### Added

- Suggestions page that finds trips you haven't made yet. Two or more busy days in a row (15 or more photos and videos each, with up to one quiet day between) make a suggestion.
- Days spent more than 50 km from home are suggested too, however few photos they have. Home is worked out from where photos were taken on the most days, and the page says where that is.
- Each suggestion is named after where its photos were taken, like "Tokyo" or "Kyoto and Tokyo", with no internet needed. Without locations it's named by its dates, like "Trip 1-2 Feb 2025".
- Each suggestion shows its dates, why it was suggested, and some of its photos. Create trip previews the moves like any new trip, and the result can be undone. Change lets you rename it or move its first and last days first, with a live count of the photos those days take in.
- Not a trip hides a suggestion, and hidden ones can be shown again. Days already in a trip are never suggested.

## [0.6.0] - 2026-11-13

### Added

- Import page that brings in photos and videos from a memory card, a phone or a folder on this PC. A check lists what's new first, with every incoming file and the folder it goes to, and nothing comes in until you choose to.
- Anything already in your library stays out, even under a different name. Checking the same card again finds nothing new.
- New photos go straight into their trip's folder, or the folder for the month they were taken, with their companion files. Name clashes get a number added, so no file in the library is ever replaced.
- Cards and phones are copied from and never changed. A folder on this PC can be copied or moved in; when moving, copies of photos you already have stay behind.
- Memory cards (a removable drive with a DCIM folder) and phones or cameras connected by cable show up on the Import page by themselves. Plugging one in shows a notification, and the tray menu offers "Import from <name>...", which opens the Import page and starts the check.
- Phone photos are read onto this PC to compare them, and what was read is remembered, so later checks of the same phone are quicker.
- The Library's empty state offers Import photos, and the first-run screen mentions bringing in photos kept elsewhere.
- Undoing an import from History sends the copies to the Recycle Bin (the originals stay where they were), or puts moved files back where they came from. An import interrupted by a crash is settled the next time Photo Trips starts.

## [0.5.0] - 2026-11-13

### Added

- Duplicates page that finds photos and videos that are exact copies of each other, even under different names. Only files that share a size with another file are read, so checking a large library is quick.
- Each set suggests which copy to keep: the one already in its trip or month folder, otherwise the oldest. Click another copy to keep it instead, or Keep all to leave a set alone.
- Extra copies go to the Recycle Bin, never deleted outright, along with sidecar files that only belonged to them. Each copy and the copy being kept are checked again just before, so a file that changed since the check is kept.
- Undoing a clean-up from History takes the copies back out of the Recycle Bin and puts them back in the library.

## [0.4.0] - 2026-11-13

### Added

- Trips page: give a trip a name and dates (with optional times for travel days), and every photo and video taken during it moves into its own folder, `Trips\2025-03-12 Japan`. The form shows a live count and sample photos for the dates, and refuses dates that overlap another trip.
- Editing a trip's name renames its folder; changing its dates moves only the photos that join or leave it; deleting a trip puts its photos back in their month folders. Each change is previewed first and can be undone from History, which also puts the trip back as it was.
- Trip photos show a coloured band in the Library. Ctrl-click, Shift-click or right-click selects photos, and "Create trip" starts a trip covering the selected days.

### Changed

- Sort puts photos taken during a trip into the trip's folder instead of their month folder.

## [0.3.0] - 2026-11-13

### Added

- Sort page that moves every photo and video into a folder for the month it was taken (`2025\2025-03`), with a full preview of every move before anything happens.
- Companion files (Live Photo videos, RAW twins, sidecars) always move with their photo; if one can't move, the rest of its group goes back.
- Name clashes get a number added (`IMG_1 (1).jpg`) across the whole group, so no file is ever replaced.
- History page listing every change, with the files each one moved and why any couldn't be, and undo for each change.
- Moves are logged before they run, so a change interrupted by a crash or power cut is settled the next time Photo Trips starts.
- Moves to another drive copy the file, check the copy matches, then remove the original.
- Folders left empty by a move are removed (inside the library folder only).

## [0.2.0] - 2026-11-13

### Added

- Library index that finds when every photo and video was taken: camera data, video metadata, Windows file properties, the bundled ExifTool, the file name, then the modified time as a last resort. Indexing never changes a file.
- Library timeline grouped by month, with Windows thumbnails for every format Windows can preview and a "date uncertain" badge on guessed dates.
- Live Photo videos, RAW+JPEG pairs and sidecar files shown as one tile so they always move together.
- Viewer with full-size previews for formats the window can't draw itself (TIFF, HEIC, RAW) and an "Open with Windows" fallback for videos it can't play.
- Progress and cancel for background tasks in the sidebar.
- Hint pointing to the free Microsoft Store codec extensions when Windows can't preview some files.

## [0.1.0] - 2026-11-13

### Added

- Tauri app shell with system tray, close-to-tray, single instance and start with Windows.
- First-run library folder picker and settings page.
- Pinned ExifTool download for the installer.
