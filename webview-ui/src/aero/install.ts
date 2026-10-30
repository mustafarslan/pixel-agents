/**
 * The page's side of the bridge with Aero.
 *
 * - `window.aeroOffice.update(data)`: Aero pushes small JSON (see update.ts). It is always installed.
 * - `postToAero(type)`: the page tells Aero about a click on a wall object, only `openInbox` or `openCalendar`, to
 *   `webkit.messageHandlers.aero`, and only when that handler exists (Aero's WKWebView has it, a browser doesn't).
 */
import type { WallHit } from './lounge.js';
import { setAeroUpdate } from './office.js';

interface AeroWindow {
  aeroOffice?: { update: (data: unknown) => boolean };
  webkit?: { messageHandlers?: { aero?: { postMessage?: (message: unknown) => void } } };
}

/** The page's window, found through `globalThis` (this file is also compiled for the node tests, which have no DOM lib). */
function pageWindow(): AeroWindow | null {
  const w = (globalThis as unknown as { window?: AeroWindow }).window;
  return w ?? null;
}

export function installAeroOffice(): void {
  const w = pageWindow();
  if (!w || w.aeroOffice) return;
  const api = {
    update(data: unknown): boolean {
      const accepted = setAeroUpdate(data);
      if (!accepted) console.warn('[aeroOffice] update rejected');
      return accepted;
    },
  };
  Object.defineProperty(w, 'aeroOffice', {
    value: Object.freeze(api),
    configurable: false,
    writable: false,
  });
}

/** Posts a wall click to Aero. Returns whether it was posted. */
export function postToAero(type: WallHit): boolean {
  if (type !== 'openInbox' && type !== 'openCalendar') return false;
  const handler = pageWindow()?.webkit?.messageHandlers?.aero;
  if (!handler || typeof handler.postMessage !== 'function') return false;
  handler.postMessage({ type });
  return true;
}

/**
 * A tap at world point (x, y): whether it landed on a wall object, which then takes the tap whatever else is there. Only a tap
 * the browser made from a real click (`trusted`, the event's `isTrusted`) tells Aero; a script's `dispatchEvent` does nothing.
 */
export function handleWallTap(
  office: { aero: { wallHitAt(x: number, y: number): WallHit | null } },
  worldX: number,
  worldY: number,
  trusted: boolean,
): boolean {
  const wall = office.aero.wallHitAt(worldX, worldY);
  if (wall === null) return false;
  if (trusted) postToAero(wall);
  return true;
}
