# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.35.0] - 2026-11-18

### Added

- **Trips:** Suggestions offers folders that look like trips Pic Cabinet doesn't know about, such as
  one left behind by a deleted trip or one made by hand, to make into a trip. Sort normally leaves
  the folder to the usual sort instead.
- **Trips:** A suggestion's name can be changed on its card before making the trip, and the card
  shows the folder name it will get.
- **Sort:** Names the folders that look like trips before spreading their files into month folders,
  with a button to make them trips first.
- **Import:** Clicking the notification for a card or phone opens Import and checks that device.
- **Import:** A card or phone plugged in again is announced at most once a week, so charging a phone
  doesn't bring a notification each time. Settings > Window can change it to every time, once a day
  or never.

### Fixed

- **Duplicates:** Copies removed in Duplicates no longer come back with the next import from the
  phone or card they came from, when their details differed from the copy kept.

## [0.34.0] - 2026-11-18

### Added

- **Duplicates:** Also finds copies of the same picture or video whose details differ, such as
  re-exported Live Photo clips, and suggests keeping the copy with the most details: location, date
  and camera.
- **Updates:** Beta updates, in Settings > About, offers test versions built from pull requests
  before they're released. About marks a beta build, and turning the switch off keeps the version
  you have until the next full release.

### Fixed

- **Viewer:** Suburb names beside a photo come from OpenStreetMap's Nominatim, so they match the
  area the photo is in.
- **Viewer:** The map beside a photo uses OpenFreeMap's Bright style in both themes, which is easier
  to read than a darkened map.
- **Viewer:** The details panel no longer shows Trip: None. The section only appears when the photo
  is in a trip or one is near enough to add it to.
- **Viewer:** Selecting a value in the details panel no longer runs on into the lines below, and the
  lens line leaves out the phone's name and an aperture already shown below it.
- **Viewer:** The top bar spans the full width when the details panel is open, so it no longer
  jumps.
- **Viewer:** A video starts playing only after it has been on screen for a moment, so clicking
  quickly past videos no longer flashes and plays each one.
- **Viewer:** A Live Photo's clip plays in place over the photo, with no control bar pushing the
  picture up, and a click stops it.
- **Duplicates:** Says "only hidden details differ" when copies hold the same visible details, and
  leaves out the matching details lines.
- **History:** A job that stopped before moving anything is titled as what it set out to do.
- **Navigation:** Opening and closing the sidebar slides smoothly, with every icon staying in place,
  instead of jumping.

## [0.33.0] - 2026-11-18

### Added

- **Library:** Hovering a tile shows a tick that starts selecting. The toolbar button is now Select,
  and the selection bar's Copy puts every selected photo on the clipboard at once.
- **Library:** Month headings offer Select month. Shift-click selects from the focused photo when
  nothing is selected yet, and Shift with the arrow keys grows the selection.
- **Library:** With several photos selected, the tile menu leaves out View, Open, Show in folder and
  Copy path rather than greying them out.
- **Library:** The filters sit in the toolbar: a search box, All / Photos / Videos, and one Filter
  button for year and uncertain dates, with a chip for each filter that is on.
- **Library:** A photo size control on the toolbar, and Ctrl+wheel over the grid, make the tiles
  bigger or smaller and remember the size.
- **Library:** The date rail sits over the right edge of the grid in place of the scrollbar, and the
  month you're in stays pinned to the top of the grid.
- **Library:** The grid is a single Tab stop with the arrow keys, Page Up and Page Down moving
  within it, and it takes focus when the Library opens. While the viewer is open, Tab and screen
  readers stay inside it.
- **Library:** Results of a Recycle Bin, date or trip change, and the codec hint, show as a toast at
  the bottom of the window with Undo where it can be undone. They show over the viewer too.
- **Import:** Dropping a folder on the window opens Import on that folder.
- **History:** Ctrl+Z opens History on the newest change that can be undone and asks before undoing
  it.
- **General:** Import, Sort, Duplicates, Settings, Suggestions and Trips show their results as
  toasts in place of the banner on each page, so a result that lands after you've moved on still
  shows.
- **General:** Shorter text on Setup, Inbox and Suggestions settings, Busy days and empty pages,
  with the fuller text under Details. An "Update ready" row shows in the sidebar, and the first time
  closing hides to the tray, a notice says so.

### Fixed

- **Import:** A folder dropped over the viewer or a dialog is ignored, dropping files says to drop a
  folder, and Ctrl+Z or dropping a folder no longer leaves the trip editor, an import review or Sort
  with unsaved changes.
- **Library:** A failed date change shows in the dialog or as a toast, Alt+Left and Alt+Right on the
  kind and size controls go back and forward, and choosing the filter already in use keeps your
  place.

## [0.32.0] - 2026-11-18

### Added

- **Library:** Tiles mark Live Photos with a ring and RAW pairs with RAW, and the name search finds
  a photo by its linked files' names too.
- **Library:** The photo menu starts with View and shows each item's shortcut. Delete and Ctrl+C act
  on the focused photo when nothing is selected, and no longer reach the page behind a dialog.
- **Viewer:** A slim bar over the photo: Back, the file name and date, "N of M", and buttons for
  Zoom, Rotate, Show in folder, Copy, Open and Info. It fades while the mouse rests and comes back
  when you move it. The same bar shows wherever photos open, including Import and Duplicates.
- **Viewer:** Delete or the bin button asks, then sends the photo to the Recycle Bin, and the viewer
  stays open on the next photo.
- **Viewer:** Right-click on the open photo shows the same menu as its tile. While a menu is open,
  Delete and the arrow keys no longer act behind it.
- **Viewer:** F or F11 shows the open photo or video fullscreen, with the menu bar hidden. Esc
  leaves fullscreen first, and closing the viewer or hiding to the tray leaves it too.
- **Viewer:** Shows how far a photo is zoomed as a percent of its real size. 1 or a click goes to
  exactly 100%, 0 fits, and Ctrl+wheel or a touchpad pinch zooms smoothly around the pointer.
- **Viewer:** The details panel opens and closes with I and stays as you left it, and the photo uses
  the full space beside it.
- **Viewer:** The details panel is shorter: "4032 × 3024 · 12 MP", a video's length as a clock time
  such as 2:14, and the camera settings on one line with no "More details" to open.
- **Viewer:** Each linked file in the details opens with a click, a RAW copy can be shown in its
  folder, and a Live Photo plays its clip from the viewer bar.
- **Recycle Bin:** The Recycle Bin question and Set date open as dialogs above the photo viewer and
  menus. Enter answers, Esc cancels, and keys no longer act on the page behind.

### Fixed

- **Recycle Bin:** Enter no longer cancels the Recycle Bin question while another job runs, a held
  Enter answers it once, and photos sent to the Recycle Bin no longer flash back when two go in
  quick succession.
- **Viewer:** Keys no longer zoom or turn the photo behind the viewer's menu, Ctrl+C copies the open
  photo, a zoomed photo refits after turning it or hiding the details, and quitting in fullscreen
  keeps the window's own size.

## [0.31.0] - 2026-11-18

### Added

- **Library:** Coming back to the Library finds it as you left it: same filter, same selection, same
  open photo, with no wait for the photos to load again.
- **Library:** The Library opens scrolled to where you left it, including after a trip review, and
  resizing the window keeps the same photos at the top.
- **Trips:** Opening a trip shows it as its own place: its name and dates as the title, a back arrow
  to where you came from, and Edit. The Trip drop-down is gone; "Not on a trip" is a switch beside
  "Uncertain dates", and "Clear filters" keeps the trip. An empty trip says so.
- **Duplicates:** Duplicates keeps the copies you chose to keep while you visit other pages.
- **History:** History keeps the batch you had open while you visit other pages.
- **Navigation:** Back and Forward move between the pages you've visited, keeping each page's
  filter: Alt+Left and Alt+Right, or the mouse's side buttons. Inside a step such as a trip review,
  Back steps out of that first.
- **Navigation:** The menu is in groups: Library, then Trips with your newest trips listed under it,
  then Import, Sort, Suggestions and Duplicates. History, Settings and Help are small buttons at the
  bottom. Ctrl+1 to Ctrl+7 follow the new order (Ctrl+2 is Trips), and opening the Library always
  shows the whole library.
- **Navigation:** A trip review, a trip being edited, an import preview and the other in-between
  steps have a back arrow before their name, and Esc or Alt+Left steps back. Each step names itself
  in the title, such as "Edit Japan" or "Preview".
- **Navigation:** Each page opens at its top.
- **Settings:** Settings reopens on the tab you left.

### Fixed

- **Library:** The header no longer flashes a 0 while the Library loads.
- **Library:** The photo open in the viewer, and where a Shift-click range starts, stay the same
  when photos arrive or leave in the background.
- **Navigation:** Back from a trip returns to the page it was opened from, Esc and Alt+Left no
  longer drop an unsaved trip or import, and focus lands on the page title after Back.

## [0.30.7] - 2026-11-18

### Fixed

- Retrying thumbnails reloads only the blank tiles, and the Import preview retries once an extension
  is installed. The Busy tooltip shows only on buttons waiting for a job, and the window colour
  follows Windows when it switches between light and dark.

## [0.30.6] - 2026-11-18

### Changed

- Standard words throughout: Select all / Select none, Deselect, Rotate, Open, Refresh, Import 12
  items, and Undo / Cancel in History. Selections count items, and stray sidecars read as having no
  matching photo or video.

## [0.30.5] - 2026-11-18

### Fixed

- The Store extension hint no longer blames a codec for one damaged file: it waits for three files
  of a type to fail (or all of them when there are fewer), ignores empty files, and also shows on
  the Import preview. A photo the viewer can't show offers the extension it needs.

## [0.30.4] - 2026-11-18

### Fixed

- Photos and videos Windows couldn't preview get their thumbnails as soon as the missing Store
  extension is installed, and are tried again when you come back to the window a minute or more
  later, instead of staying blank until Pic Cabinet restarts.

## [0.30.3] - 2026-11-18

### Changed

- Hovering a photo outlines it instead of fading it, buttons and menu rows darken while pressed, and
  hover and press changes happen at once rather than easing in.

## [0.30.2] - 2026-11-18

### Changed

- Buttons, boxes, switches, menu rows and the sidebar are tighter, about 34px tall, like other
  desktop apps; text stays the same size.

## [0.30.1] - 2026-11-18

### Fixed

- The warning mark for a guessed date no longer sits on every such photo: it shows when the photo is
  hovered or focused, and on all of them while the Uncertain dates filter is on. The tooltip says
  Date uncertain too.

## [0.30.0] - 2026-11-18

### Added

- Hovering a photo in the grid shows its file name, when it was taken and its trip, and screen
  readers hear the file name too.

## [0.29.2] - 2026-11-18

### Fixed

- Changing a Library filter shows the grid from the top, rather than somewhere in the middle of the
  new list.

## [0.29.1] - 2026-11-18

### Fixed

- Closing the viewer brings the grid to the last photo it showed and puts the focus on it, instead
  of going back to wherever the viewer was opened.

## [0.29.0] - 2026-11-18

### Added

- The window opens at the size and place it was left, maximised if it was, including after hiding to
  the tray.

## [0.28.0] - 2026-11-18

### Added

- The browser's own keys (print, reload, find bar, view source) no longer do anything in the app.
  Ctrl+F, also View > Find, opens the Library and puts the cursor in its search box.

## [0.27.0] - 2026-11-18

### Added

- Moving files, sending them to the Recycle Bin or putting them back can be stopped from the page
  showing its progress, and a button that waits for a running job says which job in its tooltip.

## [0.26.2] - 2026-11-18

### Fixed

- The menu down the left no longer repeats the app's name, which the title bar already shows, and
  the button that narrows it sits at its top.

## [0.26.1] - 2026-11-18

### Fixed

- HEIC, RAW and TIFF photos open in the viewer showing their thumbnail straight away instead of a
  blank screen, with a small busy mark if the full picture takes a moment.

## [0.26.0] - 2026-11-18

### Added

- Clicking a photo in the viewer zooms in where you clicked, and clicking again fits it to the
  window. Opening it in another app is the button only.

## [0.25.20] - 2026-11-18

### Fixed

- The window opens in the theme's own colour, with no white flash before the page draws.

## [0.25.19] - 2026-11-18

### Fixed

- Right-clicking anywhere but on text no longer shows the browser's own menu with Back, Reload and
  Print.

## [0.25.18] - 2026-11-18

### Fixed

- A job that finishes after an earlier result was dismissed is always noticed, so pages that refresh
  when a job ends no longer miss it.

## [0.25.17] - 2026-11-18

### Fixed

- A phone unplugged or locked near the end of a check now ends it with an error instead of reporting
  the last files as unreadable, and a problem on this PC (a full disk) stops the check at once
  instead of being blamed on the phone.

## [0.25.16] - 2026-11-18

### Fixed

- Transport-stream recordings that start mid-packet or use 204-byte packets are recognised as
  videos, while source files with a few stray G's are not. A folder whose listing fails partway
  through a refresh no longer drops the photos it didn't get to.

## [0.25.15] - 2026-11-18

### Fixed

- Choosing which copy of a duplicated Live Photo or RAW pair to keep carries over to the pair's
  other set even when one set has an extra copy, such as a third copy of the photo without its clip.

## [0.25.14] - 2026-11-18

### Fixed

- A file arriving in an inbox only joins a same-name photo filed in the last hour, and only when
  nothing of its kind came with that photo, so an edited photo keeps the sidecar it arrived with and
  a camera's reused file name never joins an old picture.

## [0.25.13] - 2026-11-18

### Fixed

- Photos copied off a phone that carry no date of their own are dated at the time they were taken,
  not hours later; the phone's file times are its local time, which were being read as UTC. Files
  already seen on the phone are still recognised and aren't copied again.

## [0.25.12] - 2026-11-18

### Fixed

- Duplicates keep a copied Live Photo or RAW+JPEG pair whole: its photo and clip sets suggest the
  same pair, choosing a keeper in one carries over to the other, and the viewer shows the exact copy
  being judged.

## [0.25.11] - 2026-11-18

### Fixed

- In an inbox folder, a Live Photo video, RAW or sidecar saved after its photo was already filed now
  goes beside that photo under the photo's name, so the two show as one tile again. A late sidecar
  used to stay in the inbox for good. Photos and RAW files also wait a little longer before they are
  filed, so files saved a few seconds apart usually go in together.

## [0.25.10] - 2026-11-18

### Fixed

- Empty (0 byte) files, usually left by a copy that didn't finish, are no longer brought in on every
  check under a new number. The import preview counts them, and an empty file already in the library
  says so in the viewer, with Show in folder, instead of offering to open it in another app.

## [0.25.9] - 2026-11-18

### Fixed

- When a phone refuses to hand over a file, Pic Cabinet asks once more, then leaves that file and
  the files that go with it on the phone and carries on with the rest. The import preview says how
  many couldn't be read, with the iPhone setting that usually fixes it (Settings > Photos > Transfer
  to Mac or PC > Keep Originals). The check only stops if the phone stops answering altogether.

## [0.25.8] - 2026-11-18

### Fixed

- Undoing a Recycle Bin batch now finds a file that was edited in another program after the last
  refresh. It used to say the file was no longer in the Recycle Bin.

## [0.25.7] - 2026-11-18

### Fixed

- When one file of a photo can't go to the Recycle Bin (a RAW open in another program, say), the
  files that already went come back out, so the photo stays whole with its Live Photo video, RAW and
  sidecars. History names the file that held it back.

## [0.25.6] - 2026-11-18

### Fixed

- When a folder in the library can't be read during a refresh (a drive that dropped out, a
  permission problem), its photos stay listed with their set dates and trips instead of dropping out
  of the library. If the whole library folder has gone, nothing is dropped. The Library says how
  many folders couldn't be read.

## [0.25.5] - 2026-11-18

### Fixed

- Edit files that RawTherapee (.pp3), DxO (.dop), Adobe Camera Raw (.acr), ON1 (.on1), AfterShot
  (.arp) and Capture One (.cos) keep beside a RAW now move, import and go to the Recycle Bin with
  it, instead of being left behind.

## [0.25.4] - 2026-11-18

### Fixed

- Photos deleted on an Android phone (kept as .trashed files for 30 days), half-saved .pending files
  and other hidden dot-files are no longer imported. NAS recycle and thumbnail folders (#recycle,
  @eaDir, @Recycle, #snapshot) and Sony cards' thumbnail and proxy folders are skipped. Phones now
  get the same checks as folders and cards.

## [0.25.3] - 2026-11-18

### Fixed

- Files ending in .ts, .mts or .m2ts only count as videos when they really are video streams, so
  code files in a folder inside the library or an inbox are no longer moved by Sort. node_modules
  folders are skipped.

## [0.25.2] - 2026-11-18

### Fixed

- Before sending a photo to the Recycle Bin, Pic Cabinet now names the files that go with it
  ("IMG_1.MOV and IMG_1.AAE go with it") and says videos or items rather than photos when that is
  what is selected.

## [0.25.1] - 2026-11-18

### Fixed

- Two different pictures or videos with the same name in one folder (image.jpg and image.png, a film
  and its trailer) are now separate tiles with their own dates, instead of one hiding the other and
  going to the Recycle Bin with it. Sidecars stay with the file they belong to.

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
- The Library can find photos by any part of their file name.
- Sort can leave photos where they are: untick them in the list before moving.
- Photos can go to the Recycle Bin from the Library's right-click menu or the Delete key, with the
  files that go with them, after a confirm. History can undo it.
- Zoom into a photo in the viewer with the mouse wheel, the + and - keys or the buttons under it,
  drag to look around, and turn it with R. Copy puts a photo on the clipboard to paste into a
  folder, email or chat, from the viewer or the Library's right-click menu.
- Set the date of a photo whose own date is wrong or only a guess: Change date in the viewer, or Set
  date from the Library's right-click menu for several at once. Pic Cabinet keeps the new date and
  the file isn't changed, so other apps still show its own. Undo it from the banner or History, or
  go back with Use the file's date.
- Picked photos in the Library can be taken out of their trip, put back in, or added to a trip
  within two weeks of them, from the header or the right-click menu. The viewer shows each photo's
  trip with the same choices.

### Changed

- Smoother, more consistent icons throughout the app.

### Fixed

- Small or transparent photos no longer flash up stretched across the viewer before shrinking to
  their real size.

## [0.24.0] - 2026-11-16

### Added

- One busy day away from home is suggested as a day trip.
- Suggestion previews are much bigger, filling the card with photos spread through the trip; the
  buttons drop under the words in a narrow window.
- A trip over New Year gets both years in its folder, such as Tairua 2025-26, and each suggestion is
  titled the way its trip folder will be.
- The trip editor shows the folder a trip will get, Settings shows how a trip over New Year is
  named, and a suggestion with no place is called Trip so its folder doesn't repeat the dates.

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
