// Suburb names from Photon, cached for the session and shared between the viewer's side panel and
// the look-ahead that loads the next photos, so a photo's place is often known before it's shown.
import { placeFromAddress, placeLookupUrl, type PhotonAddress } from "./maps";

/** Answers by spot. Null: Photon had nothing useful there, so the built-in name is used. */
const known = new Map<string, string | null>();
/** Lookups in flight, so the look-ahead and the side panel never ask twice for one spot. */
const asking = new Map<string, Promise<string | null>>();

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
 * @returns the name, null when Photon had none, or undefined when it hasn't answered yet
 */
export function knownPlace(lat: number, lon: number): string | null | undefined {
  return known.get(spotOf(lat, lon));
}

/**
 * Look a spot's suburb up on Photon, once per spot. A failed request (offline, or Photon down)
 * rejects and isn't kept, so the next photo there tries again.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 * @returns the place name, or null when Photon has nothing useful there
 */
export function lookUpPlace(lat: number, lon: number): Promise<string | null> {
  const spot = spotOf(lat, lon);
  if (known.has(spot)) return Promise.resolve(known.get(spot) ?? null);
  const inFlight = asking.get(spot);
  if (inFlight) return inFlight;
  const request = fetch(placeLookupUrl(lat, lon))
    .then((res) => {
      if (!res.ok) throw new Error(`Photon answered ${res.status}`);
      return res.json() as Promise<{ features?: { properties?: PhotonAddress }[] }>;
    })
    .then((body) => {
      const address = body.features?.[0]?.properties;
      const place = address ? placeFromAddress(address) : null;
      known.set(spot, place);
      return place;
    })
    .finally(() => asking.delete(spot));
  asking.set(spot, request);
  return request;
}

/**
 * Start a lookup ahead of time, ignoring failures; the side panel tries again when shown.
 * @param lat - latitude in degrees
 * @param lon - longitude in degrees
 */
export function warmPlace(lat: number, lon: number): void {
  lookUpPlace(lat, lon).catch(() => undefined);
}
