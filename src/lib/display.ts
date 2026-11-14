// Text and photo sizes chosen in Settings > Display. The backend zooms the window for text size
// (commands.rs keeps the same list of percentages); photo size sets the grid's tile width.

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

const DEFAULT_TEXT = "100";
const DEFAULT_PHOTO = "medium";
const DEFAULT_TILE = 210;

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
 * Preferred tile edge for the stored photo size.
 * @param settings - loaded settings
 * @returns the tile edge in CSS pixels
 */
export function tileSizeOf(settings: Settings | null): number {
  const value = photoSizeOf(settings);
  return PHOTO_SIZES.find((size) => size.value === value)?.tile ?? DEFAULT_TILE;
}
