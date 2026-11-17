import { describe, expect, it } from "vitest";
import { keepsWebviewMenu } from "./webviewMenu";

/**
 * A stand-in element that is, or sits inside, a text place or not.
 * @param inText - whether `closest` finds a text place
 * @returns the element
 */
function element(inText: boolean): EventTarget {
  return {
    /**
     * Find a text place around the element.
     * @returns a match, or null
     */
    closest: () => (inText ? {} : null),
  } as unknown as EventTarget;
}

describe("keepsWebviewMenu", () => {
  it("keeps the menu for text that can be edited or selected", () => {
    expect(keepsWebviewMenu(element(true), false, false)).toBe(true);
  });

  it("hides it everywhere else", () => {
    expect(keepsWebviewMenu(element(false), false, false)).toBe(false);
    expect(keepsWebviewMenu(null, false, false)).toBe(false);
    // The window or document, which has no closest().
    expect(keepsWebviewMenu({} as EventTarget, false, false)).toBe(false);
  });

  it("keeps it for Shift+right-click only in development builds", () => {
    expect(keepsWebviewMenu(element(false), true, true)).toBe(true);
    expect(keepsWebviewMenu(element(false), true, false)).toBe(false);
  });
});
