// Wording for what a photo or video says about itself (camera, size, settings), for the viewer's
// side panel.

import type { FileDetails } from "./api";

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

/**
 * One decimal place at most: 1.6, 2, 5.1.
 * @param n - the number to shorten
 * @returns the number as text
 */
function short(n: number): string {
  return String(Number(n.toFixed(1)));
}

/**
 * A picture's size, e.g. "4032 × 3024 · 12 MP". Megapixels are whole from 10 up, one decimal
 * below ("3.1 MP", "0.3 MP"), and left off videos, where nobody counts them, and off pictures
 * too small to round to 0.1.
 * @param details - the file's details
 * @param video - whether the file is a video
 * @returns the text, or null when the file doesn't say
 */
export function sizeText(details: FileDetails, video: boolean): string | null {
  const { width, height } = details;
  if (!width || !height) return null;
  const pixels = `${width} × ${height}`;
  const mega = (width * height) / 1_000_000;
  if (video || mega < 0.05) return pixels;
  return `${pixels} · ${mega >= 10 ? Math.round(mega) : short(mega)} MP`;
}

/**
 * The camera's settings for the shot as label and value pairs, in the order photographers read
 * them: aperture, shutter, ISO, focal length. Only the ones the file records; the lens is kept
 * apart because it is too long to share their line.
 * @param details - the file's details
 * @returns e.g. [["Aperture", "f/1.6"], ["Shutter speed", "1/120 s"]]
 */
export function cameraSettings(details: FileDetails): [string, string][] {
  const { fNumber, exposure, iso, focalLength, focal35 } = details;
  const settings: [string, string][] = [];
  if (fNumber) settings.push(["Aperture", `f/${short(fNumber)}`]);
  if (exposure) {
    settings.push([
      "Shutter speed",
      exposure >= 1 ? `${short(exposure)} s` : `1/${Math.round(1 / exposure)} s`,
    ]);
  }
  if (iso) settings.push(["ISO", `ISO ${iso}`]);
  // The full-frame figure is the one people compare between cameras; a phone's real 5 mm isn't.
  const focal = focal35 ?? focalLength;
  if (focal) settings.push(["Focal length", `${short(focal)} mm`]);
  return settings;
}
