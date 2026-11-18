import { describe, expect, it } from "vitest";
import { isFullscreenKey } from "./fullscreen";

const plain = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

describe("isFullscreenKey", () => {
  it("takes F in either case and F11", () => {
    expect(isFullscreenKey({ ...plain, key: "f" })).toBe(true);
    expect(isFullscreenKey({ ...plain, key: "F" })).toBe(true);
    expect(isFullscreenKey({ ...plain, key: "F11" })).toBe(true);
  });

  it("leaves other keys alone", () => {
    expect(isFullscreenKey({ ...plain, key: "g" })).toBe(false);
    expect(isFullscreenKey({ ...plain, key: "F1" })).toBe(false);
    expect(isFullscreenKey({ ...plain, key: "Escape" })).toBe(false);
  });

  it("leaves F with a modifier to other shortcuts", () => {
    expect(isFullscreenKey({ ...plain, key: "f", ctrlKey: true })).toBe(false);
    expect(isFullscreenKey({ ...plain, key: "F", shiftKey: true })).toBe(false);
    expect(isFullscreenKey({ ...plain, key: "f", altKey: true })).toBe(false);
    expect(isFullscreenKey({ ...plain, key: "F11", metaKey: true })).toBe(false);
  });
});
