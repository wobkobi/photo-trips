import { describe, expect, it } from "vitest";
import { shortcutFor } from "./menu";

const press = (key: string, mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) => ({
  key,
  code: /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: false,
});

describe("shortcutFor", () => {
  it("matches letters in either case", () => {
    expect(shortcutFor(press("i", { ctrl: true }))).toBe("menu-import");
    expect(shortcutFor(press("Q", { ctrl: true }))).toBe("menu-quit");
  });

  it("matches F5 on its own and Ctrl+comma", () => {
    expect(shortcutFor(press("F5"))).toBe("menu-refresh");
    expect(shortcutFor(press(",", { ctrl: true }))).toBe("menu-settings");
  });

  it("goes by the physical key for digits", () => {
    expect(shortcutFor(press("2", { ctrl: true }))).toBe("menu-page-sort");
    // AZERTY: the 7 key types "è" without Shift.
    expect(shortcutFor({ ...press("è", { ctrl: true }), code: "Digit7" })).toBe(
      "menu-page-history",
    );
  });

  it("ignores keys that aren't a menu shortcut", () => {
    expect(shortcutFor(press("i"))).toBeNull();
    expect(shortcutFor(press("F5", { ctrl: true }))).toBeNull();
    expect(shortcutFor(press("w", { ctrl: true, shift: true }))).toBeNull();
    expect(shortcutFor(press("1", { ctrl: true, alt: true }))).toBeNull();
    expect(shortcutFor(press("8", { ctrl: true }))).toBeNull();
  });
});
