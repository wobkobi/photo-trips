import { describe, expect, it } from "vitest";
import { LayerStack } from "./layers";

describe("LayerStack", () => {
  it("has nothing on top when empty", () => {
    const stack = new LayerStack();
    expect(stack.size()).toBe(0);
    expect(stack.isTop(1)).toBe(false);
  });

  it("puts the newest layer on top", () => {
    const stack = new LayerStack();
    const viewer = stack.push();
    expect(stack.isTop(viewer)).toBe(true);
    const dialog = stack.push();
    expect(stack.isTop(dialog)).toBe(true);
    expect(stack.isTop(viewer)).toBe(false);
    expect(stack.size()).toBe(2);
  });

  it("hands the top back when the layer above closes", () => {
    const stack = new LayerStack();
    const viewer = stack.push();
    const dialog = stack.push();
    stack.pop(dialog);
    expect(stack.isTop(viewer)).toBe(true);
    expect(stack.isTop(dialog)).toBe(false);
  });

  it("lets a layer under the top close without moving the top", () => {
    const stack = new LayerStack();
    const viewer = stack.push();
    const dialog = stack.push();
    stack.pop(viewer);
    expect(stack.isTop(dialog)).toBe(true);
    expect(stack.size()).toBe(1);
  });

  it("ignores an id that is not open", () => {
    const stack = new LayerStack();
    const viewer = stack.push();
    stack.pop(viewer);
    stack.pop(viewer);
    stack.pop(99);
    expect(stack.size()).toBe(0);
  });

  it("never reuses an id, so a closed layer can't come back as the top", () => {
    const stack = new LayerStack();
    const first = stack.push();
    stack.pop(first);
    const second = stack.push();
    expect(second).not.toBe(first);
    expect(stack.isTop(first)).toBe(false);
  });
});
