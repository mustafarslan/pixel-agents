/**
 * Tower handoffs in the office (docs/work/phase6-handoff/plan.md, the fork): the sender's lead walks a capsule to the receiver's
 * pod, or posts it into the tube; with no sender the receiver collects it. At most two walk at once, eight wait, a `seq` is walked
 * once, and a capsule stays on a desk while its `seq` is listed.
 *
 * `buildWorld` is a 54x36 office with three pods (Pod 1 at (1,2), Pod 2 at (10,2), Pod 3 at (28,2)), each with a lead bench at
 * (ox+3,oy+2) and wooden benches at (ox+1,oy+2) and (ox+5,oy+2), the tube at (20,8) (front tile (20,10)) and the Lounge.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { aeroFurnitureCatalog } from '../src/aero/furniture.js';
import {
  deskTile,
  HANDOFF_PAUSE_SEC,
  HandoffBook,
  MAX_ACTIVE_HANDOFFS,
  MAX_QUEUED_HANDOFFS,
  planHandoff,
  podOriginMap,
  podOriginOf,
  receiverStop,
} from '../src/aero/handoff.js';
import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { buildAeroSprites } from '../src/office/sprites/aeroFurniture.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  MATRIX_EFFECT_DURATION,
  TileType,
} from '../src/office/types.js';

afterEach(() => {
  resetAeroUpdate();
});

const COLS = 54;
const ROWS = 36;
const FLOOR = 'ffffffffffff';
const OTHER_FLOOR = 'eeeeeeeeeeee';
const ROOMS = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'];
const [RA, RB, RC] = ROOMS;
const ORIGINS = [
  { col: 1, row: 2 },
  { col: 10, row: 2 },
  { col: 28, row: 2 },
];
const LEAD_SEATS = ['lead-1', 'lead-2', 'lead-3'];
const LOUNGE_SOFAS = ['aero-0a1b2c3d-lounge-2', 'aero-0a1b2c3d-lounge-3', 'aero-0a1b2c3d-lounge-4'];
const FRONT = { col: 20, row: 10 };

let catalogReady = false;
function loadCatalog(): void {
  if (catalogReady) return;
  const sprite = (color: string) =>
    Array.from({ length: 32 }, () => new Array<string>(16).fill(color));
  const entry = (
    id: string,
    category: string,
    w: number,
    h: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    label: id,
    category,
    width: 16 * w,
    height: 16 * h,
    footprintW: w,
    footprintH: h,
    isDesk: false,
    canPlaceOnWalls: false,
    ...extra,
  });
  const stock = [
    entry('CUSHIONED_BENCH', 'chairs', 1, 1),
    entry('WOODEN_BENCH', 'chairs', 1, 1),
    entry('SOFA_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('SOFA_SIDE', 'chairs', 1, 1, { orientation: 'side' }),
    entry('COFFEE_TABLE', 'furniture', 2, 2),
    entry('WHITEBOARD', 'decor', 2, 2),
    entry('CLOCK', 'decor', 1, 2),
  ];
  const tube = aeroFurnitureCatalog().find((e) => e.id === 'AERO_TUBE_STATION');
  assert.ok(tube, 'the catalog has the tube');
  const sprites = {
    ...Object.fromEntries(stock.map((c) => [c.id, sprite('#445566')])),
    AERO_TUBE_STATION: buildAeroSprites().AERO_TUBE_STATION,
  };
  assert.ok(buildDynamicCatalog({ catalog: [...stock, tube], sprites }));
  catalogReady = true;
}

function layoutOf(opts: { noTube?: boolean } = {}): OfficeLayout {
  const f = (uid: string, type: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type,
    col,
    row,
  });
  const furniture: PlacedFurniture[] = [
    ...ORIGINS.flatMap((o, i) => [
      f(LEAD_SEATS[i], 'CUSHIONED_BENCH', o.col + 3, o.row + 2),
      f(`bench-${i}-r`, 'WOODEN_BENCH', o.col + 5, o.row + 2),
      f(`bench-${i}-l`, 'WOODEN_BENCH', o.col + 1, o.row + 2),
    ]),
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 18),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 18),
    f(LOUNGE_SOFAS[0], 'SOFA_FRONT', 31, 22),
    f(LOUNGE_SOFAS[1], 'SOFA_FRONT', 33, 22),
    f(LOUNGE_SOFAS[2], 'SOFA_SIDE', 36, 22),
    f('aero-0a1b2c3d-lounge-5', 'COFFEE_TABLE', 34, 20),
    ...(opts.noTube ? [] : [f('tube', 'AERO_TUBE_STATION', 20, 8)]),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  ORIGINS.forEach((o, i) => zone(`Pod ${i + 1}`, o.col, o.col + 6, o.row, o.row + 4));
  zone('Hall', 1, 52, 7, 17);
  zone('Lounge', 29, 39, 18, 25);
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  if (!opts.noTube) for (const r of [8, 9]) tiles[r * COLS + 20] = TileType.WALL;
  for (const uid of LOUNGE_SOFAS) {
    const piece = furniture.find((p) => p.uid === uid)!;
    areaTiles[piece.row * COLS + piece.col] = null;
  }
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture,
    areas: ['Pod 1', 'Pod 2', 'Pod 3', 'Hall', 'Lounge'].map((label) => ({
      label,
      color: AREA_LABEL_FALLBACK_COLOR,
    })),
    areaTiles,
    pets: [],
  };
}

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 0.1;
function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) os.update(DT);
}
function waitFor(os: OfficeState, done: () => boolean, max: number, what: string): number {
  let t = 0;
  for (; t < max; t += DT) {
    if (done()) return t;
    os.update(DT);
  }
  assert.ok(done(), `${what} within ${max}s`);
  return t;
}

interface Item {
  seq: number;
  fromRoom: string | null;
  toRoom: string | null;
}

const upd = (
  handoffs: Item[] | undefined,
  floor = FLOOR,
  rooms = ROOMS,
): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents: [],
  pods: { mappings: Object.fromEntries(ROOMS.map((r, i) => [r, [`Pod ${i + 1}`]])), labels: {} },
  floor: { id: floor, number: 1, name: 'f', rooms },
  ...(handoffs === undefined ? {} : { handoffs }),
});
const send = (handoffs: Item[], floor = FLOOR): void => {
  assert.ok(setAeroUpdate(upd(handoffs, floor, ROOMS)));
};

interface Counted {
  os: OfficeState;
  sounds: { n: number };
}

/** The office with the leads of the first `rooms` rooms working at their desks, and an empty first list in force. */
function office(rooms = 2, opts: { noTube?: boolean } = {}): Counted {
  loadCatalog();
  const os = new OfficeState(layoutOf(opts));
  os.aero.rng = seeded(7);
  const sounds = { n: 0 };
  os.aero.tubeSound = () => {
    sounds.n++;
  };
  for (let i = 0; i < rooms; i++) os.addAgent(i + 1, 0, 0, LEAD_SEATS[i], true, ROOMS[i]);
  send([]);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  for (let i = 0; i < rooms; i++) os.setAgentActive(i + 1, true);
  waitFor(os, () => [1, 2, 3].slice(0, rooms).every((id) => atDesk(os, id)), 30, 'leads at desks');
  return { os, sounds };
}

const snap = (os: OfficeState) => os.aero.snapshot();
const tileOf = (os: OfficeState, id: number) => {
  const c = os.characters.get(id)!;
  return { col: c.tileCol, row: c.tileRow };
};
const same = (a: { col: number; row: number }, b: { col: number; row: number }) =>
  a.col === b.col && a.row === b.row;
const homeOf = (os: OfficeState, id: number) => {
  const seat = os.seats.get(LEAD_SEATS[id - 1])!;
  return { col: seat.seatCol, row: seat.seatRow };
};
const atDesk = (os: OfficeState, id: number) =>
  same(tileOf(os, id), homeOf(os, id)) && os.characters.get(id)!.state === CharacterState.TYPE;
const walking = (os: OfficeState, id: number) =>
  snap(os).routes.some((r) => r.id === id && r.kind === 'handoff');
const delivered = (os: OfficeState) => snap(os).handoffsDelivered;
const capsules = (os: OfficeState) => snap(os).fxStarted.capsule ?? 0;
const item = (seq: number, from: string | null, to: string | null): Item => ({
  seq,
  fromRoom: from,
  toRoom: to,
});

// ── The pure part ─────────────────────────────────────────────────

test('the receiver stop is the right bench, then the left one, then the aisle', () => {
  const pod = { col: 10, row: 2 };
  const free = (taken: string[]) => (t: { col: number; row: number }) =>
    !taken.includes(`${t.col},${t.row}`);
  assert.deepEqual(receiverStop(pod, free([])), { tile: { col: 15, row: 4 }, dir: Direction.LEFT });
  assert.deepEqual(receiverStop(pod, free(['15,4'])), {
    tile: { col: 11, row: 4 },
    dir: Direction.RIGHT,
  });
  assert.deepEqual(receiverStop(pod, free(['15,4', '11,4'])), {
    tile: { col: 14, row: 5 },
    dir: Direction.LEFT,
  });
  assert.deepEqual(deskTile(pod), { col: 14, row: 2 });
});

test('a pod origin is the top-left of the tiles with its label, and only a pod has one', () => {
  const tiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  tiles[3 * COLS + 5] = 'Pod 2';
  tiles[4 * COLS + 4] = 'Pod 2';
  tiles[1 * COLS + 1] = 'Hot desks';
  assert.deepEqual(podOriginOf(tiles, COLS, ROWS, 'Pod 2'), { col: 4, row: 3 });
  assert.equal(podOriginOf(tiles, COLS, ROWS, 'Hot desks'), null);
  assert.equal(podOriginOf(tiles, COLS, ROWS, 'Pod 9'), null);
  assert.equal(podOriginOf(tiles, COLS, ROWS, null), null);
  assert.equal(podOriginOf(undefined, COLS, ROWS, 'Pod 2'), null);
});

test('the plan: the sender walks to the receiver and home; no receiver pod posts it at the tube; no sender has the receiver collect it', () => {
  const party = (col: number, pod: boolean) => ({
    home: { col, row: 4 },
    seatUid: `s${col}`,
    pod: pod ? { col: col - 3, row: 2 } : null,
  });
  const tube = { col: 20, row: 10 };
  const free = () => true;
  const a = party(4, true);
  const b = party(13, true);
  const doorbell = planHandoff({ sender: a, receiver: b, tube, free })!;
  assert.equal(doorbell.walker, 'sender');
  assert.deepEqual(
    doorbell.stages.map((s) => [s.act, s.tile.col, s.tile.row]),
    [
      ['deliver', 15, 4],
      ['home', 4, 4],
    ],
  );
  assert.equal(doorbell.stages[0].pause, HANDOFF_PAUSE_SEC);
  const hot = planHandoff({ sender: a, receiver: party(13, false), tube, free })!;
  assert.deepEqual(
    [hot.walker, ...hot.stages.map((s) => s.act)],
    ['sender', 'post', 'home'],
    'a receiver at a hot desk is sent by tube',
  );
  assert.deepEqual(hot.stages[0].tile, tube);
  const absent = planHandoff({ sender: a, receiver: null, tube, free })!;
  assert.deepEqual(
    absent.stages.map((s) => s.act),
    ['post', 'home'],
  );
  const pop = planHandoff({ sender: null, receiver: b, tube, free })!;
  assert.equal(pop.walker, 'receiver');
  assert.deepEqual(
    pop.stages.map((s) => [s.act, s.tile.col, s.tile.row]),
    [
      ['collect', 20, 10],
      ['deliver', 13, 4],
    ],
  );
  // Nobody to carry it, or no tube for what needs one.
  assert.equal(planHandoff({ sender: null, receiver: null, tube, free }), null);
  assert.equal(planHandoff({ sender: a, receiver: null, tube: null, free }), null);
  assert.equal(planHandoff({ sender: null, receiver: b, tube: null, free }), null);
  assert.ok(planHandoff({ sender: a, receiver: b, tube: null, free }), 'a doorbell needs no tube');
});

test('the book: the first list places, a seq is queued once, eight wait and the rest overflow, leaving the list clears', () => {
  const book = new HandoffBook();
  const list = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1, RA, RB));
  const first = book.ingest(FLOOR, list(2));
  assert.equal(first.reset, true);
  assert.equal(book.queue.length, 0, 'the first list is not walked');
  assert.deepEqual(
    [...book.desk],
    [
      [1, RB],
      [2, RB],
    ],
  );
  // The same list again: nothing new.
  assert.deepEqual(book.ingest(FLOOR, list(2)), { reset: false, overflow: [] });
  assert.equal(book.queue.length, 0);
  // Eleven: three new ones queue, none overflows.
  const next = book.ingest(FLOOR, list(11));
  assert.equal(book.queue.length, 9 > MAX_QUEUED_HANDOFFS ? MAX_QUEUED_HANDOFFS : 9);
  assert.deepEqual(
    next.overflow.map((h) => h.seq),
    [11],
  );
  // A seq that left the list leaves the queue and its desk; one that comes back is not walked again.
  book.ingest(FLOOR, list(3));
  assert.deepEqual(
    book.queue.map((q) => q.seq),
    [3],
  );
  assert.deepEqual([...book.desk.keys()], [1, 2]);
  const back = book.ingest(FLOOR, list(11));
  assert.deepEqual(back.overflow, []);
  assert.equal(book.queue.length, 1, 'seqs 4..11 were seen: not queued again');
  // Another floor's list is a first list again.
  assert.equal(book.ingest(OTHER_FLOOR, list(4)).reset, true);
  assert.equal(book.queue.length, 0);
  assert.equal(MAX_ACTIVE_HANDOFFS, 2);
});

test('the book: a dropped walk is queued again twice, then forgotten; one that left the list is not', () => {
  const book = new HandoffBook();
  book.ingest(FLOOR, []);
  book.ingest(FLOOR, [item(5, RA, RB)]);
  let q = book.take(() => true)!;
  assert.equal(book.queue.length, 0);
  book.requeue(q);
  q = book.take(() => true)!;
  assert.equal(q.tries, 1);
  book.requeue(q);
  q = book.take(() => true)!;
  assert.equal(q.tries, 2);
  book.requeue(q);
  assert.equal(book.queue.length, 0, 'forgotten after two more tries');
  book.ingest(FLOOR, []);
  book.requeue({ ...item(5, RA, RB), tries: 0 });
  assert.equal(book.queue.length, 0, 'not listed any more');
});

// ── The walk ──────────────────────────────────────────────────────

test('a doorbell handoff: the sender walks the capsule to the receiver, the whoosh and the capsule play once, a capsule stays on the desk, the sender goes home', () => {
  const c = office(2);
  const { os } = c;
  const before = capsules(os);
  send([item(5, RA, RB)]);
  waitFor(os, () => walking(os, 1), 5, 'the sender sets off');
  assert.equal(os.aero.carriedCapsules().length, 1, 'it carries the capsule');
  assert.equal(delivered(os), 0, 'nothing is delivered before it arrives');
  assert.equal(snap(os).activeHandoffs, 1);
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  // It stands at the receiver's right bench, facing left, with the capsule set down.
  assert.deepEqual(tileOf(os, 1), { col: 15, row: 4 });
  assert.equal(os.characters.get(1)!.dir, Direction.LEFT);
  assert.equal(os.aero.carriedCapsules().length, 0);
  assert.deepEqual(snap(os).handoffDeliveries, [{ seq: 5, id: 1, col: 15, row: 4 }]);
  assert.equal(c.sounds.n, 1);
  assert.equal(capsules(os), before + 1);
  assert.deepEqual(snap(os).deskCapsules, [{ seq: 5, col: 14, row: 2 }]);
  // It stays its pause, then goes home to its desk.
  const stood = waitFor(os, () => !same(tileOf(os, 1), { col: 15, row: 4 }), 5, 'leaves');
  assert.ok(
    stood >= HANDOFF_PAUSE_SEC - 0.3 && stood <= HANDOFF_PAUSE_SEC + 0.8,
    `stood ${stood}s`,
  );
  waitFor(os, () => atDesk(os, 1) && !walking(os, 1), 60, 'home');
  assert.equal(snap(os).activeHandoffs, 0);
  // The capsule stays while the handoff is listed, and goes when it leaves the list.
  run(os, 20);
  assert.equal(snap(os).deskCapsules.length, 1);
  send([]);
  run(os, 0.2);
  assert.deepEqual(snap(os).deskCapsules, []);
  assert.equal(delivered(os), 1);
});

test('the same seq again is not walked again; a new seq is', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  waitFor(os, () => atDesk(os, 1), 60, 'home');
  for (let i = 0; i < 3; i++) send([item(5, RA, RB)]);
  run(os, 10);
  assert.equal(delivered(os), 1);
  assert.equal(walking(os, 1), false);
  assert.equal(c.sounds.n, 1);
  send([item(5, RA, RB), item(6, RA, RB)]);
  waitFor(os, () => delivered(os) === 2, 60, 'the new one');
  assert.equal(c.sounds.n, 2);
});

test('the first list of a page or a floor places capsules and walks nobody; a handoff on another floor is a new floor first', () => {
  const c = office(2);
  const { os } = c;
  send([item(7, RA, RB)], OTHER_FLOOR);
  run(os, 10);
  assert.equal(delivered(os), 0);
  assert.equal(walking(os, 1), false);
  assert.equal(capsules(os), 0);
  assert.deepEqual(
    snap(os).deskCapsules,
    [{ seq: 7, col: 14, row: 2 }],
    'its capsule lies on the desk',
  );
  // The same seq on the floor it came from is a first list again: no walk.
  send([item(7, RA, RB)], FLOOR);
  run(os, 10);
  assert.equal(delivered(os), 0);
});

test('a handoff whose seq leaves the list before the sender sets off is not walked', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  send([]);
  run(os, 20);
  assert.equal(delivered(os), 0);
  assert.equal(snap(os).queuedHandoffs, 0);
  assert.equal(c.sounds.n, 0);
});

test('the receiver is not in the office: the sender posts the capsule into the tube and goes home', () => {
  const c = office(1);
  const { os } = c;
  send([item(3, RA, RB)]);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'posted');
  assert.deepEqual(tileOf(os, 1), FRONT);
  assert.deepEqual(snap(os).tubePosts, [{ id: 1, ...FRONT }]);
  assert.equal(c.sounds.n, 1);
  assert.equal(delivered(os), 0, 'a post is not a delivery');
  assert.equal(os.aero.carriedCapsules().length, 0);
  waitFor(os, () => atDesk(os, 1) && !walking(os, 1), 60, 'home');
  run(os, 20);
  assert.equal(snap(os).tubeSent, 1);
});

test('the sender is not in the office: the tube pops a capsule and the receiver collects it and takes it to its desk', () => {
  const c = office(1);
  const { os } = c;
  send([item(4, RB, RA)]);
  waitFor(os, () => same(tileOf(os, 1), FRONT) && walking(os, 1), 60, 'at the tube');
  assert.equal(delivered(os), 0);
  waitFor(os, () => c.sounds.n === 1, 5, 'the pop');
  assert.equal(os.aero.carriedCapsules().length, 1, 'carrying it out of the tube');
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  assert.deepEqual(snap(os).handoffDeliveries, [{ seq: 4, id: 1, ...homeOf(os, 1) }]);
  assert.equal(c.sounds.n, 1, 'the pop at the tube is the one sound; the desk adds none');
  assert.deepEqual(snap(os).deskCapsules, [{ seq: 4, col: 5, row: 2 }]);
  assert.equal(snap(os).tubeSent, 0, 'nothing was posted');
  waitFor(os, () => atDesk(os, 1) && !walking(os, 1), 60, 'at its desk');
});

test('with no tube a missing receiver is nobody to carry it: nothing walks, and the list can still clear', () => {
  const c = office(1, { noTube: true });
  send([item(3, RA, RB)]);
  run(c.os, 20);
  assert.equal(walking(c.os, 1), false);
  assert.equal(snap(c.os).tubeSent, 0);
  assert.equal(snap(c.os).queuedHandoffs, 1, 'it waits, as nobody can carry it');
  send([]);
  run(c.os, 0.2);
  assert.equal(snap(c.os).queuedHandoffs, 0);
});

test('a taken right bench sends the walker to the left one', () => {
  const c = office(2);
  const { os } = c;
  // The receiver's own people stand at the right bench: a worker of its pod holds it.
  os.addAgent(9, 0, 0, 'bench-1-r', true, RB);
  os.setAgentActive(9, true);
  run(os, MATRIX_EFFECT_DURATION + 1);
  send([item(5, RA, RB)]);
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  assert.deepEqual(snap(os).handoffDeliveries[0], { seq: 5, id: 1, col: 11, row: 4 });
  assert.equal(os.characters.get(1)!.dir, Direction.RIGHT);
});

// ── Many at once ──────────────────────────────────────────────────

test('at most two walk at once: three senders deliver, one after the other has room', () => {
  const c = office(3);
  const { os } = c;
  send([item(1, RA, RB), item(2, RB, RC), item(3, RC, RA)]);
  let most = 0;
  waitFor(
    os,
    () => {
      most = Math.max(most, snap(os).activeHandoffs);
      return delivered(os) === 3;
    },
    90,
    'all three delivered',
  );
  assert.equal(most, MAX_ACTIVE_HANDOFFS);
  assert.deepEqual(
    snap(os)
      .handoffDeliveries.map((d) => d.seq)
      .sort(),
    [1, 2, 3],
  );
  assert.equal(c.sounds.n, 3);
});

test('nine at once: eight wait and the ninth is placed on the desk with no walk; the rest are walked in order', () => {
  const c = office(2);
  const { os } = c;
  send(Array.from({ length: 9 }, (_, i) => item(i + 1, RA, RB)));
  // The ninth is placed at once: a pop at the tube and a capsule on the desk, nobody walking for it.
  run(os, 0.2);
  assert.deepEqual(snap(os).handoffDeliveries, [{ seq: 9, id: -1, col: 14, row: 2 }]);
  assert.ok(capsules(os) >= 1);
  assert.deepEqual(
    snap(os).deskCapsules.map((d) => d.seq),
    [9],
  );
  waitFor(os, () => delivered(os) === 9, 240, 'all delivered');
  assert.deepEqual(
    snap(os).handoffDeliveries.map((d) => d.seq),
    [9, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.equal(snap(os).deskCapsules.length, 9);
});

// ── Interruptions ─────────────────────────────────────────────────

test('a lead sent to the tube for a permission request puts its handoff back in the queue and carries it afterwards', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => walking(os, 1), 5, 'sets off');
  os.setAgentTool(1, 'Bash');
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'the permission trip');
  // A lead the owner is still needed by holds at its desk and carries nothing; once the request is answered it does.
  os.clearPermissionBubble(1);
  waitFor(os, () => delivered(os) === 1, 120, 'the handoff, after');
  assert.equal(delivered(os), 1);
  assert.equal(snap(os).handoffDeliveries[0].seq, 5);
});

test('a floor switch drops the walks and puts the capsules on the desks', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => walking(os, 1), 5, 'sets off');
  send([item(5, RA, RB)], OTHER_FLOOR);
  run(os, 0.3);
  assert.equal(walking(os, 1), false);
  assert.equal(os.aero.carriedCapsules().length, 0);
  assert.equal(delivered(os), 0);
  assert.equal(snap(os).queuedHandoffs, 0);
});

// ── The fix round ─────────────────────────────────────────────────

test('an update with no handoffs key is "not read yet": nothing is ingested, capsules stay and the reset waits for the first list', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  assert.equal(snap(os).deskCapsules.length, 1);
  // The key is absent: the capsule stays, nothing is queued.
  assert.ok(setAeroUpdate(upd(undefined, FLOOR)));
  run(os, 0.3);
  assert.equal(snap(os).deskCapsules.length, 1, 'absent is not an empty list');
  // A new floor with the key absent does not use up the floor's first list: the list that follows only places.
  assert.ok(setAeroUpdate(upd(undefined, OTHER_FLOOR)));
  run(os, 0.3);
  send([item(7, RA, RB)], OTHER_FLOOR);
  run(os, 10);
  assert.equal(walking(os, 1), false, 'the first list that is read places, it does not walk');
  assert.equal(delivered(os), 1);
  assert.deepEqual(
    snap(os).deskCapsules.map((d) => d.seq),
    [7],
  );
});

test('the book: a seq that left the list and comes back is placed on its desk with no walk, one that was null and resolves gets its capsule', () => {
  const book = new HandoffBook();
  book.ingest(FLOOR, []);
  book.ingest(FLOOR, [item(5, RA, RB), item(6, RA, null)]);
  assert.equal(book.queue.length, 2);
  book.take(() => true); // 5 is on its way
  book.take(() => true); // 6 too
  book.deliver(item(5, RA, RB), 1, { col: 1, row: 1 });
  assert.deepEqual([...book.desk], [[5, RB]]);
  book.ingest(FLOOR, []);
  assert.deepEqual([...book.desk], []);
  const back = book.ingest(FLOOR, [item(5, RA, RB)]);
  assert.deepEqual(back, { reset: false, overflow: [] });
  assert.equal(book.queue.length, 0, 'not walked again');
  assert.deepEqual([...book.desk], [[5, RB]], 'but its capsule is back on the desk');
  // A seq whose receiver was null and resolves later.
  book.ingest(FLOOR, [item(5, RA, RB), item(6, RA, RC)]);
  assert.deepEqual(
    [...book.desk],
    [
      [5, RB],
      [6, RC],
    ],
  );
  // A seq that is still on its way (not delivered) has no capsule yet.
  const b2 = new HandoffBook();
  b2.ingest(FLOOR, []);
  b2.ingest(FLOOR, [item(8, RA, RB)]);
  b2.take(() => true);
  b2.ingest(FLOOR, [item(8, RA, RB)]);
  assert.deepEqual([...b2.desk], [], 'on its way: no capsule before it arrives');
});

test('the book: evicting the oldest seen seqs never evicts one that is still listed', () => {
  const book = new HandoffBook();
  book.ingest(FLOOR, [item(1, RA, RB)]);
  for (let i = 0; i < 300; i++) book.ingest(FLOOR, [item(1, RA, RB), item(1000 + i, RA, RB)]);
  assert.deepEqual(
    book.queue.map((q) => q.seq),
    [1299],
    'seq 1 was never queued as if it were new',
  );
});

test('the book: an item nobody can carry now waits outside the eight, and comes in when somebody can', () => {
  const book = new HandoffBook();
  book.ingest(FLOOR, []);
  const nobody = () => false;
  const list = Array.from({ length: 9 }, (_, i) => item(i + 1, RA, RB));
  const r = book.ingest(FLOOR, list, nobody);
  assert.deepEqual(r.overflow, []);
  assert.equal(book.queue.length, 0);
  assert.equal(book.waiting.length, 9);
  // A plannable one still has a slot.
  const next = book.ingest(FLOOR, [...list, item(10, RB, RA)], (h) => h.seq === 10);
  assert.deepEqual(next.overflow, []);
  assert.deepEqual(
    book.queue.map((q) => q.seq),
    [10],
  );
  // Somebody can carry them now: they come in, eight at most.
  book.retryWaiting(() => true);
  assert.equal(book.queue.length, MAX_QUEUED_HANDOFFS);
  assert.equal(book.waiting.length, 2);
  // One that leaves the list leaves the waiting too.
  book.ingest(FLOOR, [item(9, RA, RB)]);
  assert.deepEqual(
    [...book.queue, ...book.waiting].map((q) => q.seq),
    [9],
  );
});

test('eight handoffs nobody can carry do not hold the queue: when the receiver arrives all nine are walked', () => {
  const c = office(1, { noTube: true });
  const { os } = c;
  send(Array.from({ length: 9 }, (_, i) => item(i + 1, RA, RB)));
  run(os, 5);
  assert.equal(delivered(os), 0);
  assert.equal(snap(os).queuedHandoffs, 9, 'all nine wait');
  os.addAgent(2, 0, 0, LEAD_SEATS[1], true, RB);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  os.setAgentActive(2, true);
  waitFor(os, () => delivered(os) === 9, 400, 'all nine delivered');
  assert.ok(
    snap(os).handoffDeliveries.every((d) => d.id === 1),
    'every one was walked by the sender',
  );
});

test('with the queue full a handoff to a receiver with no pod still gets its desk entry, and a tube post counts', () => {
  const c = office(1);
  const { os } = c;
  send(Array.from({ length: 9 }, (_, i) => item(i + 1, RA, RB)));
  run(os, 0.2);
  assert.equal(os.aero.handoffs.desk.get(9), RB, 'the capsule waits for the receiver');
  assert.equal(snap(os).tubeSent, 1, 'the one that went up the tube is a post');
  assert.deepEqual(snap(os).deskCapsules, [], 'nothing is drawn: the receiver has no pod here');
});

test('the receiver pods are found once per layout, not by scanning the tiles at every call', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => delivered(os) === 1, 60, 'delivered');
  const tiles = os.layout.areaTiles!;
  let reads = 0;
  os.layout.areaTiles = new Proxy(tiles, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++;
      return Reflect.get(target, prop, receiver);
    },
  });
  for (let i = 0; i < 5; i++) assert.equal(snap(os).deskCapsules.length, 1);
  // A seat's zone is one tile; a scan for the pod would read all of them (a floor is 1944 tiles here).
  assert.ok(reads <= 20, `the tiles were read ${reads} times`);
  assert.deepEqual(podOriginMap(tiles, COLS, ROWS).get('Pod 2'), { col: 10, row: 2 });
});

test('a lead held at its desk for the owner (a permission bubble it has been to the tube for) carries nothing', () => {
  const c = office(2);
  const { os } = c;
  os.setAgentTool(1, 'Bash');
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'the permission trip');
  waitFor(os, () => atDesk(os, 1) && !walking(os, 1), 60, 'back at its desk');
  send([item(5, RA, RB)]);
  run(os, 20);
  assert.equal(walking(os, 1), false);
  assert.equal(delivered(os), 0);
  os.clearPermissionBubble(1);
  waitFor(os, () => delivered(os) === 1, 90, 'delivered once the request is answered');
});

test('the collect route: the capsule effect and the whoosh play once at the tube, and a collected capsule is not collected twice after an interruption', () => {
  const c = office(1);
  const { os } = c;
  send([item(4, RB, RA)]);
  waitFor(os, () => c.sounds.n === 1, 60, 'the pop at the tube');
  assert.equal(os.aero.carriedCapsules().length, 1);
  const fx = capsules(os);
  // Interrupted after collecting: the permission trip posts once, then the capsule goes to the desk.
  os.setAgentTool(1, 'Bash');
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'the permission trip');
  os.clearPermissionBubble(1);
  waitFor(os, () => delivered(os) === 1, 120, 'delivered');
  assert.equal(c.sounds.n, 2, 'one pop and one permission post, no second collect');
  assert.equal(capsules(os), fx + 1, 'the capsule effect: the permission post only');
  assert.deepEqual(snap(os).handoffDeliveries, [{ seq: 4, id: 1, ...homeOf(os, 1) }]);
});

test('a seq that leaves the list mid-walk cancels the walk: nothing is delivered and the walker goes home', () => {
  const c = office(2);
  const { os } = c;
  send([item(5, RA, RB)]);
  waitFor(os, () => walking(os, 1) && !same(tileOf(os, 1), homeOf(os, 1)), 5, 'on its way');
  send([]);
  waitFor(os, () => atDesk(os, 1) && !walking(os, 1), 60, 'home');
  run(os, 5);
  assert.equal(delivered(os), 0);
  assert.equal(c.sounds.n, 0);
  assert.equal(os.aero.carriedCapsules().length, 0);
  assert.deepEqual(snap(os).deskCapsules, []);
});

test('the plan is busy rather than stacking on a tube front or a pod tile somebody holds', () => {
  const party = (col: number, pod: boolean) => ({
    home: { col, row: 4 },
    seatUid: `s${col}`,
    pod: pod ? { col: col - 3, row: 2 } : null,
  });
  const tube = { col: 20, row: 10 };
  const a = party(4, true);
  const b = party(13, true);
  const not =
    (...tiles: Array<{ col: number; row: number }>) =>
    (t: { col: number; row: number }) =>
      !tiles.some((x) => x.col === t.col && x.row === t.row);
  assert.equal(planHandoff({ sender: a, receiver: null, tube, free: not(tube) })?.busy, true);
  assert.equal(planHandoff({ sender: null, receiver: b, tube, free: not(tube) })?.busy, true);
  assert.equal(
    planHandoff({
      sender: a,
      receiver: b,
      tube,
      free: not({ col: 15, row: 4 }, { col: 11, row: 4 }, { col: 14, row: 5 }),
    })?.busy,
    true,
    'no bench and no aisle tile free',
  );
  assert.equal(
    receiverStop(
      { col: 10, row: 2 },
      not({ col: 15, row: 4 }, { col: 11, row: 4 }, { col: 14, row: 5 }),
    ),
    null,
  );
  assert.equal(
    planHandoff({ sender: a, receiver: b, tube, free: not(tube) })?.busy,
    false,
    'a doorbell needs no tube',
  );
  // A collected capsule is not collected again: the receiver only takes it to its desk.
  const again = planHandoff({ sender: null, receiver: b, tube, free: () => true, collected: true });
  assert.deepEqual(
    again?.stages.map((s) => s.act),
    ['deliver'],
  );
});
