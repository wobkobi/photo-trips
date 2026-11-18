import { describe, expect, it } from "vitest";
import { historyStepForButton, historyStepForKey, shortcutFor } from "./menu";

/**
 * A fake key press for {@link shortcutFor}.
 * @param key - the key value, e.g. "i" or "F5"
 * @param mods - modifier keys held down
 * @param mods.ctrl - Ctrl held
 * @param mods.shift - Shift held
 * @param mods.alt - Alt held
 * @returns the key press
 */
const press = (
  key: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): Parameters<typeof shortcutFor>[0] => ({
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

  it("takes Ctrl+F for the app's own Find", () => {
    expect(shortcutFor(press("f", { ctrl: true }))).toBe("menu-find");
    expect(shortcutFor(press("f"))).toBeNull();
  });

  it("matches F5 on its own and Ctrl+comma", () => {
    expect(shortcutFor(press("F5"))).toBe("menu-refresh");
    expect(shortcutFor(press(",", { ctrl: true }))).toBe("menu-settings");
  });

  it("goes by the physical key for digits", () => {
    expect(shortcutFor(press("2", { ctrl: true }))).toBe("menu-page-trips");
    expect(shortcutFor(press("4", { ctrl: true }))).toBe("menu-page-sort");
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

describe("historyStepForKey", () => {
  it("goes back on Alt+Left and forward on Alt+Right", () => {
    expect(historyStepForKey(press("ArrowLeft", { alt: true }))).toBe("back");
    expect(historyStepForKey(press("ArrowRight", { alt: true }))).toBe("forward");
  });

  it("ignores the arrows without Alt or with other modifiers", () => {
    expect(historyStepForKey(press("ArrowLeft"))).toBeNull();
    expect(historyStepForKey(press("ArrowLeft", { alt: true, ctrl: true }))).toBeNull();
    expect(historyStepForKey(press("ArrowRight", { alt: true, shift: true }))).toBeNull();
    expect(historyStepForKey(press("ArrowUp", { alt: true }))).toBeNull();
  });
});

describe("historyStepForButton", () => {
  it("maps the side buttons and nothing else", () => {
    expect(historyStepForButton(3)).toBe("back");
    expect(historyStepForButton(4)).toBe("forward");
    expect(historyStepForButton(0)).toBeNull();
    expect(historyStepForButton(1)).toBeNull();
    expect(historyStepForButton(2)).toBeNull();
  });
});
