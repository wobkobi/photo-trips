// The viewer's map: the OpenFreeMap style it draws with, a dark version of that style for the
// dark theme, and Google Maps for the Open button.
import type { TransformStyleFunction } from "maplibre-gl";

type Style = ReturnType<TransformStyleFunction>;

/**
 * The OpenFreeMap Liberty style (OpenStreetMap data, no key or account needed): full colour, with
 * green parks, blue water and orange main roads. The dark theme recolours it with
 * {@link darkenStyle}, since OpenFreeMap has no dark version of Liberty.
 */
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Dark-theme map colours: the land in step with the app's dark ground, the rest keeping Liberty's hues. */
const LAND = "#1f2226";
const WATER = "#1b3556";
const GREEN = "#1f3324";
const HALO = "#121417";

/**
 * The dark fill colour for a Liberty fill layer.
 * @param id - the layer's id
 * @returns the colour
 */
function darkFill(id: string): string {
  if (id === "water") return WATER;
  if (id === "park" || id === "landcover_wood" || id === "landcover_grass") return GREEN;
  if (id === "landuse_residential") return "#25282d";
  if (id === "landuse_hospital") return "#33262c";
  if (id === "landcover_sand") return "#302c22";
  if (id === "landcover_ice") return "#2b3236";
  if (id.startsWith("landuse_")) return "#262d24";
  if (id.startsWith("building")) return "#2e3238";
  return "#272b31";
}

/**
 * The dark line colour for a Liberty line layer. Roads keep their colour by class (orange
 * motorways, ochre main roads, grey streets), lighter than the land so they read first, and
 * casings turn into a dark outline.
 * @param id - the layer's id
 * @returns the colour
 */
function darkLine(id: string): string {
  if (id.endsWith("_casing")) return HALO;
  if (id.startsWith("waterway")) return "#2a4f7a";
  if (id === "park_outline") return "#2c4a33";
  if (id.startsWith("boundary")) return "#6b7682";
  if (id.startsWith("aeroway")) return "#30363d";
  if (id.includes("rail")) return "#4a4f55";
  if (id.includes("motorway")) return "#b8763a";
  if (/trunk_primary|secondary_tertiary|_link$/.test(id)) return "#8c7a3e";
  if (id.includes("path_pedestrian")) return "#3b424a";
  return "#4a525b";
}

/**
 * The dark text colour for a Liberty label layer: place names brightest, then road, shop and
 * water names.
 * @param id - the layer's id
 * @returns the colour
 */
function darkText(id: string): string {
  if (id.startsWith("water") || id === "poi_transit") return "#8fb4e0";
  if (id.startsWith("highway") || id.startsWith("poi") || id === "airport") return "#aab3bb";
  if (id === "label_other" || id === "label_state") return "#bcc4cb";
  return "#eef0f2";
}

/**
 * Liberty recoloured for the dark theme: dark land, deep blue water and dark green parks, roads
 * in dimmed versions of their colours, and light labels on a dark halo. Layers are matched by
 * their Liberty ids; any it doesn't know keep a neutral dark colour of their type, so a new layer
 * upstream can't come out white. Patterned fills (wetland, pedestrian areas) have no colour to
 * change, so they're faded instead, and the shaded-relief backdrop for zoomed-out views is dimmed.
 * Road shields keep their own light badge with dark text, so labels without a text colour are left.
 * @param style - the Liberty style as fetched
 * @returns the dark style
 */
export function darkenStyle(style: Style): Style {
  const layers = style.layers.map((layer): Style["layers"][number] => {
    switch (layer.type) {
      case "background":
        return { ...layer, paint: { ...layer.paint, "background-color": LAND } };
      case "raster":
        return { ...layer, paint: { ...layer.paint, "raster-brightness-max": 0.35 } };
      case "fill": {
        if (layer.paint && "fill-pattern" in layer.paint) {
          return { ...layer, paint: { ...layer.paint, "fill-opacity": 0.15 } };
        }
        const colour = darkFill(layer.id);
        const outline = layer.paint && "fill-outline-color" in layer.paint;
        return {
          ...layer,
          paint: {
            ...layer.paint,
            "fill-color": colour,
            ...(outline ? { "fill-outline-color": colour } : {}),
          },
        };
      }
      case "fill-extrusion":
        return {
          ...layer,
          paint: { ...layer.paint, "fill-extrusion-color": darkFill(layer.id) },
        };
      case "line":
        return { ...layer, paint: { ...layer.paint, "line-color": darkLine(layer.id) } };
      case "symbol":
        if (!layer.paint || !("text-color" in layer.paint)) return layer;
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

/**
 * The spot in Google Maps, with a pin on it.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the URL to open in the browser
 */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}
