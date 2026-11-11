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
  AERO_CAPSULE_BRASS,
  AERO_CAPSULE_GATE,
  AERO_CAPSULE_GLASS,
  AERO_NAME_SHADOW,
  AERO_NAME_TEXT,
  AERO_PLATE_BORDER,
  AERO_PLATE_FILL,
  AERO_PLATE_TEXT,
} from '../constants.js';
import { sittingOffsetPx } from '../office/engine/characters.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { Character } from '../office/types.js';
import { TILE_SIZE } from '../office/types.js';
import { drawEffects, prefersReducedMotion } from './effects.js';
import { fitCached } from './fit.js';
import { drawFloorSign } from './floorSign.js';
import { clockPlateRect, whiteboardRect } from './lounge.js';
import type { NameLabel } from './office.js';
import { drawPods } from './pods.js';
import { badgeText, clip } from './update.js';

const FONT = "'FS Pixel Sans', monospace";
const PROTON_NAME = 'Proton';
/** The name's baseline over her feet: her 16 px sprite and one pixel. */
const PROTON_NAME_RISE = 17;
const SPRITE_H = 24;

/** The top-centre of a character's sprite, in world pixels. */
export function spriteTop(ch: Character): { x: number; y: number } {
  return { x: ch.x, y: ch.y + sittingOffsetPx(ch) - SPRITE_H };
}

function fontPx(zoom: number, worldPx: number): number {
  return Math.max(7, Math.round(worldPx * zoom));
}

/** What the tool overlay (the status label panels over the canvas) is showing for: its panel replaces a character's name. */
export interface OverlayShow {
  alwaysShowOverlay: boolean;
  hoveredId: number | null;
  selectedId: number | null;
}

/**
 * The name line over a character, or null when none shows: the character has a label, is not spawning or leaving, and the tool
 * overlay is not showing its panel (only characters in `os.characters` have one; a person or the front desk never does).
 */
function nameFor(
  os: OfficeState,
  labels: ReadonlyMap<number, NameLabel>,
  ch: Character,
  show: OverlayShow | undefined,
): string | null {
  const label = labels.get(ch.id);
  if (!label || ch.matrixEffect) return null;
  if (
    show &&
    os.characters.has(ch.id) &&
    (show.alwaysShowOverlay || show.hoveredId === ch.id || show.selectedId === ch.id)
  ) {
    return null;
  }
  return `${label.first} \u00b7 ${label.role}`;
}

/** How far a bubble over a character with a name line is lifted, in canvas pixels. */
export function nameLineLift(zoom: number): number {
  return fontPx(zoom, 4.5) + 3;
}

/**
 * The lift a bubble over `ch` needs now: one name line when its name is drawn, else none. The tool overlay's bubbles use it too, with
 * the labels it took once for its render (`os.aero.labelMap()`), so both stack above the line.
 */
export function bubbleLift(
  os: OfficeState,
  labels: ReadonlyMap<number, NameLabel>,
  ch: Character,
  zoom: number,
  show: OverlayShow | undefined,
): number {
  return nameFor(os, labels, ch, show) === null || os.aero.hides(ch) ? 0 : nameLineLift(zoom);
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

/** A tower handoff's capsule: 6 by 4 world pixels, brass with a glass window, centred on (x, y) (world pixels). */
function drawCapsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const left = Math.round(offsetX + (x - 3) * zoom);
  const top = Math.round(offsetY + (y - 2) * zoom);
  ctx.fillStyle = AERO_CAPSULE_BRASS;
  ctx.fillRect(left, top, Math.round(6 * zoom), Math.round(4 * zoom));
  ctx.fillStyle = AERO_CAPSULE_GLASS;
  ctx.fillRect(
    left + Math.round(zoom),
    top + Math.round(zoom),
    Math.round(4 * zoom),
    Math.round(2 * zoom),
  );
}

/** A gated handoff's capsule pinned to the whiteboard, with a pulsing amber dot on its corner (drawn only: it takes no click). */
function drawBoardCapsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pulse: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  drawCapsule(ctx, x, y, offsetX, offsetY, zoom);
  ctx.save();
  ctx.globalAlpha = 0.45 + 0.55 * pulse;
  ctx.fillStyle = AERO_CAPSULE_GATE;
  const size = Math.max(2, Math.round(2 * zoom));
  ctx.fillRect(
    Math.round(offsetX + (x + 3) * zoom) - Math.round(size / 2),
    Math.round(offsetY + (y - 2) * zoom) - Math.round(size / 2),
    size,
    size,
  );
  ctx.restore();
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
  show?: OverlayShow,
): void {
  ctx.save();
  const labels = os.aero.labelMap();
  const lift = nameLineLift(zoom);
  // The effects first: the text of the wall objects, the badges and the names stay readable over them.
  drawPods(ctx, os, offsetX, offsetY, zoom);
  drawEffects(ctx, os.aero.fx, offsetX, offsetY, zoom);
  drawWall(ctx, os, offsetX, offsetY, zoom);
  drawFloorSign(ctx, os, offsetX, offsetY, zoom);
  // Gated handoffs: their capsules on the whiteboard, each with a pulsing amber dot (steady under Reduced Motion).
  const pulse = prefersReducedMotion() ? 1 : os.aero.boardPulse();
  for (const c of os.aero.boardCapsules())
    drawBoardCapsule(ctx, c.x, c.y, pulse, offsetX, offsetY, zoom);

  // Tower handoffs: the capsule a lead carries, and those lying on the receivers' desks.
  for (const c of os.aero.carriedCapsules()) drawCapsule(ctx, c.x, c.y, offsetX, offsetY, zoom);
  for (const d of os.aero.deskCapsules()) {
    drawCapsule(
      ctx,
      d.col * TILE_SIZE + TILE_SIZE / 2,
      d.row * TILE_SIZE + TILE_SIZE / 2,
      offsetX,
      offsetY,
      zoom,
    );
  }

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
    const up = nameFor(os, labels, ch, show) === null ? 0 : lift;
    drawBubble(ctx, text, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom - up, zoom);
  }

  // Idle staff on a break: the same bubbles, drawn through the people (staff are not among the office's characters).
  for (const { ch, text } of os.aero.staffBubbles()) {
    const top = spriteTop(ch);
    const up = nameFor(os, labels, ch, show) === null ? 0 : lift;
    drawBubble(ctx, text, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom - up, zoom);
  }

  // Workers: the activity over a subagent or person at its station, the dots over a person waiting for permission.
  for (const { ch, text } of os.aero.workBubbles()) {
    const top = spriteTop(ch);
    const up = nameFor(os, labels, ch, show) === null ? 0 : lift;
    drawBubble(ctx, text, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom - up, zoom);
  }

  // The front desk's greetings.
  for (const npc of os.aero.npcs) {
    const text = os.aero.greetingFor(npc);
    if (!text) continue;
    const top = spriteTop(npc.ch);
    const up = nameFor(os, labels, npc.ch, show) === null ? 0 : lift;
    drawBubble(ctx, text, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom - up, zoom);
  }

  // The name over every character: one line, `Ava \u00b7 Reviewer`.
  const chars = new Map<number, Character>();
  for (const c of os.characters.values()) chars.set(c.id, c);
  for (const person of os.aero.people) chars.set(person.ch.id, person.ch);
  for (const npc of os.aero.npcs) chars.set(npc.ch.id, npc.ch);
  for (const label of labels.values()) {
    const ch = chars.get(label.id);
    if (!ch) continue;
    const name = nameFor(os, labels, ch, show);
    if (name === null) continue;
    const top = spriteTop(ch);
    drawName(ctx, name, offsetX + top.x * zoom, offsetY + (top.y - 1) * zoom, zoom);
  }

  // Proton's name, over her head like the people's: she is not a character and stays out of the labels.
  const cat = os.aero.protonView();
  if (cat)
    drawName(
      ctx,
      PROTON_NAME,
      offsetX + cat.x * zoom,
      offsetY + (cat.y - PROTON_NAME_RISE) * zoom,
      zoom,
    );
  ctx.restore();
}
