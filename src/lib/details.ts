// Wording for what a photo or video says about itself (camera, size, settings), for the viewer's
// side panel.

import type { FileDetails } from "./api";
import { count } from "./format";

/** Company words some makers put after their name ("NIKON CORPORATION", "Minolta Co., Ltd."). */
const COMPANY =
  /[\s,]+(corporation|corp\b|co\.|ltd\b|inc\b|company|imaging|optical|electronics)[\s\S]*$/i;

/**
 * A maker's name as people say it: company words dropped, and shouted names ("OLYMPUS") in
 * title case. Short ones such as LG and DJI stay as they are.
 * @param make - the Make tag
 * @returns the tidied name, or null when nothing is left
 */
function tidyMake(make: string): string | null {
  const name = make.replace(COMPANY, "").trim();
  if (!name) return null;
  return name
    .split(/\s+/)
    .map((word) =>
      word.length > 3 && word === word.toUpperCase()
        ? word[0] + word.slice(1).toLowerCase()
        : word[0].toUpperCase() + word.slice(1),
    )
    .join(" ");
}

/**
 * The camera or phone, e.g. "Apple iPhone 13" or "Nikon D750". Models that already start with
 * the maker's name ("NIKON D750", "Canon EOS R6") don't get it twice.
 * @param make - the Make tag
 * @param model - the Model tag
 * @returns the name, or null when the file records neither
 */
export function cameraName(make: string | null, model: string | null): string | null {
  const maker = make ? tidyMake(make) : null;
  const named = model?.trim() || null;
  if (!named) return maker;
  if (!maker) return named;
  for (const word of maker.split(" ")) {
    const rest = named.slice(word.length);
    if (named.toLowerCase().startsWith(word.toLowerCase()) && /^([\s-]|$)/.test(rest)) {
      return word + rest;
    }
  }
  return `${maker} ${named}`;
}

/** One decimal place at most: 1.6, 2, 5.1. */
function short(n: number): string {
  return String(Number(n.toFixed(1)));
}

/**
 * A picture's size, e.g. "4032 × 3024 pixels (12 megapixels)". Megapixels are left off videos,
 * where nobody counts them.
 * @param details - the file's details
 * @param video - whether the file is a video
 * @returns the text, or null when the file doesn't say
 */
export function sizeText(details: FileDetails, video: boolean): string | null {
  const { width, height } = details;
  if (!width || !height) return null;
  const pixels = `${width} × ${height} pixels`;
  const mega = (width * height) / 1_000_000;
  if (video || mega < 0.95) return pixels;
  return `${pixels} (${mega >= 10 ? Math.round(mega) : short(mega)} megapixels)`;
}

/**
 * A video's length in words, e.g. "2 minutes 14 seconds". Seconds are left off past an hour.
 * @param seconds - the length
 * @returns the text
 */
export function durationText(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 1) return "Under a second";
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const parts = [];
  if (hours) parts.push(count(hours, "hour", "hours"));
  if (minutes) parts.push(count(minutes, "minute", "minutes"));
  if (secs && !hours) parts.push(count(secs, "second", "seconds"));
  return parts.join(" ");
}

/**
 * The camera's settings for the shot, as label and value pairs in the order photographers read
 * them. Only the ones the file records.
 * @param details - the file's details
 * @returns e.g. [["Aperture", "f/1.6"], ["Shutter speed", "1/120 second"]]
 */
export function cameraSettings(details: FileDetails): [string, string][] {
  const { lens, fNumber, exposure, iso, focalLength, focal35 } = details;
  const settings: [string, string][] = [];
  if (lens) settings.push(["Lens", lens]);
  if (fNumber) settings.push(["Aperture", `f/${short(fNumber)}`]);
  if (exposure) {
    settings.push([
      "Shutter speed",
      exposure >= 1
        ? `${short(exposure)} ${exposure === 1 ? "second" : "seconds"}`
        : `1/${Math.round(1 / exposure)} second`,
    ]);
  }
  if (iso) settings.push(["ISO", String(iso)]);
  // The full-frame figure is the one people compare between cameras; a phone's real 5 mm isn't.
  const focal = focal35 ?? focalLength;
  if (focal) settings.push(["Focal length", `${short(focal)} mm`]);
  return settings;
}
