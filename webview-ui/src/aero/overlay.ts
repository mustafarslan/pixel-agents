/**
 * What Aero draws over the office canvas, after the stock frame: subagent badges, the configured characters' names,
 * bubbles, and the text on the Lounge's whiteboard and clock.
 *
 * Everything is drawn with `fillText` and `fillRect`; a name or a meeting title is never parsed as markup. The canvas is
 * in device pixels: a world point (x, y) is at (offsetX + x * zoom, offsetY + y * zoom).
 */
import {
  AERO_BADGE_FILL,
  AERO_BADGE_TEXT,
  AERO_BOARD_ALERT,
  AERO_BOARD_INK,
  AERO_BUBBLE_BORDER,
  AERO_BUBBLE_FILL,
  AERO_BUBBLE_TEXT,
  AERO_NAME_SHADOW,
  AERO_NAME_TEXT,
  AERO_PLATE_BORDER,
  AERO_PLATE_FILL,
  AERO_PLATE_TEXT,
  CHARACTER_SITTING_OFFSET_PX,
} from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { Character } from '../office/types.js';
import { CharacterState } from '../office/types.js';
import { drawEffects } from './effects.js';
import { fitCached } from './fit.js';
import { drawFloorSign } from './floorSign.js';
import { clockPlateRect, whiteboardRect } from './lounge.js';
import { drawPods } from './pods.js';
import { badgeText, clip } from './update.js';

const FONT = "'FS Pixel Sans', monospace";
const SPRITE_H = 24;

/** The top-centre of a character's sprite, in world pixels. */
export function spriteTop(ch: Character): { x: number; y: number } {
  const sit = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
  return { x: ch.x, y: ch.y + sit - SPRITE_H };
}

function fontPx(zoom: number, worldPx: number): number {
  return Math.max(7, Math.round(worldPx * zoom));
}

function plate(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
): void {
  ctx.fillStyle = stroke;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, Math.round(h) + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  bottom: number,
  zoom: number,
): void {
  const size = fontPx(zoom, 5);
  ctx.font = `${size}px ${FONT}`;
  const pad = Math.round(size * 0.5);
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = size + pad * 2;
  plate(ctx, cx - w / 2, bottom - h, w, h, AERO_BUBBLE_FILL, AERO_BUBBLE_BORDER);
  ctx.fillStyle = AERO_BUBBLE_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, bottom - h / 2 + 1);
}

function drawBadge(
  ctx: CanvasRenderingContext2D,
  count: number,
  cx: number,
  cy: number,
  zoom: number,
): void {
  const size = fontPx(zoom, 5);
  ctx.font = `bold ${size}px ${FONT}`;
  const text = badgeText(count);
  const w = Math.max(size + 2, Math.ceil(ctx.measureText(text).width) + 6);
  const h = size + 4;
  plate(ctx, cx - w / 2, cy - h / 2, w, h, AERO_BADGE_FILL, AERO_BADGE_TEXT);
  ctx.fillStyle = AERO_BADGE_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
}

function drawName(
  ctx: CanvasRenderingContext2D,
  name: string,
  cx: number,
  bottom: number,
  zoom: number,
): void {
  const size = fontPx(zoom, 4.5);
  ctx.font = `bold ${size}px ${FONT}`;
  const text = clip(name, 40);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = AERO_NAME_SHADOW;
  ctx.fillText(text, cx + 1, bottom + 1);
  ctx.fillStyle = AERO_NAME_TEXT;
  ctx.fillText(text, cx, bottom);
}

/** The whiteboard's and the clock's text. */
function drawWall(
  ctx: CanvasRenderingContext2D,
  os: OfficeState,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const lounge = os.aero.lounge;
  const update = os.aero.currentUpdate();
  if (!lounge || !update || !update.lounge) return;
  if (lounge.whiteboard) {
    const r = whiteboardRect(lounge.whiteboard);
    const cx = offsetX + (r.x + r.w / 2) * zoom;
    ctx.textAlign = 'center';
    ctx.fillStyle = AERO_BOARD_INK;
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fontPx(zoom, 4)}px ${FONT}`;
    ctx.fillText('INBOX', cx, offsetY + (r.y + r.h * 0.38) * zoom);
    ctx.font = `bold ${fontPx(zoom, 10)}px ${FONT}`;
    ctx.fillStyle = update.inbox > 0 ? AERO_BOARD_ALERT : AERO_BOARD_INK;
    ctx.fillText(
      update.inbox > 99 ? '99+' : String(update.inbox),
      cx,
      offsetY + (r.y + r.h * 0.82) * zoom,
    );
  }
  if (lounge.clock) {
    const r = clockPlateRect(lounge.clock);
    plate(
      ctx,
      offsetX + r.x * zoom,
      offsetY + r.y * zoom,
      r.w * zoom,
      r.h * zoom,
      AERO_PLATE_FILL,
      AERO_PLATE_BORDER,
    );
    const size = fontPx(zoom, 5);
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = AERO_PLATE_TEXT;
    const meeting = update.meeting;
    const text = meeting
      ? fitCached(
          `${meeting.time} ${meeting.title}`,
          r.w * zoom - 4,
          zoom,
          (t) => ctx.measureText(t).width,
        )
      : 'no meeting';
    ctx.fillText(text, offsetX + (r.x + r.w / 2) * zoom, offsetY + (r.y + r.h / 2) * zoom + 1);
  }
}

export function drawAeroOverlay(
  ctx: CanvasRenderingContext2D,
  os: OfficeState,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  ctx.save();
  // The effects first: the text of the wall objects, the badges and the names stay readable over them.
  drawPods(ctx, os, offsetX, offsetY, zoom);
  drawEffects(ctx, os.aero.fx, offsetX, offsetY, zoom);
  drawWall(ctx, os, offsetX, offsetY, zoom);
  drawFloorSign(ctx, os, offsetX, offsetY, zoom);

  // Badges: the live subagents of each lead, also when it isn't hovered.
  for (const [parentId, count] of os.aero.badgeCounts()) {
    const lead = os.characters.get(parentId);
    if (!lead || lead.isSubagent || lead.matrixEffect === 'despawn' || count <= 0) continue;
    if (os.aero.hides(lead)) continue;
    const top = spriteTop(lead);
    drawBadge(ctx, count, offsetX + (top.x + 7) * zoom, offsetY + (top.y + 3) * zoom, zoom);
  }

  // Bubbles: a lunch bubble or a line of chat above a lead in the Lounge.
  for (const route of os.aero.routes.keys()) {
    const text = os.aero.bubbleFor(route);
    const ch = os.characters.get(route);
    if (!text || !ch || os.aero.hides(ch)) continue;
    const top = spriteTop(ch);
    drawBubble(ctx, text, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom, zoom);
  }

  // The configured characters' names.
  for (const person of os.aero.people) {
    if (person.ch.matrixEffect || !os.aero.roomOnFloor(person.room)) continue;
    const top = spriteTop(person.ch);
    drawName(ctx, person.name, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom, zoom);
  }
  ctx.restore();
}
