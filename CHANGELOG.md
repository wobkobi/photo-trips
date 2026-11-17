# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.25.0] - 2026-11-17

### Added

- Right-clicking a photo in the Library offers Open, Show in folder and Copy path.
- A photo that has gone from disk has a button to look for new photos.
- Settings can open the library folder, asks before switching to another one, and can show the
  missing extension tip again once it's hidden.
- After an import, See in Library goes straight to the new photos.
- History can show or open each file wherever it is now, lists older changes on request rather
  than stopping at 200, and offers to sort or import again when some files failed.
- Arrow keys move between photos in the grid, Ctrl+A picks every photo shown, Home and End go to the
  first and last photo in the viewer, and Help lists them.

## [0.24.0] - 2026-11-16

### Added

- One busy day away from home is suggested as a day trip.
- Suggestion previews are much bigger, filling the card with photos spread through the trip; the
  buttons drop under the words in a narrow window.
- A trip over New Year gets both years in its folder, such as Tairua 2025-26, and each suggestion is
  titled the way its trip folder will be.
- The trip editor shows the folder a trip will get, Settings shows how a trip over New Year is
  named, and a suggestion with no place is called Trip so its folder doesn't repeat the dates.
- Picked photos in the Library can be taken out of their trip, put back in, or added to a trip
  within two weeks of them, from the header or the right-click menu. The viewer shows each photo's
  trip with the same choices.

## [0.23.0] - 2026-11-16

### Added

- A Theme choice in Settings > Display: Light, Dark, or System to follow Windows. The window's title
  bar and menus follow it too.
- Settings > Suggestions has a Use my location button that asks Windows where you are, once, and
  saves that as home.
- A date rail beside the photo grid: drag or click it to jump to a month, or use the arrow and Page
  keys.

### Changed

- A new look that reads more like a photo app: a dark grey theme, a slim toolbar along the top of
  each page, Windows' own font, a quieter menu, and photos packed closer together in the grid.
- The Library's filters sit in one slim row, and Look for new photos is the refresh button beside
  Make a trip.
- Trips show as album cards, each with a cover made from its photos.
- Settings are split into groups (Display, Library, Inbox, Suggestions, File types, Window, About),
  picked from a list down the side.
- Sort, Duplicates, History, Help and Import are quieter: short headings, a one-line summary with
  the fuller notes under Details, and the job status in the menu with a plain Stop button.
- The magnifier on a photo only shows when the mouse is over it.
- The map in the photo viewer is a real street map from OpenFreeMap, light or dark to match the
  theme, and it can be dragged. Open in Google Maps replaces Open in OpenStreetMap. Without an
  internet connection the drawn map is shown instead.
- The photo viewer's side panel is shorter: where a date came from shows on hover, folders read from
  the library folder, and the map has its own zoom buttons. Stepping between photos is quicker,
  since the next and previous ones load ahead and the map stays put.
- Photos in the viewer show at once: the grid thumbnail fills in while the full picture loads, and
  the next two photos each way, with their suburb names, load ahead.
- The viewer's side panel no longer jumps while stepping through photos: it lays out once, with
  Taken, File and Camera first and the map below them.
- Clicking a photo in the viewer opens it in its app.
- The viewer's map draws straight away when stepping between photos: the map tiles around the next photos are fetched ahead.
- Videos in the viewer start at 40% volume instead of full, and keep whatever volume or mute was last set.
- A date taken from when the file last changed is no longer flagged as a warning. Downloads, screenshots and photos from some apps have no date of their own; the reason shows on hover.
- Videos have their own control bar under the picture: play, a seek bar, mute and volume. Click the
  video or press Space to play and pause.
- The viewer's arrows are small round buttons instead of labelled ones.
- The menu and About show the Pic Cabinet icon, matching the taskbar; the To the Point Tech chip
  sits by the copyright, in russian-violet on light and white on dark as on the website.
- Settings has a gear icon in the menu.
- Suggestions leave out busy days at home, and trim home days off either end of a trip.
- Suggested trip names fit how far the photos spread: the town for a stay in one place, the region
  for a road trip, then two towns, then the country.

### Fixed

- Checking an import with lots of notes left the photos in a short strip at the bottom. The notes
  now fold away under Details, and the photos fill the window once you scroll down to them.
- The dark map in the photo viewer was too dim to read. It now has light labels and roads that
  stand out.
- Where a photo was taken now names the suburb, such as Flat Bush rather than Manukau City. The
  name is looked up from OpenStreetMap; without an internet connection the nearest town is shown
  as before.
- The map's credits no longer pop open over the map each time you move to another photo.
- A photo or video deleted or moved while the viewer is open says so instead of showing a broken
  picture.
- Checking a locked phone says to unlock it instead of reporting nothing new.
- The Import review counts photos everywhere: the button, the title and the folder list now match
  the tick count and the month headings. The total of files, with the videos and edits that go with
  them, shows when you hover over the button.
- Review pages with a photo grid don't scroll the whole page when everything fits.
- A photo opened for the first time sharpens sooner: its full picture is drawn before the ones
  fetched ahead and before grid tiles.
- A settings text box shows a value saved from a button beside it, such as Use my location, instead
  of staying empty.
- Home, and trips around a city, go by the city (Auckland) rather than the nearest suburb in the
  place list.

## [0.22.0] - 2026-11-16

### Added

- A Help page in the menu says what each page is for, with a button to open it, and lists the
  keyboard shortcuts. F1 or Help > Pic Cabinet help opens it.
- A short tour of the menu shows once after setup, pointing at each page in turn. Skip it any time,
  or take it again from Help.

## [0.21.1] - 2026-11-16

### Changed

- The Library's filter menus are shorter: each starts with All, and the rest read No trip, Photos,
  Videos and Uncertain dates. The button that resets them is Clear filters.

## [0.21.0] - 2026-11-16

### Added

- When an update skips versions, for example going from 0.18.0 straight to 0.21.0, Settings > About
  lists the changes from every version in between, not just the newest. This starts with the update
  after this one, since the copy already installed does the listing.

## [0.20.1] - 2026-11-16

### Changed

- Behind the scenes only: the code now follows the same formatting and documentation checks as the
  To the Point Tech website, and Tailwind classes use their standard names. Nothing changes in how
  the app works.

## [0.20.0] - 2026-11-16

### Changed

- Trips always cover whole days: the start and end times are gone from the trip editor. A trip saved
  with times takes in the whole of its first and last days the next time it's saved.

## [0.19.1] - 2026-11-16

### Fixed

- At a large text size or on a small window, the photos on the Library, Trips, Import and
  Duplicates pages, and the list of files on the review pages, could shrink to nothing under the
  writing above them, and the mouse wheel did nothing. They now always keep a usable height and
  the page scrolls instead.
- Buttons at the top of a page move onto a new line when they don't fit, instead of squeezing
  their words, and settings put their controls under the words when the window is narrow.
- History, the Trips list and the Import review show whole folder paths instead of cutting them
  off, and long file and folder names elsewhere show in full when the mouse rests on them.
- The viewer's Newer and Older buttons show just their arrows on a narrow window, so they no
  longer cover the photo, and the details panel gives the photo more room.
- The Tick all and Untick all buttons beside each month are shorter ("Tick month"), so a long
  month name can't push them over the photos above.
- On a small window, or at a large text size, the menu down the left narrows to just its icons by
  itself.
- On a narrower window, or at a large text size, the folder list beside an import's photos folds
  away above the photos under "Where they go", instead of disappearing.
- The job progress and its Stop button at the bottom of the menu stay in view on a short window;
  only the list of pages scrolls.

## [0.19.0] - 2026-11-15

### Added

- The folder list beside an import's photos is clickable: clicking a month or trip scrolls to the
  photos going into it.
- The menu down the left can be narrowed to just its icons, giving the pages more room. The
  button for it is at the bottom of the menu, and the choice is remembered.

## [0.18.0] - 2026-11-15

### Added

- The Library can show just one trip, one year, photos or videos, or the photos whose dates may be
  wrong. Clicking a trip on the Trips page, or its See in Library button, opens the Library at that
  trip.
- The viewer shows where a photo was taken on a built-in map with the town's name, the camera or
  phone, the picture's size or video's length, and the camera settings under More details. Open in
  OpenStreetMap shows the spot online, only when clicked.

### Changed

- The library folder at the bottom of the sidebar shows just its name, and clicking it opens it in
  File Explorer.

## [0.17.0] - 2026-11-15

### Added

- A magnifier on each photo opens it full size while picking photos for an import or a trip, and in
  Duplicates; the photos on trip and suggestion cards open with a click. The viewer has its own tick
  (or Keep button), and can open the file in its Windows app or show it in its folder.
- The viewer's open buttons name the app Windows uses for the file, such as "Open in Photos" or
  "Open in VLC media player", or say "Open in default app" when there isn't one. A file Pic Cabinet
  can't show or play gets the same button in place of the picture.

## [0.16.2] - 2026-11-15

### Changed

- Settings > About > Third-party notices opens the list installed with the app, so it works offline
  and always matches the installed version.

## [0.16.1] - 2026-11-15

### Fixed

- If the window stays blank for 30 seconds after starting, Pic Cabinet restarts itself once. Overlay
  or screen-recording software such as RivaTuner can crash the part of Windows that draws the window
  as it opens, and a fresh start usually gets past it. If it's still blank after the restart, Pic
  Cabinet stays open and names the likely cause in its log. Release notes now include every version
  since the last release, so this one also lists the folder naming choices from 0.16.0, which was
  never released.

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
- A licence, privacy policy and third-party notices. The installer shows the licence and installs it
  with the notices, and Settings > About links to all three. The README now describes what the app
  does.

## [0.11.1] - 2026-11-15

### Fixed

- Updated a tool used to check the code, fixing a security alert. The app itself is unchanged.

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

## [0.9.2] - 2026-11-14

### Changed

- The To the Point Tech chip logo is drawn from the website's own logo file, so the two match.

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
