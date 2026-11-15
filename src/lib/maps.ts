// The viewer's map: the OpenFreeMap style it draws with, a dark version of that style for the
// dark theme, and Google Maps for the Open button.
import type { TransformStyleFunction } from "maplibre-gl";

type Style = ReturnType<TransformStyleFunction>;

/**
 * The OpenFreeMap Positron style (OpenStreetMap data, no key or account needed). The dark theme
 * recolours it with {@link darkenStyle} rather than using OpenFreeMap's own dark styles, whose
 * dim labels are hard to read in the small side-panel map.
 */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

/** Dark-theme map colours, in step with the app's dark tokens (ground, surface, map-water). */
const LAND = "#1f2226";
const WATER = "#173f46";
const HALO = "#121417";

/**
 * The dark fill colour for a Positron fill layer.
 * @param id - the layer's id
 * @returns the colour
 */
function darkFill(id: string): string {
  if (id === "water") return WATER;
  if (id === "park" || id === "landcover_wood") return "#1c2620";
  if (id === "landuse_residential") return "#23272c";
  if (id === "building") return "#2b3037";
  if (id === "road_area_pier") return LAND;
  return "#272b31";
}

/**
 * The dark line colour for a Positron line layer: roads get lighter the bigger they are, so the
 * main roads read first, and casings turn into a dark outline.
 * @param id - the layer's id
 * @returns the colour
 */
function darkLine(id: string): string {
  if (id === "waterway") return "#1f5561";
  if (id.endsWith("_casing")) return HALO;
  if (id.startsWith("boundary")) return "#6b7682";
  if (id.endsWith("dashline") || id === "road_pier") return LAND;
  if (id.startsWith("highway_motorway") && id.endsWith("inner")) return "#7d8792";
  if (id === "highway_major_inner") return "#5f6872";
  if (id === "highway_minor") return "#464e57";
  if (id.startsWith("aeroway")) return "#30363d";
  return "#3b424a";
}

/**
 * The dark text colour for a Positron label layer: place names brightest, then road and water
 * names.
 * @param id - the layer's id
 * @returns the colour
 */
function darkText(id: string): string {
  if (id.startsWith("water")) return "#86bcc8";
  if (id.startsWith("highway") || id === "airport") return "#aab3bb";
  if (id === "label_other" || id === "label_state") return "#bcc4cb";
  return "#eef0f2";
}

/**
 * Positron recoloured for the dark theme: dark land and water, roads lighter than the land, and
 * light labels on a dark halo. Layers are matched by their Positron ids; any it doesn't know
 * keep a neutral dark colour of their type, so a new layer upstream can't come out white.
 * @param style - the Positron style as fetched
 * @returns the dark style
 */
export function darkenStyle(style: Style): Style {
  const layers = style.layers.map((layer): Style["layers"][number] => {
    switch (layer.type) {
      case "background":
        return { ...layer, paint: { ...layer.paint, "background-color": LAND } };
      case "fill":
        return { ...layer, paint: { ...layer.paint, "fill-color": darkFill(layer.id) } };
      case "line":
        return { ...layer, paint: { ...layer.paint, "line-color": darkLine(layer.id) } };
      case "symbol":
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "text-color": darkText(layer.id),
            "text-halo-color": HALO,
            "text-halo-width": 1.2,
            "text-halo-blur": 0.5,
          },
        };
      default:
        return layer;
    }
  });
  return { ...style, layers };
}

/** The address parts of a Photon reverse lookup that make up a place name. */
export interface PhotonAddress {
  locality?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * The Photon (komoot's OpenStreetMap search) lookup for the address nearest a spot, with names
 * in English.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the URL to fetch
 */
export function placeLookupUrl(lat: number, lon: number): string {
  return `https://photon.komoot.io/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&limit=1&lang=en`;
}

/**
 * A place name from a Photon address: suburb, region and country, skipping any that repeat
 * the part before. The suburb is the district, unless the district is just the city again
 * (Paris in Paris), when the smaller locality is used; with neither, the city stands in. The
 * city is otherwise left out: in Auckland it's the council local board (Albert-Eden, Howick),
 * not a name anyone gives as where they were.
 * @param address - the first result's properties
 * @returns the name, or null when there's no suburb or city to name (open country)
 */
export function placeFromAddress(address: PhotonAddress): string | null {
  const { locality, district, city, state, country } = address;
  const suburb = (district && district !== city ? district : (locality ?? district)) ?? city;
  if (!suburb) return null;
  const parts: string[] = [];
  for (const part of [suburb, state, country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(", ");
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
