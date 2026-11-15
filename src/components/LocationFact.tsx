import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { api, errorText, type MapView } from "../lib/api";
import { Icon } from "./Icon";
import { Fact } from "./Viewer";
import { Button } from "./ui";

/** Map heights in km, closest first, with the OpenStreetMap zoom that shows about the same. */
const ZOOMS = [
  { km: 15, osm: 12 },
  { km: 40, osm: 11 },
  { km: 120, osm: 9 },
  { km: 400, osm: 7 },
  { km: 1500, osm: 5 },
];
/** The zoom stays where it was left as the viewer steps from photo to photo. */
let lastZoom = 1;

/**
 * Where a photo was taken: the nearest town's name and the built-in map around it, with buttons
 * to zoom and to open the spot on OpenStreetMap. The map is drawn from data inside the app; only
 * the OpenStreetMap button sends the location anywhere, and only when it's clicked.
 * @param props.lat - latitude in degrees
 * @param props.lon - longitude in degrees
 * @returns the block for the viewer's side panel
 */
export function LocationFact({ lat, lon }: { lat: number; lon: number }) {
  const [zoom, setZoom] = useState(lastZoom);
  const spot = `${lat},${lon}`;
  const key = `${spot},${zoom}`;
  const [loaded, setLoaded] = useState<{ key: string; spot: string; view: MapView } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

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

  function changeZoom(next: number) {
    lastZoom = next;
    setZoom(next);
  }

  function openMap() {
    const at = `${lat.toFixed(5)}/${lon.toFixed(5)}`;
    const url = `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lon.toFixed(5)}#map=${ZOOMS[zoom].osm}/${at}`;
    openUrl(url).catch((err) => setFailure({ key, message: errorText(err) }));
  }

  return (
    <Fact label="Where it was taken">
      {/* A blank line while loading, so the map doesn't jump down when the name arrives. */}
      <p className="selectable">{view?.place ?? (view ? coords : "\u00a0")}</p>
      <div className="mt-2 overflow-hidden rounded-[3px] border border-line bg-map-water">
        {view ? (
          <MapPicture view={view} />
        ) : (
          <div className="aspect-[280/180]" aria-hidden="true" />
        )}
      </div>
      {view?.place && <p className="selectable mt-1 text-[14px] text-faint">{coords}</p>}
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
          Open in OpenStreetMap
        </Button>
      </div>
    </Fact>
  );
}

/** The map itself: water, land, lakes, borders, towns, the pin at the centre and a scale bar. */
function MapPicture({ view }: { view: MapView }) {
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

/** A map pin whose point is on the spot. Labels in map.rs are placed clear of its outline. */
function Pin({ x, y }: { x: number; y: number }) {
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
