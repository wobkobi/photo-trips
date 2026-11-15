import { openUrl } from "@tauri-apps/plugin-opener";
import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { api, errorText, type MapView } from "../lib/api";
import { themeOf } from "../lib/display";
import { googleMapsUrl, placeFromAddress, placeLookupUrl, type PhotonAddress } from "../lib/maps";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useSettings } from "../lib/useSettings";
import { Icon } from "./Icon";
import { Fact } from "./Viewer";
import { Button } from "./ui";

const PhotoMap = lazy(() => import("./PhotoMap").then((m) => ({ default: m.PhotoMap })));

/**
 * Zoom steps, closest first: the online map's zoom, and the height in km of the built-in map
 * used offline (it doesn't go closer than 15 km).
 */
const ZOOMS = [
  { map: 15, km: 15 },
  { map: 12, km: 15 },
  { map: 10, km: 40 },
  { map: 8, km: 120 },
  { map: 6, km: 400 },
  { map: 4, km: 1500 },
];
/** The zoom stays where it was left as the viewer steps from photo to photo. */
let lastZoom = 1;
/** Once the online map fails, the drawn one is used until the app restarts. */
let mapOffline = false;
/** Suburb names already looked up, by spot, so stepping back to a photo doesn't ask again. */
const places = new Map<string, string | null>();

/**
 * Where a photo was taken: the nearest town's name and a map around it, with buttons to zoom
 * and to open the spot in Google Maps. The map comes from OpenFreeMap and the suburb name from
 * Photon (both OpenStreetMap data), so the spot is sent to them. The built-in town list only
 * knows places of 1,000 people or more (a whole city like "Manukau City" for its suburbs), so
 * it's the fallback offline or in open country, as is the built-in drawn map.
 * @param props - Component props.
 * @param props.lat - latitude in degrees
 * @param props.lon - longitude in degrees
 * @returns the block for the viewer's side panel
 */
export function LocationFact({ lat, lon }: { lat: number; lon: number }): ReactElement {
  const [zoom, setZoom] = useState(lastZoom);
  const spot = `${lat},${lon}`;
  const key = `${spot},${zoom}`;
  const [loaded, setLoaded] = useState<{ key: string; spot: string; view: MapView } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [offline, setOffline] = useState(mapOffline);
  const { settings } = useSettings();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = themeOf(settings);
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const [lookup, setLookup] = useState<{ spot: string; place: string | null } | null>(null);

  // Photon only answers once per spot; a failed request (offline) isn't kept, so it's tried again.
  useEffect(() => {
    if (offline || places.has(spot)) return;
    const abort = new AbortController();
    fetch(placeLookupUrl(lat, lon), { signal: abort.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Photon answered ${res.status}`);
        return res.json() as Promise<{ features?: { properties?: PhotonAddress }[] }>;
      })
      .then((body) => {
        const address = body.features?.[0]?.properties;
        const place = address ? placeFromAddress(address) : null;
        places.set(spot, place);
        setLookup({ spot, place });
      })
      .catch(() => {
        if (!abort.signal.aborted) setLookup({ spot, place: null });
      });
    return () => abort.abort();
  }, [lat, lon, spot, offline]);

  useEffect(() => {
    let active = true;
    api.locationMap(lat, lon, ZOOMS[zoom].km).then(
      (view) => active && setLoaded({ key, spot, view }),
      (err) => active && setFailure({ key, message: errorText(err) }),
    );
    return () => {
      active = false;
    };
  }, [lat, lon, zoom, key, spot]);

  // While another zoom of the same spot loads, the last one stays up rather than flashing empty.
  const view = loaded?.spot === spot ? loaded.view : null;
  const error = failure?.key === key ? failure.message : null;
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  // Until the lookup answers, nothing shows, so the built-in name doesn't flash up first.
  const answered = offline || places.has(spot) || lookup?.spot === spot;
  const looked = places.get(spot) ?? null;
  const place = answered ? (looked ?? view?.place ?? null) : null;

  /**
   * Switch to another zoom step, kept for the next photo.
   * @param next - index into {@link ZOOMS}
   */
  function changeZoom(next: number): void {
    lastZoom = next;
    setZoom(next);
  }

  /** Switch to the drawn map for this and later photos. */
  function goOffline(): void {
    mapOffline = true;
    setOffline(true);
  }

  /** Open the spot in Google Maps in the browser. */
  function openMap(): void {
    openUrl(googleMapsUrl(lat, lon)).catch((err) => setFailure({ key, message: errorText(err) }));
  }

  return (
    <Fact label="Where it was taken">
      {/* A blank line while loading, so the map doesn't jump down when the name arrives. */}
      <p className="selectable">{place ?? (view && answered ? coords : "\u00a0")}</p>
      <div className="mt-2 overflow-hidden rounded-md border border-line bg-map-water">
        {!offline ? (
          <Suspense fallback={<div className="h-47.5" aria-hidden="true" />}>
            <PhotoMap
              lat={lat}
              lon={lon}
              zoom={ZOOMS[zoom].map}
              dark={dark}
              label={place ? `Map around ${place}` : "Map of where it was taken"}
              onFail={goOffline}
            />
          </Suspense>
        ) : view ? (
          <MapPicture view={view} />
        ) : (
          <div className="aspect-280/180" aria-hidden="true" />
        )}
      </div>
      {place && <p className="selectable mt-1 text-[14px] text-faint">{coords}</p>}
      {error && (
        <p role="alert" className="mt-1 text-[15px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => changeZoom(zoom - 1)} disabled={zoom === 0}>
          <Icon name="zoom" size={16} />
          Zoom in
        </Button>
        <Button onClick={() => changeZoom(zoom + 1)} disabled={zoom === ZOOMS.length - 1}>
          <Icon name="zoomOut" size={16} />
          Zoom out
        </Button>
        <Button onClick={openMap}>
          <Icon name="map" size={16} />
          Open in Google Maps
        </Button>
      </div>
    </Fact>
  );
}

/**
 * The map itself: water, land, lakes, borders, towns, the pin at the centre and a scale bar.
 * @param props - Component props.
 * @param props.view - the map drawn for this spot and zoom
 * @returns the map as an SVG
 */
function MapPicture({ view }: { view: MapView }): ReactElement {
  const { width, height, labels } = view;
  const halo = {
    paintOrder: "stroke" as const,
    stroke: "var(--color-map-land)",
    strokeWidth: 3,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="block h-auto w-full"
      role="img"
      aria-label={view.place ? `Map around ${view.place}` : "Map of where it was taken"}
    >
      <path d={view.land} fill="var(--color-map-land)" fillRule="evenodd" />
      <path d={view.lakes} fill="var(--color-map-water)" fillRule="evenodd" />
      <path
        d={view.borders}
        fill="none"
        stroke="var(--color-line-strong)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {labels.map((label) => (
        <g key={label.name}>
          {label.dot && <circle cx={label.x} cy={label.y} r={3} fill="var(--color-ink)" />}
          <text
            x={label.left ? label.x - 6 : label.x + 6}
            y={label.y + 4.5}
            textAnchor={label.left ? "end" : "start"}
            fontSize={13}
            fontWeight={label.nearest ? 700 : 500}
            fill="var(--color-ink)"
            {...halo}
          >
            {label.name}
          </text>
        </g>
      ))}
      <Pin x={width / 2} y={height / 2} />
      <g>
        <path
          d={`M12 ${height - 16}v4h${view.scaleLength}v-4`}
          fill="none"
          stroke="var(--color-ink)"
          strokeWidth={1.5}
        />
        <text x={12} y={height - 17} fontSize={12} fill="var(--color-ink)" {...halo}>
          {view.scaleLabel}
        </text>
      </g>
    </svg>
  );
}

/**
 * A map pin whose point is on the spot. Labels in map.rs are placed clear of its outline.
 * @param props - Component props.
 * @param props.x - the spot's x in map units
 * @param props.y - the spot's y in map units
 * @returns the pin as an SVG group
 */
function Pin({ x, y }: { x: number; y: number }): ReactElement {
  return (
    <g>
      <path
        d={`M${x} ${y}c-1.5-5-7-8-7-13.5a7 7 0 1 1 14 0c0 5.5-5.5 8.5-7 13.5z`}
        fill="var(--color-map-pin)"
        stroke="#ffffff"
        strokeWidth={1.5}
      />
      <circle cx={x} cy={y - 13.5} r={2.6} fill="#ffffff" />
    </g>
  );
}
