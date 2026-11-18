import { describe, expect, it } from "vitest";
import {
  clampPan,
  MAX_SCALE,
  refit,
  stepIn,
  stepOut,
  wheelScale,
  zoomLabel,
  zoomLadder,
  zoomPan,
} from "./zoom";

describe("zoomLadder", () => {
  it("starts at the fitted size and runs up to the top", () => {
    expect(zoomLadder(0.3, MAX_SCALE)).toEqual([0.3, 1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8]);
  });

  it("skips a stop barely above the fitted size", () => {
    expect(zoomLadder(0.47, MAX_SCALE).slice(0, 3)).toEqual([0.47, 2 / 3, 1]);
  });

  it("keeps the exact 100% stop however close the fitted size is", () => {
    expect(zoomLadder(0.98, MAX_SCALE).slice(0, 3)).toEqual([0.98, 1, 1.5]);
  });

  it("stops a preview at its own real size", () => {
    expect(zoomLadder(0.4, 1)).toEqual([0.4, 1 / 2, 2 / 3, 1]);
  });

  it("gives a photo already at the top its fitted size alone", () => {
    expect(zoomLadder(1, 1)).toEqual([1]);
    expect(zoomLadder(1.5, 1)).toEqual([1.5]);
  });
});

describe("stepIn and stepOut", () => {
  const ladder = zoomLadder(0.3, MAX_SCALE);

  it("move one stop at a time", () => {
    expect(stepIn(0.3, ladder)).toBe(1 / 3);
    expect(stepIn(1, ladder)).toBe(1.5);
    expect(stepOut(1, ladder)).toBe(2 / 3);
  });

  it("stop at either end", () => {
    expect(stepIn(8, ladder)).toBe(8);
    expect(stepOut(0.3, ladder)).toBe(0.3);
  });

  it("go to the nearest stop from between stops", () => {
    expect(stepIn(1.2, ladder)).toBe(1.5);
    expect(stepOut(1.2, ladder)).toBe(1);
  });
});

describe("wheelScale", () => {
  it("zooms in a little for a notch away and back out for a notch towards", () => {
    const closer = wheelScale(1, -100, 0.3, MAX_SCALE);
    expect(closer).toBeCloseTo(1.25);
    expect(wheelScale(closer, 100, 0.3, MAX_SCALE)).toBeCloseTo(1);
  });

  it("adds small deltas up to the same as one notch", () => {
    let scale = 1;
    for (let i = 0; i < 10; i++) scale = wheelScale(scale, -10, 0.3, MAX_SCALE);
    expect(scale).toBeCloseTo(1.25);
  });

  it("stays between the fitted size and the top", () => {
    expect(wheelScale(0.31, 1000, 0.3, MAX_SCALE)).toBe(0.3);
    expect(wheelScale(7.9, -1000, 0.3, MAX_SCALE)).toBe(MAX_SCALE);
    expect(wheelScale(1.5, -100, 1.5, 1)).toBe(1.5);
  });
});

describe("zoomPan", () => {
  it("keeps the point under the pointer still", () => {
    // A point 100px right of centre, on a photo panned 20px left, doubled in size.
    const pan = zoomPan({ x: -20, y: 0 }, { x: 100, y: 50 }, 2);
    expect(pan).toEqual({ x: -140, y: -50 });
    // The photo point under the pointer was 120px right of the photo's centre; now it is 240.
    expect(100 - pan.x).toBe(240);
  });

  it("leaves the pan alone at a ratio of 1", () => {
    expect(zoomPan({ x: 30, y: -10 }, { x: 5, y: 5 }, 1)).toEqual({ x: 30, y: -10 });
  });
});

describe("zoomLabel", () => {
  it("names the fitted size", () => {
    expect(zoomLabel(0.342, true)).toBe("Fit 34%");
  });

  it("shows the percent alone when zoomed", () => {
    expect(zoomLabel(1, false)).toBe("100%");
    expect(zoomLabel(2, false)).toBe("200%");
  });

  it("says Fit until the size is known", () => {
    expect(zoomLabel(0, true)).toBe("Fit");
  });

  it("never rounds down to 0%", () => {
    expect(zoomLabel(0.001, true)).toBe("Fit 1%");
  });
});

describe("refit", () => {
  it("fits a zoom the new fitted size has caught up with", () => {
    expect(refit(0.5, 0.5)).toBeNull();
    expect(refit(0.5, 0.8)).toBeNull();
  });

  it("keeps a zoom still closer than fitted", () => {
    expect(refit(2, 0.5)).toBe(2);
  });

  it("keeps fitted fitted, and any zoom while the size isn't known", () => {
    expect(refit(null, 0.5)).toBeNull();
    expect(refit(2, 0)).toBe(2);
  });
});

describe("clampPan", () => {
  it("pulls a pan back within reach", () => {
    expect(clampPan({ x: 300, y: -300 }, { x: 100, y: 50 })).toEqual({ x: 100, y: -50 });
  });

  it("centres a pan with no reach left, as when the photo fits again", () => {
    expect(clampPan({ x: 40, y: 20 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("gives back the same pan when it is within reach", () => {
    const pan = { x: 10, y: -10 };
    expect(clampPan(pan, { x: 100, y: 100 })).toBe(pan);
  });
});
