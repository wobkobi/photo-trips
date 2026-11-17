// Keep WebView2's own right-click menu (Back, Reload, Save as, Print) off the app. In a desktop
// app a right-click does nothing unless the app gives it a menu of its own.

/** Text the user can edit or select, where the webview's Cut, Copy and Paste still help. */
const TEXT_PLACES =
  "textarea, [contenteditable], .selectable, " +
  "input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit])";

/**
 * Whether a right-click should reach the webview's own menu.
 * @param target - what was right-clicked
 * @param shift - whether Shift was held, which keeps the menu in development builds for Inspect
 * @param dev - whether this is a development build
 * @returns true to let the webview show its menu
 */
export function keepsWebviewMenu(
  target: EventTarget | null,
  shift: boolean,
  dev: boolean,
): boolean {
  if (dev && shift) return true;
  const element = target as Partial<Element> | null;
  return typeof element?.closest === "function" && element.closest(TEXT_PLACES) !== null;
}
