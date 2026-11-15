// Build src-tauri/map/world.bin, the offline map the photo viewer draws a photo's location on,
// from pinned Natural Earth layers (public domain). The output is committed, so this only needs
// running to change the map. Same inputs give the same bytes.
//
//   node scripts/map-data.mjs              download the layers, checking each checksum
//   node scripts/map-data.mjs --from DIR   use layers already downloaded to DIR

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TAG = "v5.1.2";
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${TAG}/geojson`;
const LAYERS = {
  ne_10m_land: "1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416",
  ne_10m_minor_islands: "8c933ca7a4760256bdc46408355706e39764b0fa01c160c28888b90b4faec29f",
  ne_10m_lakes: "2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9",
  ne_10m_admin_0_boundary_lines_land:
    "74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a",
  ne_10m_populated_places_simple:
    "fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f",
};
/** Coordinates are stored as whole ten-thousandths of a degree (about 11 m). */
const SCALE = 10_000;
/**
 * Douglas-Peucker tolerance in degrees (about 55 m). The closest view the app offers is 15 km
 * tall in about 200 px, 75 m a pixel, so nothing removed here would have been visible.
 */
const TOLERANCE = 0.0005;

const out = resolve(import.meta.dirname, "../src-tauri/map/world.bin");
const fromAt = process.argv.indexOf("--from");
const from = fromAt > 0 ? process.argv[fromAt + 1] : null;

/**
 * One layer's GeoJSON, from `--from` or downloaded, after checking it matches the pinned file.
 * @param {string} name - the layer's file name without .geojson
 * @returns {Promise<any>} the parsed GeoJSON
 */
async function layer(name) {
  let bytes;
  if (from) {
    bytes = readFileSync(join(from, `${name}.geojson`));
  } else {
    const res = await fetch(`${BASE}/${name}.geojson`);
    if (!res.ok) throw new Error(`map-data: ${name} download failed with HTTP ${res.status}`);
    bytes = Buffer.from(await res.arrayBuffer());
  }
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== LAYERS[name]) throw new Error(`map-data: ${name} checksum mismatch (${sum})`);
  return JSON.parse(bytes.toString("utf8"));
}

/**
 * Every ring or line in a feature collection, as arrays of [lon, lat].
 * @param {any} collection - GeoJSON feature collection
 * @returns {number[][][]} the rings or lines
 */
function parts(collection) {
  const found = [];
  for (const { geometry } of collection.features) {
    const { type, coordinates } = geometry;
    if (type === "LineString") found.push(coordinates);
    else if (type === "MultiLineString" || type === "Polygon") found.push(...coordinates);
    else if (type === "MultiPolygon") coordinates.forEach((polygon) => found.push(...polygon));
  }
  return found;
}

/**
 * Douglas-Peucker on [lon, lat] points, keeping both ends. Iterative, since coastlines run to
 * tens of thousands of points and recursion that deep overflows the stack.
 * @param {number[][]} points - the line or ring
 * @returns {number[][]} the kept points, in order
 */
function simplify(points) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = points[i];
      // Distance to the segment's line, or to its start when the segment closes a ring.
      const d =
        length === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > TOLERANCE) {
      keep[at] = 1;
      stack.push([first, at], [at, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

class Writer {
  chunks = [];
  bytes(list) {
    this.chunks.push(Buffer.from(list));
  }
  /** Unsigned LEB128. */
  varint(n) {
    const list = [];
    do {
      let byte = n & 0x7f;
      n = Math.floor(n / 128);
      if (n > 0) byte |= 0x80;
      list.push(byte);
    } while (n > 0);
    this.bytes(list);
  }
  /** Zigzag, so small negative numbers stay one byte too. */
  signed(n) {
    this.varint(n < 0 ? -2 * n - 1 : 2 * n);
  }
  text(s) {
    const encoded = Buffer.from(s, "utf8");
    this.varint(encoded.length);
    this.chunks.push(encoded);
  }
}

/**
 * Write one layer: a count, then each part's point count and its points as deltas from the
 * previous point (from 0,0 for the first), longitude before latitude.
 * @param {Writer} w - the output
 * @param {number[][][]} list - the layer's parts
 * @param {number} min - fewest points a part needs to be worth drawing
 * @returns {number} points written
 */
function writeLayer(w, list, min) {
  const kept = [];
  for (const part of list) {
    const quantised = [];
    for (const [lon, lat] of simplify(part)) {
      const q = [Math.round(lon * SCALE), Math.round(lat * SCALE)];
      const prev = quantised.at(-1);
      if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) quantised.push(q);
    }
    if (quantised.length >= min) kept.push(quantised);
  }
  w.varint(kept.length);
  let total = 0;
  for (const points of kept) {
    w.varint(points.length);
    let [px, py] = [0, 0];
    for (const [x, y] of points) {
      w.signed(x - px);
      w.signed(y - py);
      [px, py] = [x, y];
    }
    total += points.length;
  }
  return total;
}

const [land, islands, lakes, borders, places] = await Promise.all(
  Object.keys(LAYERS).map((name) => layer(name)),
);

const w = new Writer();
w.bytes([..."PCMAP"].map((c) => c.charCodeAt(0)).concat(1));
const counts = [
  writeLayer(w, [...parts(land), ...parts(islands)], 4),
  writeLayer(w, parts(lakes), 4),
  writeLayer(w, parts(borders), 2),
];

// Places: latitude, longitude, rank (0 is the most important), population, name.
const towns = places.features
  .map(({ properties: p, geometry }) => ({
    lon: Math.round(geometry.coordinates[0] * SCALE),
    lat: Math.round(geometry.coordinates[1] * SCALE),
    rank: p.scalerank,
    pop: Math.max(0, p.pop_max ?? 0),
    name: p.name,
  }))
  .sort((a, b) => a.rank - b.rank || b.pop - a.pop || a.name.localeCompare(b.name, "en"));
w.varint(towns.length);
for (const town of towns) {
  w.signed(town.lat);
  w.signed(town.lon);
  w.bytes([town.rank]);
  w.varint(town.pop);
  w.text(town.name);
}

const bytes = Buffer.concat(w.chunks);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bytes);
console.log(
  `map-data: ${counts.join(" / ")} land / lake / border points and ${towns.length} towns,` +
    ` ${(bytes.length / 1024).toFixed(0)} KiB`,
);
