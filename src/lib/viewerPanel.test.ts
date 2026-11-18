import { describe, expect, it } from "vitest";
import { parsePanel } from "./viewerPanel";

describe("parsePanel", () => {
  it("shows the panel by default", () => {
    expect(parsePanel(null)).toBe(true);
    expect(parsePanel("garbage")).toBe(true);
  });

  it("keeps a saved choice", () => {
    expect(parsePanel("shown")).toBe(true);
    expect(parsePanel("hidden")).toBe(false);
  });
});
