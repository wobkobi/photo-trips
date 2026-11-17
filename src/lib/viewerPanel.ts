// Whether the viewer's details panel is shown, kept between photos and app restarts.

const KEY = "viewerPanel";

/**
 * Read a stored panel choice. The panel is shown unless it was saved as hidden.
 * @param stored - what was saved, or null
 * @returns true when the panel should be shown
 */
export function parsePanel(stored: string | null): boolean {
  return stored !== "hidden";
}

/**
 * Whether the details panel was left shown. Storage can be unavailable; shown is used then.
 * @returns true when the panel should be shown
 */
export function savedPanel(): boolean {
  try {
    return parsePanel(localStorage.getItem(KEY));
  } catch {
    return parsePanel(null);
  }
}

/**
 * Keep the panel's choice for the next photo.
 * @param shown - whether the panel is now shown
 */
export function savePanel(shown: boolean): void {
  try {
    localStorage.setItem(KEY, shown ? "shown" : "hidden");
  } catch {
    // Not kept: the next viewer starts with the panel shown.
  }
}
