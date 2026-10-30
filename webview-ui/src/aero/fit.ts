/**
 * Fitting a line of text into a width, for the clock plate. Kept apart from the drawing so it can be tested without a canvas.
 */
import { clip } from './update.js';

/** `text` cut (with an ellipsis) until `measure` says it fits in `room`. */
export function fitText(text: string, room: number, measure: (text: string) => number): string {
  let fitted = clip(text, 60);
  while (fitted.length > 1 && measure(fitted) > room) {
    fitted = clip(fitted, Array.from(fitted).length - 1);
  }
  return fitted;
}

/** The clock plate's fitted text, kept by text and zoom (and the font's measure of an "M", which changes when the font loads). */
const fitCache = new Map<string, string>();

export function fitCached(
  text: string,
  room: number,
  zoom: number,
  measure: (text: string) => number,
): string {
  const key = `${zoom}|${room}|${measure('M')}|${text}`;
  const hit = fitCache.get(key);
  if (hit !== undefined) return hit;
  if (fitCache.size >= 16) fitCache.clear();
  const fitted = fitText(text, room, measure);
  fitCache.set(key, fitted);
  return fitted;
}

/** @internal for tests */
export function fitCacheSize(): number {
  return fitCache.size;
}
