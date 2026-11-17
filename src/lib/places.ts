// Suburb names from Nominatim, cached for the session and shared between the viewer's side panel
// and the look-ahead that loads the next photos, so a photo's place is often known before it's
// shown. The app sends at most one lookup a second, so look-ahead lookups go one at a time and
// never hold up the photo on show for more than one turn.
import { api } from "./api";

/** Answers by spot. Null: Nominatim had nothing useful there, so the built-in name is used. */
const known = new Map<string, string | null>();
/** Lookups in flight, so the look-ahead and the side panel never ask twice for one spot. */
const asking = new Map<string, Promise<string | null>>();
/** Look-ahead spots waiting their turn, in the order asked. */
const waiting: { lat: number; lon: number }[] = [];
/**
 * Look-ahead spots kept waiting at most. Stepping quickly through photos queues more than the
 * one-a-second limit can answer, and the oldest are the photos already left behind.
 */
const MAX_WAITING = 6;
let warming = false;

/**
 * The cache key for a spot.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the key
 */
function spotOf(lat: number, lon: number): string {
  return `${lat},${lon}`;
}

/**
 * A place name already looked up this session.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the name, null when Nominatim had none, or undefined when it hasn't answered yet
 */
export function knownPlace(lat: number, lon: number): string | null | undefined {
  return known.get(spotOf(lat, lon));
}

/**
 * Look a spot's suburb up, once per spot. A failed request (offline, or Nominatim down) rejects
 * and isn't kept, so the next photo there tries again.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the place name, or null when Nominatim has nothing useful there
 */
export function lookUpPlace(lat: number, lon: number): Promise<string | null> {
  const spot = spotOf(lat, lon);
  if (known.has(spot)) return Promise.resolve(known.get(spot) ?? null);
  const inFlight = asking.get(spot);
  if (inFlight) return inFlight;
  const request = api
    .placeName(lat, lon)
    .then((place) => {
      known.set(spot, place);
      return place;
    })
    .finally(() => asking.delete(spot));
  asking.set(spot, request);
  return request;
}

/**
 * Queue a lookup ahead of time, ignoring failures; the side panel tries again when shown. The
 * viewer asks for the nearest photos first, so they are answered in that order.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 */
export function warmPlace(lat: number, lon: number): void {
  const spot = spotOf(lat, lon);
  if (known.has(spot) || asking.has(spot)) return;
  if (waiting.some((w) => spotOf(w.lat, w.lon) === spot)) return;
  waiting.push({ lat, lon });
  if (waiting.length > MAX_WAITING) waiting.shift();
  if (!warming) warmNext();
}

/** Look up the first waiting spot, then the next once it has answered. */
function warmNext(): void {
  const next = waiting.shift();
  if (!next) {
    warming = false;
    return;
  }
  warming = true;
  lookUpPlace(next.lat, next.lon)
    .catch(() => undefined)
    .finally(warmNext);
}
