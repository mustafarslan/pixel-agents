/**
 * The open office's live pods, drawn over the canvas: the worktree's name in place of the pod's area label and a dark wash
 * over a pod with no live Claude (a pod with no worktree has no text; a quiet floor reads calmer than "Pod 4" on every empty
 * bay). Kept free of DOM types so the node tests can run it with a recording context.
 */
import {
  AERO_POD_DIM_ALPHA,
  AERO_POD_DIM_COLOR,
  AERO_POD_DIM_LABEL_ALPHA,
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
} from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { TILE_SIZE } from '../office/types.js';

/** The part of a canvas 2D context the pods use. */
export interface PodContext {
  globalAlpha: number;
  fillStyle: string | object;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

interface PodRegion {
  /** Indices into `areaTiles`. */
  tiles: number[];
  /** The centroid, in tiles. */
  cx: number;
  cy: number;
}

const regionCache = new WeakMap<object, Map<string, PodRegion>>();

/** The tiles and centroid of each wanted area label, cached per `areaTiles` array (a rebuilt layout has a new one). */
export function podRegions(
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  wanted: ReadonlySet<string>,
): Map<string, PodRegion> {
  const out = new Map<string, PodRegion>();
  if (!areaTiles || cols <= 0) return out;
  let all = regionCache.get(areaTiles);
  if (!all) {
    all = new Map();
    const sums = new Map<string, { tiles: number[]; x: number; y: number }>();
    for (let i = 0; i < areaTiles.length; i++) {
      const label = areaTiles[i];
      if (!label) continue;
      const acc = sums.get(label) ?? { tiles: [], x: 0, y: 0 };
      acc.tiles.push(i);
      acc.x += i % cols;
      acc.y += Math.floor(i / cols);
      sums.set(label, acc);
    }
    for (const [label, acc] of sums) {
      all.set(label, {
        tiles: acc.tiles,
        cx: acc.x / acc.tiles.length,
        cy: acc.y / acc.tiles.length,
      });
    }
    regionCache.set(areaTiles, all);
  }
  for (const label of wanted) {
    const region = all.get(label);
    if (region) out.set(label, region);
  }
  return out;
}

/**
 * The open office's pods: each pod's worktree name in place of its area label (the stock label is hidden for these), and a
 * dark wash over a pod with no live Claude. A pod with no worktree has no text. The name is drawn with `fillText` only.
 */
export function drawPods(
  ctx: PodContext,
  os: OfficeState,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const pods = os.aero.currentPods();
  if (!pods) return;
  const layout = os.getLayout();
  const regions = podRegions(layout.areaTiles, layout.cols, new Set(Object.keys(pods.labels)));
  if (regions.size === 0) return;
  const s = TILE_SIZE * zoom;
  const colors = new Map<string, string>();
  for (const a of layout.areas ?? []) colors.set(a.label, a.color);

  ctx.globalAlpha = AERO_POD_DIM_ALPHA;
  ctx.fillStyle = AERO_POD_DIM_COLOR;
  for (const [label, region] of regions) {
    if (!pods.labels[label]?.dim) continue;
    for (const i of region.tiles) {
      const c = i % layout.cols;
      const r = Math.floor(i / layout.cols);
      ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
    }
  }

  const size = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);
  ctx.font = `bold ${size}px 'FS Pixel Sans'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [label, region] of regions) {
    const entry = pods.labels[label];
    if (!entry || entry.name === '') continue;
    const x = offsetX + (region.cx + 0.5) * s;
    const y = offsetY + (region.cy + 0.5) * s;
    const dim = entry.dim ? AERO_POD_DIM_LABEL_ALPHA : AREA_LABEL_ALPHA;
    ctx.globalAlpha = AREA_LABEL_SHADOW_ALPHA * dim;
    ctx.fillStyle = AREA_LABEL_SHADOW_COLOR;
    ctx.fillText(entry.name, x + 1, y + 1);
    ctx.globalAlpha = dim;
    ctx.fillStyle = colors.get(label) ?? AREA_LABEL_FALLBACK_COLOR;
    ctx.fillText(entry.name, x, y);
  }
  ctx.globalAlpha = 1;
}
