# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.16.0] - 2026-11-15

### Added

- Choose how folders are named in Settings: month folders as 2026\2026-03, 2026\03 March or
  2026\March 2026, and trip folders as 2026-03-12 Japan, Japan 2026 or 2026 Japan. Each drop-down
  shows example folders and a sentence shows where a photo and a trip would go. A change renames the
  folders already in the library as one previewed batch that can be undone, and trips that would
  share a name get (2) added.

## [0.15.0] - 2026-11-15

### Added

- Leave photos out of a trip. The trip form shows every photo from its dates with a tick; unticked
  photos stay in their month folders, stay out when the dates change, and can be ticked again by
  editing the trip. Photos picked in the Library start as the only ones ticked, and a suggestion's
  Change or pick photos button opens the same form.

## [0.14.0] - 2026-11-15

### Added

- Choose which photos to bring in. After a check, every new photo is shown with a tick; untick any
  you don't want, or untick a whole month, and only the ticked ones are copied or moved in. Unticked
  photos stay where they are and show up again on the next check.

## [0.13.0] - 2026-11-15

### Added

- Bigger text, buttons and photos throughout, with stronger contrast. Settings > Display has a Text
  size (Standard to Largest) and a Photo size (Small, Medium, Large). The Library has a Pick photos
  for a trip button, so making a trip no longer needs right-click or Ctrl-click. Switches say On or
  Off, and the photo viewer's buttons are labelled.

## [0.12.0] - 2026-11-15

### Added

- Renamed to Pic Cabinet. Installing it replaces an installed Photo Trips, keeps your library,
  settings and history, and keeps Start with Windows on if it was.

## [0.11.0] - 2026-11-14

### Added

- Updates. Settings > About checks for a newer version, shows what changed and installs it with
  Install and restart. The app also checks once a day and says so once per version, and the tray and
  Help menu have Check for updates. Updates are signed, and one signed for a different version is
  refused. npm run release publishes a version.

## [0.10.1] - 2026-11-14

### Fixed

- Importing from an iPhone found nothing. Its photos have no display name, only a file name, and the
  phone reader stopped at the first one; there is also no DCIM folder, as an iPhone keeps its month
  folders straight under its storage. Phones are now read through Windows directly, by file name,
  from DCIM where a phone has it and the whole storage where it doesn't, and only ever read-only.

## [0.10.0] - 2026-11-14

### Added

- A menu bar on the window: File (import, refresh, open the library folder, close, quit), View
  (every page, with Ctrl+1 to Ctrl+7), Options (settings, pause watching, keep running in the tray,
  start with Windows) and Help (log folder, About). Settings has an About section with the version.

## [0.9.4] - 2026-11-14

### Fixed

- Thumbnails of transparent images had the old dark theme colour behind them. Thumbnails now use the
  light tile colour and full-size previews the viewer's black, and thumbnails cached with the old
  colour are made again.

## [0.9.3] - 2026-11-14

### Fixed

- The Library's codec hint suggested extensions that were already installed, and linked only the
  free HEVC listing, which the Store doesn't offer on every PC. It now suggests only missing
  extensions, suggests HEVC for HEIC photos as well as HEIF, and links the paid HEVC listing for PCs
  the free one isn't offered on.

## [0.9.1] - 2026-11-14

### Fixed

- The installer's exe showed the previous version in its file details after a version-only change.
  The build now reruns when package.json changes.

## [0.9.0] - 2026-11-13

### Changed

- Photo Trips wears the To the Point Tech brand: Exo type, a russian-violet sidebar with the chip
  mark, seasalt pages with white panels and violet headings, and moonstone for selection and focus.
  Photos opened large still sit on a dark ground. Trip colours come from the brand palette, and the
  app icon is redrawn in brand colours.

## [0.8.1] - 2026-11-13

### Fixed

- The inbox notification says "It came from an inbox folder" when a single file comes in, instead of
  "They came".

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
