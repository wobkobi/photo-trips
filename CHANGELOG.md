# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
