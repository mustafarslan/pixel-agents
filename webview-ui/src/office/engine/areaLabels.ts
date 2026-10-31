import {
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
} from '../../constants.js';
import type { AreaDefinition } from '../types.js';
import { TILE_SIZE } from '../types.js';

/** The part of a canvas 2D context the area labels use (free of DOM types, so the node tests can draw with a recording one). */
export interface LabelContext {
  globalAlpha: number;
  fillStyle: string | object;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  save(): void;
  restore(): void;
}

/**
 * Render the centroid label for each Area, ABOVE characters/bubbles. Centroid
 * = arithmetic mean of all tile centers belonging to a given label. Pixel-art
 * drop shadow (no blur) for legibility on light backgrounds.
 *
 */
export function drawAreaLabels(
  ctx: LabelContext,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  hiddenLabels?: ReadonlySet<string>,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  if (!areas || areas.length === 0) return;

  const s = TILE_SIZE * zoom;
  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);

  // Centroid accumulator: label → { sumX, sumY, count }.
  const centroids = new Map<string, { sumX: number; sumY: number; count: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      if (hiddenLabels?.has(label)) continue; // Aero draws these itself (live pod names)
      const acc = centroids.get(label);
      if (acc) {
        acc.sumX += c;
        acc.sumY += r;
        acc.count += 1;
      } else {
        centroids.set(label, { sumX: c, sumY: r, count: 1 });
      }
    }
  }

  if (centroids.size === 0) return;

  const fontSize = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);

  ctx.save();
  ctx.font = `bold ${fontSize}px 'FS Pixel Sans'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [label, acc] of centroids) {
    const cx = offsetX + (acc.sumX / acc.count + 0.5) * s;
    const cy = offsetY + (acc.sumY / acc.count + 0.5) * s;

    // Pixel-art drop shadow (1px right + down, no blur).
    ctx.globalAlpha = AREA_LABEL_SHADOW_ALPHA;
    ctx.fillStyle = AREA_LABEL_SHADOW_COLOR;
    ctx.fillText(label, cx + 1, cy + 1);

    // Main label — area's own color, falling back to white if missing.
    ctx.globalAlpha = AREA_LABEL_ALPHA;
    ctx.fillStyle = colorMap.get(label) ?? AREA_LABEL_FALLBACK_COLOR;
    ctx.fillText(label, cx, cy);
  }
  ctx.restore();
}
