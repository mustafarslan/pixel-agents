/**
 * Aero's Lounge, found in a layout by uid.
 *
 * Aero builds the layout, and names every Lounge piece `aero-<8 hex>-lounge-<n>`. Nothing here matches by position or
 * by label: a layout without such uids (the owner's own, or a stock one) has no Lounge, and everything built on this
 * does nothing for it.
 */

export interface Tile {
  col: number;
  row: number;
}

/** A placed piece of furniture with its footprint. */
export interface LoungeItem {
  uid: string;
  type: string;
  col: number;
  row: number;
  w: number;
  h: number;
}

/** A Lounge piece, as Aero's `OfficeLayout` names it. */
export const LOUNGE_ITEM_RE = /^aero-[0-9a-f]{8}-lounge-\d+$/;
/**
 * A Meeting Room piece (the Big office style). Used only to find the whiteboard and the clock when the Lounge has none;
 * the Lounge's label vote, seats, table and floor never see these.
 */
export const MEETING_ITEM_RE = /^aero-[0-9a-f]{8}-meeting-\d+$/;
/** A seat of one: the chair's uid, or `<uid>:<n>` for the 2nd tile on. */
export const LOUNGE_SEAT_RE = /^aero-[0-9a-f]{8}-lounge-\d+(?::\d+)?$/;

export interface Lounge {
  /** Floor tiles of the Lounge room (the room's area label), seats' tiles included, sorted row by row. */
  floor: Tile[];
  /** Seat uids that are Lounge seats. */
  seats: string[];
  /** The table's footprint tiles, if the Lounge has a table. */
  table: Tile[];
  whiteboard: LoungeItem | null;
  clock: LoungeItem | null;
}

export const isMeetingItemUid = (uid: string): boolean => MEETING_ITEM_RE.test(uid);
export const isLoungeItemUid = (uid: string): boolean => LOUNGE_ITEM_RE.test(uid);
export const isLoungeSeatUid = (uid: string): boolean => LOUNGE_SEAT_RE.test(uid);

const key = (col: number, row: number): string => `${col},${row}`;

/**
 * The Lounge in a layout, or null when it has none.
 *
 * @param items the layout's furniture with footprints (only pieces whose uid names the Lounge are used)
 * @param seats uids and tiles of every seat in the office
 * @param areaTiles per-tile area labels, row-major (`cols` wide), as `OfficeLayout.areaTiles`
 */
export function findLounge(
  items: readonly LoungeItem[],
  seats: ReadonlyMap<string, { seatCol: number; seatRow: number }>,
  areaTiles: ReadonlyArray<string | null> | undefined,
  cols: number,
  rows: number,
): Lounge | null {
  const mine = items.filter((item) => isLoungeItemUid(item.uid));
  if (mine.length === 0 || !areaTiles || cols <= 0 || rows <= 0) return null;

  // The Lounge room's label: the one its pieces stand in, most often.
  const votes = new Map<string, number>();
  for (const item of mine) {
    for (let r = item.row; r < item.row + item.h; r++) {
      for (let c = item.col; c < item.col + item.w; c++) {
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const label = areaTiles[r * cols + c];
        if (typeof label === 'string' && label.length > 0) {
          votes.set(label, (votes.get(label) ?? 0) + 1);
        }
      }
    }
  }
  let label: string | null = null;
  let best = 0;
  for (const [candidate, count] of votes) {
    if (count > best) {
      best = count;
      label = candidate;
    }
  }
  if (label === null) return null;

  const loungeSeats: string[] = [];
  const floorKeys = new Set<string>();
  const floor: Tile[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (areaTiles[r * cols + c] === label) {
        floorKeys.add(key(c, r));
        floor.push({ col: c, row: r });
      }
    }
  }
  for (const [uid, seat] of seats) {
    if (!isLoungeSeatUid(uid)) continue;
    loungeSeats.push(uid);
    if (!floorKeys.has(key(seat.seatCol, seat.seatRow))) {
      floorKeys.add(key(seat.seatCol, seat.seatRow));
      floor.push({ col: seat.seatCol, row: seat.seatRow });
    }
  }
  floor.sort((a, b) => a.row - b.row || a.col - b.col);
  loungeSeats.sort();

  const table: Tile[] = [];
  for (const item of mine) {
    if (!item.type.includes('TABLE')) continue;
    for (let r = item.row; r < item.row + item.h; r++) {
      for (let c = item.col; c < item.col + item.w; c++) table.push({ col: c, row: r });
    }
  }
  // The Big office keeps them in the Meeting Room; the Rooms style keeps them in the Lounge, which wins.
  const meeting = items.filter((item) => isMeetingItemUid(item.uid));
  const whiteboard =
    mine.find((item) => item.type === 'WHITEBOARD') ??
    meeting.find((item) => item.type === 'WHITEBOARD') ??
    null;
  const clock =
    mine.find((item) => item.type === 'CLOCK') ??
    meeting.find((item) => item.type === 'CLOCK') ??
    null;
  return { floor, seats: loungeSeats, table, whiteboard, clock };
}

/** The Lounge tiles beside the table (4-neighbours of its footprint), nearest to the table's left first. */
export function tableSpots(lounge: Lounge): Tile[] {
  if (lounge.table.length === 0) return [];
  const onTable = new Set(lounge.table.map((t) => key(t.col, t.row)));
  const onFloor = new Set(lounge.floor.map((t) => key(t.col, t.row)));
  const spots: Tile[] = [];
  const seen = new Set<string>();
  for (const t of lounge.table) {
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const c = t.col + dc;
      const r = t.row + dr;
      const k = key(c, r);
      if (onTable.has(k) || seen.has(k) || !onFloor.has(k)) continue;
      seen.add(k);
      spots.push({ col: c, row: r });
    }
  }
  return spots.sort((a, b) => a.col - b.col || a.row - b.row);
}

/** World-pixel rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TILE = 16;

/** The whiteboard's face. */
export function whiteboardRect(item: LoungeItem): Rect {
  return { x: item.col * TILE, y: item.row * TILE, w: item.w * TILE, h: item.h * TILE };
}

/** The clock's plate: the clock's own tile column, 64 world pixels wide, just below the clock. */
export const CLOCK_PLATE_W = 64;
export const CLOCK_PLATE_H = 10;
export function clockPlateRect(item: LoungeItem): Rect {
  const cx = (item.col + item.w / 2) * TILE;
  return {
    x: cx - CLOCK_PLATE_W / 2,
    y: (item.row + item.h) * TILE,
    w: CLOCK_PLATE_W,
    h: CLOCK_PLATE_H,
  };
}

const inside = (rect: Rect, x: number, y: number): boolean =>
  x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

export type WallHit = 'openInbox' | 'openCalendar';

/** Which wall object a click at world point (x, y) lands on. The clock counts with its plate. */
export function wallHit(lounge: Lounge | null, x: number, y: number): WallHit | null {
  if (!lounge) return null;
  if (lounge.whiteboard && inside(whiteboardRect(lounge.whiteboard), x, y)) return 'openInbox';
  if (lounge.clock) {
    const body = {
      x: lounge.clock.col * TILE,
      y: lounge.clock.row * TILE,
      w: lounge.clock.w * TILE,
      h: lounge.clock.h * TILE,
    };
    if (inside(body, x, y) || inside(clockPlateRect(lounge.clock), x, y)) return 'openCalendar';
  }
  return null;
}
