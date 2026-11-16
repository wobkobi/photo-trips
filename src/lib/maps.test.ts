import type { TransformStyleFunction } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { darkenStyle, googleMapsUrl, placeFromAddress } from "./maps";

type Style = ReturnType<TransformStyleFunction>;

const positron = {
  version: 8,
  sources: {},
  layers: [
    { id: "background", type: "background", paint: { "background-color": "rgb(242,243,240)" } },
    { id: "water", type: "fill", source: "s", paint: { "fill-color": "rgb(194,200,202)" } },
    {
      id: "highway_major_casing",
      type: "line",
      source: "s",
      paint: { "line-color": "#ccc", "line-width": 2 },
    },
    { id: "highway_major_inner", type: "line", source: "s", paint: { "line-color": "#fff" } },
    { id: "label_city", type: "symbol", source: "s", paint: { "text-color": "#000" } },
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
  const dark = darkenStyle(positron);

  it("darkens the land and water", () => {
    expect(paintOf(dark, "background", "background-color")).toBe("#1f2226");
    expect(paintOf(dark, "water", "fill-color")).toBe("#173f46");
  });

  it("keeps roads lighter than the land, with a dark outline", () => {
    expect(paintOf(dark, "highway_major_inner", "line-color")).toBe("#5f6872");
    expect(paintOf(dark, "highway_major_casing", "line-color")).toBe("#121417");
    expect(paintOf(dark, "highway_major_casing", "line-width")).toBe(2);
  });

  it("gives labels light text on a dark halo", () => {
    expect(paintOf(dark, "label_city", "text-color")).toBe("#eef0f2");
    expect(paintOf(dark, "label_city", "text-halo-color")).toBe("#121417");
  });

  it("never leaves an unknown layer white", () => {
    expect(paintOf(dark, "new_upstream_fill", "fill-color")).not.toBe("#fff");
  });

  it("leaves the fetched style alone", () => {
    expect(paintOf(positron, "water", "fill-color")).toBe("rgb(194,200,202)");
  });
});

describe("placeFromAddress", () => {
  it("names the suburb, region and country, not Auckland's local board", () => {
    expect(
      placeFromAddress({
        locality: "Ormiston",
        district: "Flat Bush",
        city: "Manukau",
        state: "Auckland",
        country: "New Zealand",
      }),
    ).toBe("Flat Bush, Auckland, New Zealand");
  });

  it("skips a region that repeats the city", () => {
    expect(
      placeFromAddress({
        district: "Wellington Central",
        city: "Wellington",
        state: "Wellington",
        country: "New Zealand",
      }),
    ).toBe("Wellington Central, Wellington, New Zealand");
  });

  it("uses the locality when the district is the city again", () => {
    expect(
      placeFromAddress({
        locality: "Gros-Caillou",
        district: "Paris",
        city: "Paris",
        state: "Île-de-France",
        country: "France",
      }),
    ).toBe("Gros-Caillou, Île-de-France, France");
  });

  it("falls back to the city without a suburb", () => {
    expect(placeFromAddress({ city: "Hamilton", state: "Waikato", country: "New Zealand" })).toBe(
      "Hamilton, Waikato, New Zealand",
    );
  });

  it("gives nothing in open country", () => {
    expect(placeFromAddress({ state: "Taranaki", country: "New Zealand" })).toBeNull();
    expect(placeFromAddress({})).toBeNull();
  });
});

describe("googleMapsUrl", () => {
  it("opens Google Maps with a pin on the spot", () => {
    expect(googleMapsUrl(-36.8485, 174.7633)).toBe(
      "https://www.google.com/maps/search/?api=1&query=-36.848500,174.763300",
    );
  });
});
