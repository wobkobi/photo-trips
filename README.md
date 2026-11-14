# Photo Trips

A Windows tray app that keeps a photo library tidy. Photos and videos are sorted into
`Year/Month` folders by the date they were taken. Set up a trip with a date range and everything
taken during it moves into that trip's folder instead.

```
<Library>/
  2025/2025-03/IMG_1234.jpg
  Trips/2025-03-12 Japan/IMG_2001.heic
```

It also:

- suggests trips from runs of busy days and days spent away from home
- finds identical copies and sends the extras to the Recycle Bin
- imports from folders, SD cards and phones, skipping photos already in the library
- watches inbox folders (such as a camera upload folder) and moves new photos in as they arrive

Every batch of moves is logged and can be undone from History. Batches you start are previewed
first; inbox batches run on their own.

## Development

Needs Node 24+, Rust (MSVC toolchain) and the Visual Studio C++ build tools.

```
npm install
npm run tauri dev      # run the app (fetches ExifTool on first run)
npm run tauri build    # NSIS installer in src-tauri/target/release/bundle
```

Checks: `npm run typecheck`, `npm run lint` (ESLint + clippy), `npm test` (Vitest + cargo test).
Test fixtures are regenerated with `scripts/make-fixtures.sh` (needs ffmpeg).
