/**
 * The floor sign: `2F · web` on the open office's lift wall. Kept free of DOM types so the node tests can run it with a
 * recording context.
 */
import { AERO_PLATE_BORDER, AERO_PLATE_FILL, AERO_PLATE_TEXT } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { clip } from './update.js';

const FONT = "'FS Pixel Sans', monospace";

/** The open office's size in tiles: the floor sign is drawn on its lift wall only. */
const OPEN_COLS = 54;
const OPEN_ROWS = 36;
/** The two lifts stand at columns 25..28 on rows 34..35. */
const SIGN_COL = 25;
const SIGN_ROW = 34;
const SIGN_TILES_W = 4;
const SIGN_H = 10;
const SIGN_NAME_CHARS = 18;

/** The part of a canvas 2D context the floor sign uses. */
export interface FloorSignContext {
  fillStyle: string | object;
  font: string;
  textAlign: string;
  textBaseline: string;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** The floor sign's plate, in world pixels: across the top of both lifts, centred between their doors. */
export function floorSignRect(): { x: number; y: number; w: number; h: number } {
  return { x: SIGN_COL * 16, y: SIGN_ROW * 16 + 1, w: SIGN_TILES_W * 16, h: SIGN_H };
}

/**
 * The floor sign (`2F · web`) over the lifts of the open office, while the update names a floor. Text only, drawn with
 * `fillText`: the repo's name is never parsed as markup.
 */
export function drawFloorSign(
  ctx: FloorSignContext,
  os: OfficeState,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const floor = os.aero.currentUpdate()?.floor;
  const layout = os.layout;
  if (!floor || layout.cols !== OPEN_COLS || layout.rows !== OPEN_ROWS) return;
  const r = floorSignRect();
  const x = offsetX + r.x * zoom;
  const y = offsetY + r.y * zoom;
  const w = r.w * zoom;
  const h = r.h * zoom;
  ctx.fillStyle = AERO_PLATE_BORDER;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, Math.round(h) + 2);
  ctx.fillStyle = AERO_PLATE_FILL;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  ctx.font = `bold ${Math.max(7, Math.round(5 * zoom))}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AERO_PLATE_TEXT;
  ctx.fillText(`${floor.number}F · ${clip(floor.name, SIGN_NAME_CHARS)}`, x + w / 2, y + h / 2 + 1);
}
