/**
 * The stations a subagent can borrow outside its lead's pod PC benches: the focus seats, the hot-desk benches, the library's and the
 * meeting room's seats, the fronts of the hot-desk and library bookshelves, and the front tiles of a pod's whiteboard and water cooler.
 * Found in the layout by furniture type and area label, once per layout (`AeroOffice.refresh`); whether one is free is asked when it is
 * wanted. Aero's layout puts every one of them at the same place for any worktrees.
 *
 * The same pass finds the open office's break targets (`BreakBook`): the coffee machine, the vending machines, the ashtray stands and
 * the buffet counter by their fronts, and the café's bar stools and dining chairs and the terrace benches as seats.
 */
import type { OfficeState } from '../office/engine/officeState.js';
import { getCatalogEntry } from '../office/layout/furnitureCatalog.js';
import { Direction } from '../office/types.js';

export type StationGroup =
  'pc' | 'cooler' | 'whiteboard' | 'focus' | 'hot' | 'library' | 'meeting' | 'shelf';

export interface Station {
  group: StationGroup;
  /** The seat's uid, or `col,row` of the tile a prop is stood at. */
  key: string;
  /** The seat's uid, or null for a prop. */
  seat: string | null;
  col: number;
  row: number;
  /** Which way it faces there: the seat's, or up toward a prop. */
  dir: Direction;
}

/** A tile a break is taken at: a prop's front (`seat` null, facing up toward it) or a seat. */
export interface BreakSpot {
  key: string;
  seat: string | null;
  col: number;
  row: number;
  dir: Direction;
  /** The area label of the prop or the seat. */
  zone: string | null;
}

export interface BreakBook {
  coffee: BreakSpot[];
  vending: BreakSpot[];
  ashtrays: BreakSpot[];
  buffet: BreakSpot[];
  /** The café's bar stools, its dining chairs, and the terrace's benches. */
  bar: BreakSpot[];
  dining: BreakSpot[];
  terrace: BreakSpot[];
}

export interface StationBook {
  /** Focus, hot-desk, library and meeting seats. */
  seats: Station[];
  shelves: Station[];
  /** A pod's whiteboard front and its water cooler front, with the pod's area label. */
  boards: Array<Station & { zone: string }>;
  coolers: Array<Station & { zone: string }>;
  breaks: BreakBook;
}

const SEAT_ZONES: Record<string, StationGroup> = {
  Focus: 'focus',
  'Hot desks': 'hot',
  Library: 'library',
  Meeting: 'meeting',
};
const SHELF_TYPES = new Set(['BOOKSHELF', 'DOUBLE_BOOKSHELF']);
const SHELF_ZONES = new Set(['Hot desks', 'Library']);
const BOARD_TYPE = 'AERO_POD_WHITEBOARD';
const COOLER_TYPE = 'AERO_WATERCOOLER';
const COFFEE_TYPE = 'AERO_COFFEE_MACHINE';
const VENDING_TYPE = 'AERO_VENDING_MACHINE';
const ASHTRAY_TYPE = 'AERO_ASHTRAY_STAND';
const BUFFET_TYPE = 'AERO_BUFFET_COUNTER';
const CAFE_ZONE = 'Café';
const TERRACE_ZONE = 'Terrace';

const tileKey = (col: number, row: number): string => `${col},${row}`;

export function buildStations(os: OfficeState): StationBook {
  const { layout } = os;
  const types = new Map<string, string>();
  for (const f of layout.furniture) types.set(f.uid, f.type);
  const zoneAt = (col: number, row: number): string | null => {
    const tiles = layout.areaTiles;
    if (!tiles || col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null;
    return tiles[row * layout.cols + col] ?? null;
  };
  const walkable = new Set<string>();
  for (const t of os.walkableTiles) walkable.add(tileKey(t.col, t.row));
  const open = (col: number, row: number): boolean =>
    walkable.has(tileKey(col, row)) && !os.blockedTiles.has(tileKey(col, row));
  const book: StationBook = {
    seats: [],
    shelves: [],
    boards: [],
    coolers: [],
    breaks: { coffee: [], vending: [], ashtrays: [], buffet: [], bar: [], dining: [], terrace: [] },
  };

  for (const [uid, seat] of os.seats) {
    const zone = zoneAt(seat.seatCol, seat.seatRow);
    // The break seats, by the piece's type and the room it stands in: a bench at the bar or on the terrace, a chair at a table.
    const baseType = types.get(uid.replace(/:\d+$/, ''));
    const spot: BreakSpot = {
      key: uid,
      seat: uid,
      col: seat.seatCol,
      row: seat.seatRow,
      dir: seat.facingDir,
      zone,
    };
    if (zone === CAFE_ZONE && baseType === 'WOODEN_BENCH') book.breaks.bar.push(spot);
    else if (zone === CAFE_ZONE && baseType?.startsWith('WOODEN_CHAIR') === true)
      book.breaks.dining.push(spot);
    else if (zone === TERRACE_ZONE && baseType === 'WOODEN_BENCH') book.breaks.terrace.push(spot);
    const group = zone === null ? undefined : SEAT_ZONES[zone];
    if (!group) continue;
    // The hot desks' benches only; the other zones' seats are all chairs and sofas.
    if (group === 'hot' && types.get(uid.replace(/:\d+$/, '')) !== 'WOODEN_BENCH') continue;
    book.seats.push({
      group,
      key: uid,
      seat: uid,
      col: seat.seatCol,
      row: seat.seatRow,
      dir: seat.facingDir,
    });
  }

  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type);
    const w = entry?.footprintW ?? 1;
    const h = entry?.footprintH ?? 1;
    const zone = zoneAt(f.col, f.row);
    const fronts = Array.from({ length: w }, (_, i) => ({ col: f.col + i, row: f.row + h })).filter(
      (t) => open(t.col, t.row),
    );
    const prop = (group: StationGroup, t: { col: number; row: number }): Station => ({
      group,
      key: tileKey(t.col, t.row),
      seat: null,
      col: t.col,
      row: t.row,
      dir: Direction.UP,
    });
    const front = (): BreakSpot[] =>
      fronts.map((t) => ({
        key: tileKey(t.col, t.row),
        seat: null,
        col: t.col,
        row: t.row,
        dir: Direction.UP,
        zone,
      }));
    if (f.type === COFFEE_TYPE) book.breaks.coffee.push(...front());
    else if (f.type === VENDING_TYPE) book.breaks.vending.push(...front());
    else if (f.type === ASHTRAY_TYPE) book.breaks.ashtrays.push(...front());
    else if (f.type === BUFFET_TYPE) book.breaks.buffet.push(...front());
    if (SHELF_TYPES.has(f.type) && zone !== null && SHELF_ZONES.has(zone)) {
      for (const t of fronts) book.shelves.push(prop('shelf', t));
    } else if (f.type === BOARD_TYPE && zone !== null && fronts.length > 0) {
      book.boards.push({ ...prop('whiteboard', fronts[0]), zone });
    } else if (f.type === COOLER_TYPE && zone !== null && fronts.length > 0) {
      book.coolers.push({ ...prop('cooler', fronts[0]), zone });
    }
  }
  return book;
}
