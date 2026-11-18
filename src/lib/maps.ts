// The viewer's map: the OpenFreeMap style it draws with, and Google Maps for the Open button.

/**
 * The OpenFreeMap Bright style (OpenStreetMap data, no key or account needed): full colour, with
 * green parks, blue water and yellow main roads. It's used in both themes: a recoloured dark
 * version is hard to read at the side panel's size.
 */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/bright";

/**
 * The spot in Google Maps, with a pin on it.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the URL to open in the browser
 */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
