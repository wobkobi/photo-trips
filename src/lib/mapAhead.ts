// The viewer map's zoom steps, and fetching its tiles before the map needs them. OpenFreeMap
// takes about a third of a second per new tile from New Zealand, but tiles are cached for good
// once fetched, so tiles fetched ahead for the next photos draw at once when stepped to.

/**
 * Zoom steps, closest first: the online map's zoom, and the height in km of the built-in map
 * used offline (it doesn't go closer than 15 km).
 */
export const ZOOMS = [
  { map: 15, km: 15 },
  { map: 12, km: 15 },
  { map: 10, km: 40 },
  { map: 8, km: 120 },
  { map: 6, km: 400 },
  { map: 4, km: 1500 },
];

/** The zoom step stays where it was left as the viewer steps from photo to photo. */
let zoomStep = 1;

/**
 * The zoom step last chosen.
 * @returns an index into {@link ZOOMS}
 */
export function currentZoomStep(): number {
  return zoomStep;
}

/**
 * Keep a zoom step for the next photo, and for tiles fetched ahead.
 * @param step - an index into {@link ZOOMS}
 */
export function keepZoomStep(step: number): void {
  zoomStep = step;
}

/** The tile list behind the map style's `openmaptiles` source. */
const TILE_JSON = "https://tiles.openfreemap.org/planet";
/** OpenFreeMap's closest tiles; MapLibre stretches these for closer zooms. */
const TILE_MAX_ZOOM = 14;
/** MapLibre's vector tiles cover 512 px, so tile zoom matches map zoom. */
const TILE_PX = 512;
/** The side-panel map's size in CSS px, a little over, so edge tiles are included. */
const MAP_WIDTH = 300;
const MAP_HEIGHT = 200;

/**
 * The tiles a map of the given size shows around a spot. Uses the Web Mercator tile scheme; x
 * wraps around the antimeridian and y stops at the poles.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @param zoom - MapLibre zoom
 * @param width - map width in CSS px
 * @param height - map height in CSS px
 * @returns the tiles, as zoom, column and row
 */
export function tilesAround(
  lat: number,
  lon: number,
  zoom: number,
  width: number,
  height: number,
): { z: number; x: number; y: number }[] {
  const z = Math.min(Math.floor(zoom), TILE_MAX_ZOOM);
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const fx = ((lon + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  // Past the closest tiles, each tile is drawn bigger, so fewer of them fill the map.
  const scale = TILE_PX * 2 ** (zoom - z);
  const halfX = width / 2 / scale;
  const halfY = height / 2 / scale;
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let y = Math.floor(fy - halfY); y <= Math.floor(fy + halfY); y++) {
    if (y < 0 || y >= n) continue;
    for (let x = Math.floor(fx - halfX); x <= Math.floor(fx + halfX); x++) {
      tiles.push({ z, x: ((x % n) + n) % n, y });
    }
  }
  return tiles;
}

/** The tile URL pattern, fetched once; it carries the date of OpenFreeMap's current build. */
let template: Promise<string> | null = null;

/**
 * Fetch the tiles around a spot at the zoom step in use, so the map draws them at once. Fails
 * quietly (offline): the map fetches them itself when shown.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 */
export function warmMapTiles(lat: number, lon: number): void {
  template ??= fetch(TILE_JSON)
    .then((res) => res.json() as Promise<{ tiles?: string[] }>)
    .then((json) => {
      const pattern = json.tiles?.[0];
      if (!pattern) throw new Error("No tiles in the tile list");
      return pattern;
    });
  template.then(
    (pattern) => {
      for (const { z, x, y } of tilesAround(lat, lon, ZOOMS[zoomStep].map, MAP_WIDTH, MAP_HEIGHT)) {
        const url = pattern
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
        fetch(url).catch(() => undefined);
      }
    },
    () => {
      template = null;
    },
  );
}

/**
 * The map's code (MapLibre, about 1 MB). Loaded on first use; started early by the viewer's
 * look-ahead, so the first photo with a location doesn't wait for it.
 * @returns the module
 */
export function loadPhotoMap(): Promise<typeof import("../components/PhotoMap")> {
  return import("../components/PhotoMap");
}
