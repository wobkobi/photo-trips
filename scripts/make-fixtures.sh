#!/usr/bin/env bash
# Regenerate the tiny metadata test files in src-tauri/tests/fixtures/.
# Needs ffmpeg on PATH and ExifTool fetched (npm run fetch-exiftool).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/src-tauri/tests/fixtures"
exiftool="$root/src-tauri/resources/exiftool/exiftool.exe"
mkdir -p "$out"
cd "$out"
rm -f ./*

ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
et() { "$exiftool" -q -overwrite_original "$@"; }

# JPEG with DateTimeOriginal, a -07:00 offset and GPS near Las Vegas (36.1 N, 115.2 W).
ff -f lavfi -i color=c=blue:s=32x24 -frames:v 1 exif_gps.jpg
et -DateTimeOriginal="2024:07:15 09:30:00" -OffsetTimeOriginal="-07:00" \
  -GPSLatitude=36.1 -GPSLatitudeRef=N -GPSLongitude=115.2 -GPSLongitudeRef=W exif_gps.jpg

# WebP with EXIF.
ff -f lavfi -i color=c=green:s=32x24 -frames:v 1 exif.webp
et -DateTimeOriginal="2024:07:16 08:00:00" exif.webp

# TIFF-structured RAW stand-in (real DNG/NEF/ARW are TIFF containers too).
ff -f lavfi -i color=c=gray:s=32x24 -frames:v 1 raw.tif
et -DateTimeOriginal="2024:07:17 07:00:00" raw.tif
mv raw.tif raw.dng

# iPhone-style MOV: UTC mvhd time plus Apple's creationdate key with the real offset.
ff -f lavfi -i color=c=red:s=32x24:d=0.2 -c:v libx264 -pix_fmt yuv420p \
  -metadata creation_time=2024-07-15T16:31:00Z apple.mov
et -Keys:CreationDate="2024:07:15 09:31:00-07:00" apple.mov

# Android-style MP4: only the UTC mvhd time.
ff -f lavfi -i color=c=yellow:s=32x24:d=0.2 -c:v libx264 -pix_fmt yuv420p \
  -metadata creation_time=2024-07-15T16:32:00Z utc.mp4

# Matroska with DateUTC.
ff -f lavfi -i color=c=purple:s=32x24:d=0.2 -c:v libx264 -pix_fmt yuv420p \
  -metadata creation_time=2024-07-15T16:33:00Z clip.mkv

# AVI with a RIFF ICRD date: only ExifTool reads these.
ff -f lavfi -i color=c=white:s=32x24:d=0.2 -c:v mjpeg -metadata date="2024:07:15 09:34:00" old.avi

# MPEG-TS (camcorder .MTS) carries no date ffmpeg can write: exercises the fallbacks.
ff -f lavfi -i color=c=black:s=32x24:d=0.2 -c:v libx264 -pix_fmt yuv420p -f mpegts 00001.mts

# PNGs without metadata: one dated by name, one dated only by mtime.
ff -f lavfi -i color=c=orange:s=32x24 -frames:v 1 Screenshot_2024-07-15-10-00-00.png
cp Screenshot_2024-07-15-10-00-00.png plain.png

# Truncated JPEG header.
printf '\xff\xd8\xff\xe1\x00\x10garbage' > corrupt.jpg

ls -la "$out"
