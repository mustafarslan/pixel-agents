/**
 * Aero's Lounge is found by uid (`aero-<8 hex>-lounge-<n>`), never by position: a layout without those uids has none,
 * and a wall click counts only for a Lounge WHITEBOARD or CLOCK.
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  clockPlateRect,
  findLounge,
  isLoungeItemUid,
  isLoungeSeatUid,
  type LoungeItem,
  tableSpots,
  wallHit,
  whiteboardRect,
} from '../src/aero/lounge.js';

const COLS = 12;
const ROWS = 8;
/** Columns 6..11 and rows 2..6 are the Lounge room; 1..4 are another room. */
function areas(): Array<string | null> {
  const out: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 6; r++) {
    for (let c = 1; c <= 4; c++) out[r * COLS + c] = 'Work';
    for (let c = 6; c <= 11; c++) out[r * COLS + c] = 'Lounge';
  }
  return out;
}

const item = (uid: string, type: string, col: number, row: number, w = 1, h = 1): LoungeItem => ({
  uid,
  type,
  col,
  row,
  w,
  h,
});

const ITEMS: LoungeItem[] = [
  item('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 6, 0, 2, 2),
  item('aero-0a1b2c3d-lounge-1', 'CLOCK', 8, 0, 1, 2),
  item('aero-0a1b2c3d-lounge-2', 'SOFA_FRONT', 7, 2),
  item('aero-0a1b2c3d-lounge-3', 'COFFEE_TABLE', 7, 3, 2, 2),
  item('aero-0a1b2c3d-main-0', 'WHITEBOARD', 1, 0, 2, 2),
  item('plain-uid', 'CLOCK', 2, 0, 1, 2),
];
const SEATS = new Map([
  ['aero-0a1b2c3d-lounge-2', { seatCol: 7, seatRow: 2 }],
  ['aero-0a1b2c3d-lounge-5:1', { seatCol: 10, seatRow: 3 }],
  ['aero-0a1b2c3d-main-1', { seatCol: 2, seatRow: 3 }],
]);

test('the uid shapes: Lounge pieces and their seats', () => {
  for (const uid of ['aero-0a1b2c3d-lounge-0', 'aero-ffffffff-lounge-12']) {
    assert.ok(isLoungeItemUid(uid), uid);
    assert.ok(isLoungeSeatUid(uid), uid);
  }
  assert.ok(isLoungeSeatUid('aero-0a1b2c3d-lounge-5:1'));
  assert.ok(!isLoungeItemUid('aero-0a1b2c3d-lounge-5:1'));
  for (const uid of [
    '',
    'lounge-1',
    'aero-0a1b2c3d-main-1',
    'aero-0A1B2C3D-lounge-1',
    'aero-0a1b2c3-lounge-1',
    'aero-0a1b2c3d-lounge-',
    'aero-0a1b2c3d-lounge-x',
    'xaero-0a1b2c3d-lounge-1',
    'aero-0a1b2c3d-lounge-1x',
    'aero-0a1b2c3d-lounge-1\n',
    'aero-0a1b2c3d-prruns-1',
  ]) {
    assert.ok(!isLoungeSeatUid(uid), JSON.stringify(uid));
    assert.ok(!isLoungeItemUid(uid), JSON.stringify(uid));
  }
});

test('the Lounge is the room its pieces stand in, with its seats, table and wall objects', () => {
  const lounge = findLounge(ITEMS, SEATS, areas(), COLS, ROWS);
  assert.ok(lounge);
  assert.equal(lounge.floor.length, 5 * 6);
  assert.ok(lounge.floor.every((t) => t.col >= 6 && t.row >= 2 && t.row <= 6));
  assert.deepEqual(lounge.seats, ['aero-0a1b2c3d-lounge-2', 'aero-0a1b2c3d-lounge-5:1']);
  assert.equal(lounge.table.length, 4);
  assert.equal(lounge.whiteboard?.uid, 'aero-0a1b2c3d-lounge-0');
  assert.equal(lounge.clock?.uid, 'aero-0a1b2c3d-lounge-1');
});

test('a layout without Lounge uids has no Lounge', () => {
  const stock = ITEMS.filter((i) => !i.uid.includes('lounge'));
  assert.equal(findLounge(stock, SEATS, areas(), COLS, ROWS), null);
  assert.equal(findLounge(ITEMS, SEATS, undefined, COLS, ROWS), null);
  assert.equal(findLounge(ITEMS, SEATS, new Array(COLS * ROWS).fill(null), COLS, ROWS), null);
});

test('a lookalike whiteboard or clock outside the Lounge is not a wall object', () => {
  const lounge = findLounge(ITEMS, SEATS, areas(), COLS, ROWS)!;
  // The plain-uid clock at col 2 and the other room's whiteboard at col 1.
  assert.equal(wallHit(lounge, 2.5 * 16, 16), null);
  assert.equal(wallHit(lounge, 1.5 * 16, 16), null);
});

test('table spots are the Lounge tiles beside the table', () => {
  const lounge = findLounge(ITEMS, SEATS, areas(), COLS, ROWS)!;
  const spots = tableSpots(lounge).map((t) => `${t.col},${t.row}`);
  // The table fills (7..8, 3..4): 8 neighbours around it, all in the room.
  assert.deepEqual(
    [...spots].sort(),
    ['6,3', '6,4', '7,2', '7,5', '8,2', '8,5', '9,3', '9,4'].sort(),
  );
  assert.deepEqual(tableSpots({ ...lounge, table: [] }), []);
});

test('wall clicks: the whiteboard opens the inbox, the clock and its plate the calendar', () => {
  const lounge = findLounge(ITEMS, SEATS, areas(), COLS, ROWS)!;
  const board = whiteboardRect(lounge.whiteboard!);
  assert.equal(wallHit(lounge, board.x + 1, board.y + 1), 'openInbox');
  assert.equal(wallHit(lounge, board.x + board.w - 1, board.y + board.h - 1), 'openInbox');
  assert.equal(wallHit(lounge, board.x - 1, board.y), null);
  assert.equal(wallHit(lounge, board.x, board.y + board.h), null);
  const plate = clockPlateRect(lounge.clock!);
  assert.equal(wallHit(lounge, plate.x + 2, plate.y + 2), 'openCalendar');
  assert.equal(wallHit(lounge, 8.5 * 16, 8), 'openCalendar');
  assert.equal(wallHit(lounge, plate.x - 1, plate.y + 2), null);
  assert.equal(wallHit(lounge, plate.x + 2, plate.y + plate.h), null);
  assert.equal(wallHit(null, board.x + 1, board.y + 1), null);
  assert.equal(wallHit(lounge, 0, 0), null);
});

/** The Big office: the Lounge has no wall pieces, the Meeting Room has the whiteboard and the clock. */
const BIG_ITEMS: LoungeItem[] = [
  item('aero-0a1b2c3d-lounge-2', 'SOFA_FRONT', 7, 2),
  item('aero-0a1b2c3d-lounge-3', 'COFFEE_TABLE', 7, 3, 2, 2),
  item('aero-0a1b2c3d-meeting-0', 'WHITEBOARD', 1, 0, 2, 2),
  item('aero-0a1b2c3d-meeting-1', 'CLOCK', 3, 0, 1, 2),
  item('aero-0a1b2c3d-meeting-2', 'TABLE_FRONT', 1, 3, 3, 2),
  item('aero-0a1b2c3d-meeting-3', 'WOODEN_CHAIR_SIDE', 1, 5),
];
const BIG_SEATS = new Map([
  ['aero-0a1b2c3d-lounge-2', { seatCol: 7, seatRow: 2 }],
  ['aero-0a1b2c3d-meeting-3', { seatCol: 1, seatRow: 5 }],
]);

test('Big style: the whiteboard and the clock come from the Meeting Room, and wall clicks work', () => {
  const lounge = findLounge(BIG_ITEMS, BIG_SEATS, areas(), COLS, ROWS);
  assert.ok(lounge);
  assert.equal(lounge.whiteboard?.uid, 'aero-0a1b2c3d-meeting-0');
  assert.equal(lounge.clock?.uid, 'aero-0a1b2c3d-meeting-1');
  const board = whiteboardRect(lounge.whiteboard!);
  assert.equal(wallHit(lounge, board.x + 1, board.y + 1), 'openInbox');
  assert.equal(wallHit(lounge, 3.5 * 16, 8), 'openCalendar');
});

test('Big style: meeting chairs and tables never become Lounge seats, table or floor', () => {
  const lounge = findLounge(BIG_ITEMS, BIG_SEATS, areas(), COLS, ROWS)!;
  assert.deepEqual(lounge.seats, ['aero-0a1b2c3d-lounge-2']);
  assert.equal(lounge.table.length, 4);
  assert.ok(lounge.table.every((t) => t.col >= 7 && t.col <= 8));
  assert.equal(lounge.floor.length, 5 * 6);
  assert.ok(!lounge.floor.some((t) => t.col === 1 && t.row === 5));
  assert.ok(!isLoungeItemUid('aero-0a1b2c3d-meeting-0'));
  assert.ok(!isLoungeSeatUid('aero-0a1b2c3d-meeting-3'));
});

test('meeting pieces do not outvote the Lounge label, and without Lounge pieces there is no Lounge', () => {
  const heavy = [...BIG_ITEMS, item('aero-0a1b2c3d-meeting-4', 'TABLE_FRONT', 1, 2, 4, 4)];
  const lounge = findLounge(heavy, BIG_SEATS, areas(), COLS, ROWS)!;
  assert.equal(lounge.floor.length, 5 * 6);
  assert.ok(lounge.floor.every((t) => t.col >= 6));
  assert.equal(
    findLounge(
      BIG_ITEMS.filter((i) => i.uid.includes('meeting')),
      BIG_SEATS,
      areas(),
      COLS,
      ROWS,
    ),
    null,
  );
});

test('the Lounge wins when it has its own whiteboard (Rooms style, with a meeting lookalike)', () => {
  const both = [
    ...ITEMS,
    item('aero-0a1b2c3d-meeting-0', 'WHITEBOARD', 1, 0, 2, 2),
    item('aero-0a1b2c3d-meeting-1', 'CLOCK', 3, 0, 1, 2),
  ];
  const lounge = findLounge(both, SEATS, areas(), COLS, ROWS)!;
  assert.equal(lounge.whiteboard?.uid, 'aero-0a1b2c3d-lounge-0');
  assert.equal(lounge.clock?.uid, 'aero-0a1b2c3d-lounge-1');
});
