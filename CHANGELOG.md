# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
