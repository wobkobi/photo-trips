// The viewer's online map, kept in its own module so MapLibre (and its stylesheet) only loads
// the first time a photo with a location is opened.
import { Map as MapLibreMap, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, type ReactElement } from "react";
import { mapStyleUrl } from "../lib/maps";

// MapLibre finds its worker beside its own file, which Vite moves; point it at the bundled copy.
setWorkerUrl(workerUrl);

/** The pin's point sits on the spot; the colour follows the theme through the CSS token. */
const PIN = `<svg width="16" height="24" viewBox="-8 -24 16 24" style="display:block;overflow:visible" aria-hidden="true"><path d="M0 0c-1.5-5-7-8-7-13.5a7 7 0 1 1 14 0c0 5.5-5.5 8.5-7 13.5z" fill="var(--color-map-pin)" stroke="#fff" stroke-width="1.5"/><circle cx="0" cy="-13.5" r="2.6" fill="#fff"/></svg>`;

/**
 * A map of the spot from OpenFreeMap, with a pin on it. It can be dragged and double-clicked
 * to zoom; the mouse wheel is left to scroll the side panel. If the map style can't be fetched
 * (offline, blocked), `onFail` hands over to the built-in drawn map.
 * @param props - Component props.
 * @param props.lat - latitude in degrees
 * @param props.lon - longitude in degrees
 * @param props.zoom - MapLibre zoom (512px tiles, so one step closer than the same number on
 * a 256px tile map)
 * @param props.dark - use the dark map style
 * @param props.label - what a screen reader says for the map
 * @param props.onFail - called when the map can't load
 * @returns the map
 */
export function PhotoMap({
  lat,
  lon,
  zoom,
  dark,
  label,
  onFail,
}: {
  lat: number;
  lon: number;
  zoom: number;
  dark: boolean;
  label: string;
  onFail: () => void;
}): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  // The first render's values build the map; the effects below follow later changes.
  const initial = useRef({ lat, lon, zoom, dark });
  const fail = useRef(onFail);

  useEffect(() => {
    fail.current = onFail;
  }, [onFail]);

  useEffect(() => {
    if (!box.current) return;
    const start = initial.current;
    const created = new MapLibreMap({
      container: box.current,
      style: mapStyleUrl(start.dark),
      center: [start.lon, start.lat],
      zoom: start.zoom,
      attributionControl: { compact: true },
      scrollZoom: false,
      keyboard: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    // A tile failing after the style loaded leaves a gap; only a style that never loads fails.
    created.on("error", () => {
      if (!created.isStyleLoaded()) fail.current();
    });
    // The compact credit starts unfolded over the small map; fold it to its (i) button.
    created.once("load", () => {
      box.current
        ?.querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
    });
    const pin = document.createElement("div");
    pin.innerHTML = PIN;
    marker.current = new Marker({ element: pin, anchor: "bottom" })
      .setLngLat([start.lon, start.lat])
      .addTo(created);
    map.current = created;
    return () => {
      created.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    marker.current?.setLngLat([lon, lat]);
    map.current?.jumpTo({ center: [lon, lat] });
  }, [lat, lon]);

  useEffect(() => {
    map.current?.easeTo({ zoom, duration: 300 });
  }, [zoom]);

  useEffect(() => {
    if (map.current && dark !== initial.current.dark) {
      map.current.setStyle(mapStyleUrl(dark));
      initial.current.dark = dark;
    }
  }, [dark]);

  useEffect(() => {
    map.current?.getCanvas().setAttribute("aria-label", label);
  }, [label]);

  return <div ref={box} className="h-47.5 w-full" />;
}
