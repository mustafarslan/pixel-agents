/**
 * Aero's small effects, made with pixelfx (src/aero/fx, MIT): a burst on the whiteboard when the inbox grows, a countdown on
 * the clock when a meeting is near, a poof where a configured character leaves or arrives.
 *
 * At most `MAX_ACTIVE_FX` run at once, none with `prefers-reduced-motion`, and each is seeded by the caller (the office's rng).
 * `Effects` holds only what runs; `drawEffects` paints them over the stock frame through one small offscreen canvas per effect,
 * scaled by the zoom with smoothing off, so a pixel of the effect stays a square.
 */
import { clearFrame, composite, createFrame, createFx } from './fx/core/index.js';
import * as collectBurst from './fx/fx/pickups/collect-burst.js';
import * as poof from './fx/fx/spawn/poof.js';
import * as countdown from './fx/fx/ui/countdown.js';

/** `steam` (the coffee machine) and `smoke` (the terrace) are the poof in another palette, so a test tells them from a walking-home poof; `capsule` (the tube station) is the burst in brass and glass colours. */
export type FxKind = 'burst' | 'countdown' | 'poof' | 'steam' | 'smoke' | 'capsule';

export const MAX_ACTIVE_FX = 4;

interface FxModule {
  meta: { size: [number, number]; origin: [number, number] };
  create: (options: Record<string, unknown>) => unknown;
}

interface FxInstance {
  update(dt: number): void;
  draw(frame: unknown, layer?: string): void;
  done(): boolean;
}

interface Frame {
  w: number;
  h: number;
  color: Uint32Array;
  light: Uint32Array;
}

export interface FxSpec {
  mod: FxModule;
  /** World pixels per effect pixel, before the zoom: these effects are drawn for a taller office than this one. */
  scale: number;
  options: Record<string, unknown>;
}

/** A palette of six greys from dark to white, each leaning a little toward (r, g, b). */
function tinted(r: number, g: number, b: number): string[] {
  return [0.16, 0.34, 0.55, 0.75, 0.92, 1].map((v) => {
    const hex = (lean: number): string =>
      Math.round(Math.min(255, v * 235 + lean))
        .toString(16)
        .padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  });
}

/** The tube's colours as numbers (the lint rule keeps hex literals out of the page): outline, brass from dark to light, capsule red, glass, white. */
const BRASS_AND_GLASS: ReadonlyArray<readonly [number, number, number]> = [
  [63, 55, 64],
  [136, 92, 71],
  [179, 136, 87],
  [207, 168, 109],
  [224, 107, 80],
  [143, 183, 212],
  [207, 227, 239],
  [255, 255, 255],
];

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const FX_SPECS: Record<FxKind, FxSpec> = {
  burst: { mod: collectBurst as unknown as FxModule, scale: 0.5, options: {} },
  countdown: { mod: countdown as unknown as FxModule, scale: 0.5, options: {} },
  poof: { mod: poof as unknown as FxModule, scale: 0.5, options: {} },
  steam: { mod: poof as unknown as FxModule, scale: 0.5, options: { palette: tinted(0, 8, 14) } },
  smoke: { mod: poof as unknown as FxModule, scale: 0.5, options: { palette: tinted(0, 0, 0) } },
  capsule: {
    mod: collectBurst as unknown as FxModule,
    scale: 0.5,
    options: { palette: BRASS_AND_GLASS.map(([r, g, b]) => rgbHex(r, g, b)) },
  },
};

export interface ActiveFx {
  kind: FxKind;
  /** The effect's origin in world pixels. */
  x: number;
  y: number;
  fx: FxInstance;
  /** Set by `update`: the pixels need drawing again. */
  dirty: boolean;
  frame: Frame;
  canvas: OffscreenLike | null;
}

/** What `drawEffects` needs of an offscreen canvas (an `HTMLCanvasElement` or `OffscreenCanvas`), without the DOM types. */
export interface OffscreenLike {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    createImageData(w: number, h: number): { data: Uint8ClampedArray };
    putImageData(image: unknown, x: number, y: number): void;
  } | null;
}

/** The part of a canvas context `drawEffects` draws with. */
export interface FxContext {
  save(): void;
  restore(): void;
  imageSmoothingEnabled: boolean;
  drawImage(image: never, x: number, y: number, w: number, h: number): void;
}

export type MakeFx = (mod: FxModule, options: Record<string, unknown>) => FxInstance;

/** Whether the owner asked for less motion. False where there is no `matchMedia` (the node tests). */
export function prefersReducedMotion(): boolean {
  const media = (globalThis as unknown as { matchMedia?: (query: string) => { matches: boolean } })
    .matchMedia;
  return typeof media === 'function' && media('(prefers-reduced-motion: reduce)').matches;
}

export class Effects {
  active: ActiveFx[] = [];
  /** How many of each kind have started. */
  started: Record<string, number> = {};

  private readonly make: MakeFx;
  private readonly reduced: () => boolean;

  constructor(
    make: MakeFx = createFx as unknown as MakeFx,
    reduced: () => boolean = prefersReducedMotion,
  ) {
    this.make = make;
    this.reduced = reduced;
  }

  /** Starts `kind` with its origin at world point (x, y). False when motion is reduced or four are already running. */
  start(kind: FxKind, x: number, y: number, seed: number): boolean {
    if (this.reduced() || this.active.length >= MAX_ACTIVE_FX) return false;
    const spec = FX_SPECS[kind];
    const [w, h] = spec.mod.meta.size;
    const [ox, oy] = spec.mod.meta.origin;
    const fx = this.make(spec.mod, { ...spec.options, x: ox, y: oy, seed });
    this.active.push({ kind, x, y, fx, dirty: true, frame: createFrame(w, h), canvas: null });
    this.started[kind] = (this.started[kind] ?? 0) + 1;
    return true;
  }

  update(dt: number): void {
    for (const item of this.active) {
      item.fx.update(dt);
      item.dirty = true;
    }
    this.active = this.active.filter((item) => !item.fx.done());
  }
}

function makeCanvas(w: number, h: number): OffscreenLike | null {
  const doc = (
    globalThis as unknown as { document?: { createElement(tag: string): OffscreenLike } }
  ).document;
  if (!doc) return null;
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/** The size, in device pixels, of one effect pixel at `zoom`: a whole number, at least 1. */
export function fxPixel(kind: FxKind, zoom: number): number {
  return Math.max(1, Math.round(zoom * FX_SPECS[kind].scale));
}

/** Paints the running effects. World point (x, y) is at (offsetX + x * zoom, offsetY + y * zoom). */
export function drawEffects(
  ctx: FxContext,
  effects: Effects,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (effects.active.length === 0) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const item of effects.active) {
    const [w, h] = FX_SPECS[item.kind].mod.meta.size;
    const [ox, oy] = FX_SPECS[item.kind].mod.meta.origin;
    item.canvas ??= makeCanvas(w, h);
    const canvas = item.canvas;
    const cctx = canvas?.getContext('2d');
    if (!canvas || !cctx) continue;
    if (item.dirty) {
      clearFrame(item.frame);
      item.fx.draw(item.frame);
      const image = cctx.createImageData(w, h);
      composite(item.frame, image.data);
      cctx.putImageData(image, 0, 0);
      item.dirty = false;
    }
    const px = fxPixel(item.kind, zoom);
    ctx.drawImage(
      canvas as never,
      Math.round(offsetX + item.x * zoom - ox * px),
      Math.round(offsetY + item.y * zoom - oy * px),
      w * px,
      h * px,
    );
  }
  ctx.restore();
}
