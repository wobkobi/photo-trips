import type { TransformStyleFunction } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { darkenStyle, googleMapsUrl } from "./maps";

type Style = ReturnType<TransformStyleFunction>;

const liberty = {
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#f8f4f0" } },
    { id: "natural_earth", type: "raster", source: "r", paint: { "raster-opacity": 0.6 } },
    { id: "water", type: "fill", source: "s", paint: { "fill-color": "rgb(158,189,255)" } },
    {
      id: "park",
      type: "fill",
      source: "s",
      paint: { "fill-color": "#d8e8c8", "fill-outline-color": "rgba(95, 208, 100, 1)" },
    },
    { id: "landcover_wetland", type: "fill", source: "s", paint: { "fill-pattern": "wetland" } },
    {
      id: "road_trunk_primary_casing",
      type: "line",
      source: "s",
      paint: { "line-color": "#e9ac77", "line-width": 2 },
    },
    { id: "road_trunk_primary", type: "line", source: "s", paint: { "line-color": "#fea" } },
    { id: "road_motorway", type: "line", source: "s", paint: { "line-color": "#fc8" } },
    { id: "road_minor", type: "line", source: "s", paint: { "line-color": "#fff" } },
    { id: "label_city", type: "symbol", source: "s", paint: { "text-color": "#000" } },
    { id: "road_shield_us", type: "symbol", source: "s", layout: {} },
    { id: "new_upstream_fill", type: "fill", source: "s", paint: { "fill-color": "#fff" } },
  ],
} as unknown as Style;

/**
 * One paint property of a layer in a style.
 * @param style - the style
 * @param id - the layer's id
 * @param key - the paint property
 * @returns its value
 */
function paintOf(style: Style, id: string, key: string): unknown {
  const layer = style.layers.find((l) => l.id === id) as { paint?: Record<string, unknown> };
  return layer.paint?.[key];
}

describe("darkenStyle", () => {
  const dark = darkenStyle(liberty);

  it("darkens the land, keeping water blue and parks green", () => {
    expect(paintOf(dark, "background", "background-color")).toBe("#1f2226");
    expect(paintOf(dark, "water", "fill-color")).toBe("#1b3556");
    expect(paintOf(dark, "park", "fill-color")).toBe("#1f3324");
    expect(paintOf(dark, "park", "fill-outline-color")).toBe("#1f3324");
  });

  it("keeps road colours by class, lighter than the land, with a dark outline", () => {
    expect(paintOf(dark, "road_motorway", "line-color")).toBe("#b8763a");
    expect(paintOf(dark, "road_trunk_primary", "line-color")).toBe("#8c7a3e");
    expect(paintOf(dark, "road_minor", "line-color")).toBe("#4a525b");
    expect(paintOf(dark, "road_trunk_primary_casing", "line-color")).toBe("#121417");
    expect(paintOf(dark, "road_trunk_primary_casing", "line-width")).toBe(2);
  });

  it("gives labels light text on a dark halo, and leaves road shields alone", () => {
    expect(paintOf(dark, "label_city", "text-color")).toBe("#eef0f2");
    expect(paintOf(dark, "label_city", "text-halo-color")).toBe("#121417");
    expect(paintOf(dark, "road_shield_us", "text-color")).toBeUndefined();
  });

  it("fades patterned fills and dims the relief backdrop", () => {
    expect(paintOf(dark, "landcover_wetland", "fill-opacity")).toBe(0.15);
    expect(paintOf(dark, "landcover_wetland", "fill-color")).toBeUndefined();
    expect(paintOf(dark, "natural_earth", "raster-brightness-max")).toBe(0.35);
  });

  it("never leaves an unknown layer white", () => {
    expect(paintOf(dark, "new_upstream_fill", "fill-color")).not.toBe("#fff");
  });

  it("leaves the fetched style alone", () => {
    expect(paintOf(liberty, "water", "fill-color")).toBe("rgb(158,189,255)");
  });
});

describe("googleMapsUrl", () => {
  it("opens Google Maps with a pin on the spot", () => {
    expect(googleMapsUrl(-36.8485, 174.7633)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-36.848500,174.763300",
    );
  });
});
