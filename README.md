# Pic Cabinet

A Windows app by [To the Point Tech](https://www.tothepoint.co.nz) that keeps a photo library
tidy on its own. Point it at the folder your photos live in, and it files every photo and video
by when it was taken, gathers holidays into their own trip folders, and keeps new photos coming
in from cameras, memory cards and phones. It runs quietly in the system tray, works entirely on
your PC, and every change it makes can be undone.

```
Pictures/
  2025/
    2025-02/IMG_1102.jpg
    2025-03/IMG_1234.jpg
  Trips/
    2025-03-12 Japan/IMG_2001.heic
    2025-03-12 Japan/IMG_2001.aae
```

## What it does

### Sorts the library by date

Every photo and video goes into a `Year/Year-Month` folder for the month it was taken. Pic
Cabinet works out the date from the best source a file has, in this order:

1. the date the camera recorded inside the photo (EXIF) or video
2. the date Windows has for it, for formats Windows can read
3. [ExifTool](https://exiftool.org), for anything else, including most camera RAW formats
4. a date in the file name, such as `IMG_20250312_141500.jpg` or `PXL_20250312_...`
5. the file's last-modified time, as a last resort. These are marked as uncertain so you can
   check them.

Files that belong together move together: an iPhone Live Photo's video, the RAW twin of a JPEG,
and sidecar files (`.aae`, `.xmp`, `.thm` and similar) all stay with their photo. When two files
would end up with the same name, the newcomer gets a ` (1)` rather than replacing anything.
Files of types Pic Cabinet doesn't recognise are never touched.

Settings > Folder names offers a few other ways to name the folders, such as `2025/03 March` for
months and `Trips/Japan 2025` for trips. Changing it renames the folders already sorted, after
showing every move, and can be undone like any other change.

### Keeps trips together

Add a trip with a name and dates, and everything taken during it goes into
`Trips/<start date> <name>` instead of the month folders. Trips never overlap, so each photo has
exactly one home.

Pic Cabinet also suggests trips you haven't added. It looks for runs of busy days and for days
spent away from home (more than 50 km from where most of your photos are taken), names each run
after the town, region or country most of its photos were taken near, and shows sample photos so
you can tell at a glance. Accept a suggestion to make it a trip, or dismiss it. Place names come
from a list built into the app, so your locations never leave your PC.

### Brings photos in

- **Import** from a folder, a memory card, or a phone or camera plugged in by USB, including
  iPhones. Each file goes straight to its trip or month folder. Photos already in the library are
  skipped, even if they've been renamed, so importing the same card twice is harmless. Nothing on
  the card or phone changes, and phones are only ever read.
- **Inbox folders** are watched in the background. Anything saved into one, such as a phone
  backup or a camera upload folder, is moved into the library once it has finished copying.
- When a memory card or phone is plugged in, Pic Cabinet lets you know if it has new photos.

### Finds duplicates

Pic Cabinet finds files with identical contents anywhere in the library, whatever they're named,
and sends the extra copies to the Recycle Bin, keeping one. Only files the same size as another
are read in full, so checking a large library is quick.

### Lets you look through it all

The Library page shows the whole collection as a timeline of thumbnails, with a full-size viewer
for photos and videos. HEIC, RAW and AVIF thumbnails use the Windows image extensions; if one is
missing, Pic Cabinet says which one and links to it in the Microsoft Store.

## Safe by design

- **Preview first.** Sorting and imports you start show exactly what will move where before
  anything happens.
- **Undo anything.** Every batch of changes, including those from inbox folders, is listed in
  History and can be put back with one click.
- **Nothing is deleted.** Duplicates go to the Recycle Bin, where they stay until you empty it.
- **Interruptions are safe.** Every move is written down before it happens. If Pic Cabinet or the
  PC stops partway through a batch, the next start checks where each file actually ended up, so
  nothing is lost and History stays accurate.

## Installing and updating

Pic Cabinet runs on Windows 10 and 11. Download the installer (`Pic-Cabinet_<version>_x64-setup.exe`)
from the [latest release](https://github.com/wobkobi/pic-cabinet/releases/latest) and run it; it
installs for your Windows account only and doesn't need administrator rights. On first start it
asks which folder your photo library is in.

Pic Cabinet checks for updates once a day and lets you know when one is ready. Settings > About
shows what's new and installs it with **Install and restart**. Updates are signed, and the app
refuses any that aren't.

## Privacy

Your photos, and everything Pic Cabinet works out about them, stay on your PC. The app has no
accounts, analytics or tracking; the only thing it does online is check GitHub for updates. The
[privacy policy](PRIVACY.md) has the details. To report a security problem, see the
[security policy](SECURITY.md).

## Licence

Pic Cabinet is proprietary software, copyright To the Point Tech, and free to use under the terms
in [LICENSE](LICENSE). It includes third-party software and data under their own licences,
listed in `THIRD_PARTY_NOTICES.txt` in the install folder (Settings > About > Third-party
notices opens it).

## Development

Pic Cabinet is a [Tauri](https://tauri.app) app: a Rust engine (`src-tauri/`) with a React and
TypeScript interface (`src/`). Building it needs Node 24+, Rust (MSVC toolchain) and the Visual
Studio C++ build tools.

```
npm install
npm run tauri dev      # run the app (downloads ExifTool on first run)
npm run tauri build    # NSIS installer in src-tauri/target/release/bundle
```

Checks: `npm run typecheck`, `npm run lint` (ESLint + clippy), `npm test` (Vitest + cargo test).
Test fixtures are regenerated with `scripts/make-fixtures.sh` (needs ffmpeg).
`THIRD_PARTY_NOTICES.txt` is generated into `src-tauri/resources/` before every dev start and
build (`npm run notices` runs it on its own), so it always matches the dependencies being built.

### Releases

Installed copies check this repo's
[releases](https://github.com/wobkobi/pic-cabinet/releases) once a day and offer new versions
in Settings > About.

Releasing is automatic: when a merge into main brings a version in `package.json` that isn't
released yet, the Release workflow builds, signs and publishes it. Merges that leave the version
alone (CI or docs only) don't release anything. The workflow signs with the
`PHOTO_TRIPS_UPDATER_KEY` repository secret, which holds the whole private key.

To publish by hand instead (the workflow then skips that version):

```
npm run release              # build, sign and publish (needs a clean, pushed tree and gh signed in)
npm run release -- --dry-run # build and sign only, into src-tauri/target/release/publish
```

The release is tagged `v<version>` on the current commit, and the notes come from that version's
`CHANGELOG.md` section. A release won't build while `THIRD_PARTY_NOTICES.txt` is out of date.
Updates are signed with the private key at `~/.tauri/photo-trips-updater.key` (or the path in
`PHOTO_TRIPS_UPDATER_KEY`), whose public half is in `tauri.conf.json`. Keep a backup of it
somewhere safe and never commit it: without it no update can reach installed copies, and anyone
holding it could sign one.
