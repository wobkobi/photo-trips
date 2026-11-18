// The stack of layers drawn over the page (the photo viewer, dialogs), so keys such as Escape,
// the arrows and Delete reach only the one on top. A layer that listens on the window in the
// capture phase runs before a dialog above it sees the key, so it asks whether it is on top first.

import { useCallback, useEffect, useRef } from "react";

/** A stack of open layers, newest on top. */
export class LayerStack {
  /** Ids of the open layers, oldest first. */
  private open: number[] = [];
  /** The id the next layer gets; ids are never reused. */
  private next = 1;

  /**
   * Put a new layer on top.
   * @returns the layer's id, for {@link LayerStack.pop} and {@link LayerStack.isTop}
   */
  push(): number {
    const id = this.next++;
    this.open.push(id);
    return id;
  }

  /**
   * Take a layer off, wherever it is in the stack: layers can close out of order.
   * @param id - the id {@link LayerStack.push} gave; an id no longer open is ignored
   */
  pop(id: number): void {
    const at = this.open.lastIndexOf(id);
    if (at !== -1) this.open.splice(at, 1);
  }

  /**
   * Whether a layer is the newest one still open.
   * @param id - the layer's id
   * @returns true when nothing is open above it
   */
  isTop(id: number): boolean {
    return this.open.length > 0 && this.open[this.open.length - 1] === id;
  }

  /**
   * How many layers are open.
   * @returns the count
   */
  size(): number {
    return this.open.length;
  }
}

/** The app's one layer stack. */
export const layers = new LayerStack();

/**
 * Open a layer for as long as the calling component is mounted.
 * @returns a stable check that the layer is on top, for the component's key handlers
 */
export function useLayer(): () => boolean {
  const id = useRef<number | null>(null);
  useEffect(() => {
    const own = layers.push();
    id.current = own;
    return () => {
      layers.pop(own);
      id.current = null;
    };
  }, []);
  return useCallback(() => id.current !== null && layers.isTop(id.current), []);
}
