// Links for the viewer's map: the OpenFreeMap style it draws with, and Google Maps for the
// Open button.

/**
 * The OpenFreeMap map style (OpenStreetMap data, no key or account needed), light or dark to
 * match the theme.
 * @param dark - the dark style rather than the light one (Positron)
 * @returns the style URL for MapLibre
 */
export function mapStyleUrl(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`;
}

/**
 * The spot in Google Maps, with a pin on it.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the URL to open in the browser
 */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
