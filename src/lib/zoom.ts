// Viewer zoom maths. A scale is screen pixels per image pixel, so 1 is the picture at its real
// size (100%), whatever size fits it in the window.

/** Stops the zoom ladder moves through above the fitted size. */
export const STOPS = [1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 1, 1.5, 2, 3, 4, 6, 8];

/** The closest zoom for a picture shown from its original file: 800%. */
export const MAX_SCALE = 8;

/**
 * A stop this little above the fitted size is skipped, so one step never barely moves the photo.
 * 100% is kept regardless: it is the one exact size worth landing on.
 */
const SKIP = 1.1;

/** Scales this close count as the same, so float drift doesn't make a stop step to itself. */
const EPSILON = 1e-6;

/**
 * Each wheel delta unit's share of a zoom, as a power of e: a mouse notch of 100 zooms by 1.25,
 * and a touchpad pinch's stream of small deltas adds up to the same.
 */
const WHEEL_RATE = Math.log(1.25) / 100;

/** A point, or a pan, in px from the stage's centre. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The stops a photo can zoom to: its fitted size first, then each of {@link STOPS} above it up to
 * `top`. A photo already at or past `top` when fitted gets the fitted size alone.
 * @param fit - the scale the photo shows at when fitted to the window
 * @param top - the closest zoom allowed
 * @returns the stops, smallest first
 */
export function zoomLadder(fit: number, top: number): number[] {
  const above = STOPS.filter(
    (stop) => stop <= top + EPSILON && (stop === 1 ? stop > fit + EPSILON : stop > fit * SKIP),
  );
  return [fit, ...above];
}

/**
 * The next stop closer in, or the last stop when already there. Works from a scale between stops
 * too, as a Ctrl+wheel zoom leaves.
 * @param scale - the scale now
 * @param ladder - the photo's stops, from {@link zoomLadder}
 * @returns the scale to go to
 */
export function stepIn(scale: number, ladder: number[]): number {
  return ladder.find((stop) => stop > scale + EPSILON) ?? ladder[ladder.length - 1];
}

/**
 * The next stop further out, or the fitted size when already there.
 * @param scale - the scale now
 * @param ladder - the photo's stops, from {@link zoomLadder}
 * @returns the scale to go to
 */
export function stepOut(scale: number, ladder: number[]): number {
  const below = ladder.filter((stop) => stop < scale - EPSILON);
  return below.length ? below[below.length - 1] : ladder[0];
}

/**
 * The scale a Ctrl+wheel turn zooms to: smooth, so each delta zooms by a little, and kept
 * between the fitted size and the closest zoom allowed.
 * @param scale - the scale now
 * @param deltaY - the wheel's travel; negative is away from the user, which zooms in
 * @param fit - the fitted scale, the furthest out it goes
 * @param top - the closest zoom allowed
 * @returns the scale to go to
 */
export function wheelScale(scale: number, deltaY: number, fit: number, top: number): number {
  return Math.min(Math.max(fit, top), Math.max(fit, scale * Math.exp(-deltaY * WHEEL_RATE)));
}

/**
 * The pan that keeps the point under `at` still while the photo grows or shrinks by `ratio`.
 * @param pan - the pan now
 * @param at - the point to zoom about
 * @param ratio - the new scale over the old
 * @returns the pan to use, before keeping it within the photo's edges
 */
export function zoomPan(pan: Point, at: Point, ratio: number): Point {
  return { x: at.x - (at.x - pan.x) * ratio, y: at.y - (at.y - pan.y) * ratio };
}

/**
 * The zoom readout in the viewer's bar, e.g. "Fit 34%" while fitted and "200%" when zoomed.
 * @param scale - the scale now, or 0 while the photo's size isn't known yet
 * @param fitted - whether the photo is fitted to the window
 * @returns the readout
 */
export function zoomLabel(scale: number, fitted: boolean): string {
  if (!scale) return "Fit";
  const percent = `${Math.max(1, Math.round(scale * 100))}%`;
  return fitted ? `Fit ${percent}` : percent;
}

/**
 * The zoom to keep after the fitted size changes (a turn, the details panel, fullscreen, a
 * resize): a zoom no closer than the new fitted size fits the photo instead, so a zoomed photo is
 * never drawn smaller than fitted.
 * @param scale - the zoom now, or null while fitted
 * @param fit - the new fitted scale, 0 while the photo's size isn't known
 * @returns the zoom to keep, or null to fit
 */
export function refit(scale: number | null, fit: number): number | null {
  return scale !== null && fit > 0 && scale <= fit + EPSILON ? null : scale;
}

/**
 * A pan kept within reach of the photo's edges. The same pan comes back when it is already
 * within reach, so a state holding it doesn't redraw for no change.
 * @param pan - the pan wanted
 * @param reach - how far the pan may go each way, from the centre
 * @returns the pan, pulled back where needed
 */
export function clampPan(pan: Point, reach: Point): Point {
  const x = Math.max(-reach.x, Math.min(reach.x, pan.x));
  const y = Math.max(-reach.y, Math.min(reach.y, pan.y));
  return x === pan.x && y === pan.y ? pan : { x, y };
}
