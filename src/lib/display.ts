// Theme, text and photo sizes chosen in Settings > Display. The backend zooms the window for text
// size and themes its title bar and menus (commands.rs keeps the same lists); photo size sets the
// grid's tile width.

import type { Settings } from "./api";

export interface SizeChoice {
  /** Value stored in the setting. */
  value: string;
  label: string;
}

/** Text sizes as page zoom percentages. Must match TEXT_SIZES in commands.rs. */
export const TEXT_SIZES: SizeChoice[] = [
  { value: "100", label: "Standard" },
  { value: "115", label: "Large" },
  { value: "130", label: "Larger" },
  { value: "150", label: "Largest" },
];

/** Photo tile sizes, with the preferred tile edge in CSS pixels for each. */
export const PHOTO_SIZES: (SizeChoice & { tile: number })[] = [
  { value: "small", label: "Small", tile: 150 },
  { value: "medium", label: "Medium", tile: 210 },
  { value: "large", label: "Large", tile: 290 },
];

/** Themes. Must match THEMES in commands.rs. */
export const THEMES: SizeChoice[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DEFAULT_THEME = "system";
const DEFAULT_TEXT = "100";
const DEFAULT_PHOTO = "medium";
const DEFAULT_TILE = 210;

/**
 * The stored theme, or System (follow Windows) when it's unset or not one offered.
 * @param settings - loaded settings
 * @returns one of the {@link THEMES} values
 */
export function themeOf(settings: Settings | null): string {
  const value = settings?.theme ?? "";
  return THEMES.some((theme) => theme.value === value) ? value : DEFAULT_THEME;
}

/**
 * The stored text size, or Standard when it's unset or not one offered.
 * @param settings - loaded settings
 * @returns one of the {@link TEXT_SIZES} values
 */
export function textSizeOf(settings: Settings | null): string {
  const value = settings?.text_size ?? "";
  return TEXT_SIZES.some((size) => size.value === value) ? value : DEFAULT_TEXT;
}

/**
 * The stored photo size, or Medium when it's unset or not one offered.
 * @param settings - loaded settings
 * @returns one of the {@link PHOTO_SIZES} values
 */
export function photoSizeOf(settings: Settings | null): string {
  const value = settings?.photo_size ?? "";
  return PHOTO_SIZES.some((size) => size.value === value) ? value : DEFAULT_PHOTO;
}

/**
 * Preferred tile edge for a photo size.
 * @param value - one of the {@link PHOTO_SIZES} values; any other gets Medium's edge
 * @returns the tile edge in CSS pixels
 */
export function photoTile(value: string): number {
  return PHOTO_SIZES.find((size) => size.value === value)?.tile ?? DEFAULT_TILE;
}

/**
 * Preferred tile edge for the stored photo size.
 * @param settings - loaded settings
 * @returns the tile edge in CSS pixels
 */
export function tileSizeOf(settings: Settings | null): number {
  return photoTile(photoSizeOf(settings));
}

/**
 * The photo size one step bigger or smaller, held at the smallest and largest, for the grid's
 * size control and Ctrl+wheel.
 * @param value - the current {@link PHOTO_SIZES} value; any other counts as Medium
 * @param step - above zero for bigger, below zero for smaller; only the sign counts
 * @returns the neighbouring size, or the same one at either end
 */
export function stepPhotoSize(value: string, step: number): string {
  const at = PHOTO_SIZES.findIndex((size) => size.value === value);
  const from = at < 0 ? PHOTO_SIZES.findIndex((size) => size.value === DEFAULT_PHOTO) : at;
  const to = Math.min(PHOTO_SIZES.length - 1, Math.max(0, from + Math.sign(step)));
  return PHOTO_SIZES[to].value;
}
