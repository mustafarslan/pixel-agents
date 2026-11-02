/**
 * The tube station (docs/work/phase6-tube/plan.md, round 1: the fork).
 *
 * `buildWorld` is a 54x36 open office with a pod of five lead benches, the Lounge, and the tube station on the Hall's wall at
 * (20,8): its front tile is (20,10) and its queue (20,11) and (20,12). A lead the owner is needed by (a permission bubble, or the
 * `AskUserQuestion` tool) walks to the front, posts a capsule (the `capsule` effect and the whoosh, once), and goes back to its desk.
 * The rng is seeded; the sound is a function the tests count.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { Effects } from '../src/aero/effects.js';
import { aeroFurnitureCatalog } from '../src/aero/furniture.js';
import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { TUBE_QUEUE, TUBE_SEC } from '../src/aero/routines.js';
import { buildStations } from '../src/aero/stations.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { playTubeSound, setSoundEnabled } from '../src/notificationSound.js';
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
  setSoundEnabled(true);
});

const COLS = 54;
const ROWS = 36;
const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';
const LEAD_SEATS = ['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5'];
const LOUNGE_SOFAS = ['aero-0a1b2c3d-lounge-2', 'aero-0a1b2c3d-lounge-3', 'aero-0a1b2c3d-lounge-4'];
const TUBE_AT = { col: 20, row: 8 };
const FRONT = { col: 20, row: 10 };
const QUEUE = [FRONT, { col: 20, row: 11 }, { col: 20, row: 12 }];
const QUESTION = 'AskUserQuestion';

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
    entry('PC_OFF', 'electronics', 1, 1, { groupId: 'pc', state: 'off' }),
    entry('PC_ON', 'electronics', 1, 1, { groupId: 'pc', state: 'on' }),
    entry('DESK', 'desks', 1, 1, { isDesk: true }),
    entry('CUSHIONED_BENCH', 'chairs', 1, 1),
    entry('WOODEN_BENCH', 'chairs', 1, 1),
    entry('SOFA_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('SOFA_SIDE', 'chairs', 1, 1, { orientation: 'side' }),
    entry('COFFEE_TABLE', 'furniture', 2, 2),
    entry('WHITEBOARD', 'decor', 2, 2),
    entry('CLOCK', 'decor', 1, 2),
    entry('AERO_VENDING_MACHINE', 'misc', 1, 2, { backgroundTiles: 1 }),
  ];
  // The tube is the real catalog entry and the real sprite.
  const tube = aeroFurnitureCatalog().find((e) => e.id === 'AERO_TUBE_STATION');
  assert.ok(tube, 'the catalog has the tube');
  const catalog = [...stock, tube];
  const sprites = {
    ...Object.fromEntries(stock.map((c) => [c.id, sprite('#445566')])),
    AERO_TUBE_STATION: buildAeroSprites().AERO_TUBE_STATION,
  };
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
  catalogReady = true;
}

interface WorldOptions {
  /** Leave the tube out. */
  noTube?: boolean;
  /** A vending machine standing on the tube's front tile. */
  vendingOnFront?: boolean;
}

function layoutOf(opts: WorldOptions = {}): OfficeLayout {
  const f = (uid: string, type: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type,
    col,
    row,
  });
  const furniture: PlacedFurniture[] = [
    ...[2, 4, 6].map((c) => f(`pc-${c}`, 'PC_OFF', c, 2)),
    ...[2, 4, 6].map((c) => f(`desk-${c}`, 'DESK', c, 3)),
    ...LEAD_SEATS.map((uid, i) => f(uid, 'CUSHIONED_BENCH', 2 + i, 6)),
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 18),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 18),
    f(LOUNGE_SOFAS[0], 'SOFA_FRONT', 31, 22),
    f(LOUNGE_SOFAS[1], 'SOFA_FRONT', 33, 22),
    f(LOUNGE_SOFAS[2], 'SOFA_SIDE', 36, 22),
    f('aero-0a1b2c3d-lounge-5', 'COFFEE_TABLE', 34, 20),
    ...(opts.noTube ? [] : [f('tube', 'AERO_TUBE_STATION', TUBE_AT.col, TUBE_AT.row)]),
    ...(opts.vendingOnFront ? [f('vend', 'AERO_VENDING_MACHINE', 20, 9)] : []),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
  zone('Hall', 1, 52, 7, 17);
  zone('Lounge', 29, 39, 18, 25);
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  // The tube hangs on the Hall's wall: its two tiles are wall.
  if (!opts.noTube) {
    for (const r of [TUBE_AT.row, TUBE_AT.row + 1]) tiles[r * COLS + TUBE_AT.col] = TileType.WALL;
  }
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
    areas: ['Pod 1', 'Hall', 'Lounge'].map((label) => ({
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

const upd = (floor: string): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents: [],
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Pod 1'] }, labels: {} },
  floor: { id: floor, number: 1, name: 'f', rooms: [floor] },
});

interface Counted {
  os: OfficeState;
  sounds: { n: number };
}

/** The office with `leads` idle leads at their desks, the update in force, and a counted sound. */
function office(leads: number, opts: WorldOptions = {}): Counted {
  loadCatalog();
  const os = new OfficeState(layoutOf(opts));
  os.aero.rng = seeded(7);
  const sounds = { n: 0 };
  os.aero.tubeSound = () => {
    sounds.n++;
  };
  for (let i = 0; i < leads; i++) os.addAgent(i + 1, 0, 0, LEAD_SEATS[i], true, FA);
  assert.ok(setAeroUpdate(upd(FA)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  for (let i = 0; i < leads; i++) os.setAgentActive(i + 1, false);
  // The leads settle (their rest at the Lounge is their own business); the tests give them needs from here.
  return { os, sounds };
}

const snap = (os: OfficeState) => os.aero.snapshot();
const lead = (os: OfficeState, id: number) => snap(os).leads.find((l) => l.id === id)!;
const tileOf = (os: OfficeState, id: number) => {
  const c = os.characters.get(id)!;
  return { col: c.tileCol, row: c.tileRow };
};
const same = (a: { col: number; row: number }, b: { col: number; row: number }) =>
  a.col === b.col && a.row === b.row;
const deskOf = (os: OfficeState, id: number) => {
  const seat = os.seats.get(os.characters.get(id)!.seatId ?? LEAD_SEATS[id - 1])!;
  return { col: seat.seatCol, row: seat.seatRow };
};
const atDesk = (os: OfficeState, id: number) =>
  same(tileOf(os, id), deskOf(os, id)) && os.characters.get(id)!.state === CharacterState.TYPE;
const capsules = (os: OfficeState) => snap(os).fxStarted.capsule ?? 0;
const tubeRoutes = (os: OfficeState) => snap(os).routes.filter((r) => r.kind === 'tube');

/** An idle lead that has been seated at its desk. */
function seated(c: Counted, id: number): void {
  c.os.setAgentActive(id, false);
  waitFor(c.os, () => atDesk(c.os, id), 90, `lead ${id} at its desk`);
}

/** Starts a Bash tool and then a permission request for it, as the hooks do. */
function askPermission(os: OfficeState, id: number): void {
  os.setAgentTool(id, 'Bash');
  os.setAgentActive(id, true);
  os.showPermissionBubble(id);
}

/** A new tool (the answer was given and the lead goes on): the bubble goes with it, as the page does in one message. */
function newTool(os: OfficeState, id: number, tool: string): void {
  os.clearPermissionBubble(id);
  os.setAgentTool(id, tool);
}

// ── The piece and the station ─────────────────────────────────────

test('the tube is one wall piece, 1x2, found in the layout with its front tile and a queue of three', () => {
  loadCatalog();
  const entry = aeroFurnitureCatalog().find((e) => e.id === 'AERO_TUBE_STATION')!;
  assert.deepEqual(
    [entry.width, entry.height, entry.footprintW, entry.footprintH, entry.backgroundTiles],
    [16, 32, 1, 2, 0],
  );
  assert.equal(entry.canPlaceOnWalls, true);
  assert.equal(entry.category, 'decor');
  assert.equal(
    aeroFurnitureCatalog().filter((e) => e.canPlaceOnWalls).length,
    1,
    'the only wall piece',
  );
  const os = new OfficeState(layoutOf());
  const tube = buildStations(os).tube;
  assert.ok(tube);
  assert.deepEqual([tube.col, tube.row], [TUBE_AT.col, TUBE_AT.row]);
  assert.equal(tube.queue.length, TUBE_QUEUE);
  assert.deepEqual(tube.queue, QUEUE, 'the front, then straight away from the piece');
  // No piece, no tube; a front tile that is blocked, no tube.
  assert.equal(buildStations(new OfficeState(layoutOf({ noTube: true }))).tube, null);
  assert.equal(buildStations(new OfficeState(layoutOf({ vendingOnFront: true }))).tube, null);
});

// ── The trip ──────────────────────────────────────────────────────

test('a permission request sends the lead to the tube once: it stands on the front tile, the capsule and the whoosh play once, it goes back', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  assert.equal(snap(os).tubeSent, 0);
  askPermission(os, 1);
  waitFor(
    os,
    () => same(tileOf(os, 1), FRONT) && lead(os, 1).routine?.phase === 'at',
    60,
    'at the front',
  );
  assert.equal(lead(os, 1).routine?.kind, 'tube');
  assert.equal(os.characters.get(1)!.dir, Direction.UP, 'facing up toward the tube');
  assert.equal(capsules(os), 1);
  assert.equal(c.sounds.n, 1);
  assert.equal(snap(os).tubeSent, 1);
  assert.deepEqual(snap(os).tubePosts, [{ id: 1, ...FRONT }]);
  // It stays about a second, then goes back to its desk and waits there.
  const stood = waitFor(os, () => !same(tileOf(os, 1), FRONT), 5, 'leaves the front');
  assert.ok(stood >= TUBE_SEC - 0.3 && stood <= TUBE_SEC + 0.8, `stood ${stood}s`);
  waitFor(os, () => atDesk(os, 1), 60, 'back at its desk');
  assert.equal(lead(os, 1).routine, null);
  // Twenty seconds with the request still open: no second trip, the lead stays at its desk.
  run(os, 20);
  assert.equal(snap(os).tubeSent, 1);
  assert.equal(capsules(os), 1);
  assert.equal(c.sounds.n, 1);
  assert.ok(atDesk(os, 1));
  assert.equal(tubeRoutes(os).length, 0);
});

test('a question sends the active lead once, though it stays active', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  os.setAgentTool(1, QUESTION);
  os.setAgentActive(1, true);
  waitFor(os, () => same(tileOf(os, 1), FRONT) && snap(os).tubeSent === 1, 60, 'posted');
  assert.equal(capsules(os), 1);
  assert.equal(c.sounds.n, 1);
  assert.equal(lead(os, 1).active, true, 'still an active lead');
  waitFor(os, () => atDesk(os, 1), 60, 'back at its desk');
  run(os, 20);
  assert.equal(snap(os).tubeSent, 1);
  assert.ok(atDesk(os, 1));
  assert.equal(lead(os, 1).active, true);
});

test('a permission lead that is active is walked there too (the stock step would send it back to its seat)', () => {
  const c = office(1);
  seated(c, 1);
  askPermission(c.os, 1);
  assert.equal(lead(c.os, 1).active, true);
  waitFor(c.os, () => snap(c.os).tubeSent === 1, 60, 'posted');
  assert.equal(lead(c.os, 1).active, true, 'its flag is as it was');
});

test('a question that also brings a permission bubble is one need, one trip', () => {
  const c = office(1);
  seated(c, 1);
  c.os.setAgentTool(1, QUESTION);
  c.os.setAgentActive(1, true);
  c.os.showPermissionBubble(1);
  waitFor(c.os, () => snap(c.os).tubeSent === 1, 60, 'posted');
  waitFor(c.os, () => atDesk(c.os, 1), 60, 'back');
  run(c.os, 20);
  assert.equal(snap(c.os).tubeSent, 1);
});

test('a permission request is one trip though a tool starts under its bubble; two requests, and two questions in a row, are two', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'posted');
  // An agentToolStart that keeps the bubble (the hook confirmed the permission): the same request.
  os.setAgentTool(1, 'Agent');
  os.setAgentTool(1, 'Bash');
  waitFor(os, () => atDesk(os, 1), 60, 'back');
  run(os, 20);
  assert.equal(snap(os).tubeSent, 1, 'no second trip');
  assert.equal(c.sounds.n, 1);
  // Cleared and asked again: a second request.
  newTool(os, 1, 'Edit');
  run(os, 1);
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 2, 60, 'second request');
  waitFor(os, () => atDesk(os, 1), 60, 'back again');
  // Two questions in a row.
  newTool(os, 1, QUESTION);
  waitFor(os, () => snap(os).tubeSent === 3, 60, 'first question');
  waitFor(os, () => atDesk(os, 1), 60, 'back from it');
  os.setAgentTool(1, QUESTION);
  waitFor(os, () => snap(os).tubeSent === 4, 60, 'second question');
  waitFor(os, () => atDesk(os, 1), 60, 'back from it');
  run(os, 20);
  assert.equal(snap(os).tubeSent, 4);
  assert.equal(c.sounds.n, 4);
});

test('a new need after the old one ended sends the lead again; so does a different kind or a second question in a row', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'first');
  waitFor(os, () => atDesk(os, 1), 60, 'back');
  // Answered and ended: the next tool clears the bubble, then another request.
  newTool(os, 1, 'Edit');
  run(os, 1);
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 2, 60, 'second');
  waitFor(os, () => atDesk(os, 1), 60, 'back again');
  // A permission then straight away a question (a new tool: the bubble goes, the kind changes): a third.
  newTool(os, 1, QUESTION);
  waitFor(os, () => snap(os).tubeSent === 3, 60, 'the question');
  waitFor(os, () => atDesk(os, 1), 60, 'back from the question');
  // Two questions in a row: currentTool stays AskUserQuestion, only the tool count changes.
  os.setAgentTool(1, QUESTION);
  waitFor(os, () => snap(os).tubeSent === 4, 60, 'the second question');
  waitFor(os, () => atDesk(os, 1), 60, 'back from the second question');
  run(os, 20);
  assert.equal(snap(os).tubeSent, 4);
  assert.equal(capsules(os), 4);
  assert.equal(c.sounds.n, 4);
});

test('the bubble cleared and shown again with no tool between is the same need only while it lasts; once cleared it is new', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'first');
  waitFor(os, () => atDesk(os, 1), 60, 'back');
  os.showPermissionBubble(1); // shown again: still the one need
  run(os, 10);
  assert.equal(snap(os).tubeSent, 1);
  os.clearPermissionBubble(1);
  run(os, 1);
  os.showPermissionBubble(1);
  waitFor(os, () => snap(os).tubeSent === 2, 60, 'a new need');
});

test('the need ending on the way sends the lead back: no capsule, no sound, no route', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  waitFor(
    os,
    () => tubeRoutes(os).length === 1 && !same(tileOf(os, 1), deskOf(os, 1)),
    10,
    'on its way',
  );
  run(os, 1);
  assert.ok(!same(tileOf(os, 1), FRONT));
  // The next tool starts: the permission bubble goes.
  newTool(os, 1, 'Read');
  run(os, DT);
  assert.equal(tubeRoutes(os).length, 0, 'the route is dropped');
  waitFor(os, () => atDesk(os, 1), 60, 'back at its desk');
  run(os, 5);
  assert.equal(capsules(os), 0);
  assert.equal(c.sounds.n, 0);
  assert.equal(snap(os).tubeSent, 0);
  assert.deepEqual(snap(os).tubePosts, []);
});

test('an idle lead whose permission bubble goes mid-walk is back to the usual rules, not held', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  os.setAgentActive(1, false);
  os.showPermissionBubble(1);
  waitFor(os, () => tubeRoutes(os).length === 1, 10, 'on its way');
  run(os, 1);
  os.clearPermissionBubble(1);
  run(os, DT);
  assert.equal(tubeRoutes(os).length, 0);
  assert.equal(capsules(os), 0);
  assert.equal(c.sounds.n, 0);
});

test('a layout rebuild drops the route; the lead is sent again when the need is still open, and not at all without a tube', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  waitFor(os, () => tubeRoutes(os).length === 1, 10, 'on its way');
  run(os, 1);
  os.rebuildFromLayout(layoutOf());
  assert.equal(tubeRoutes(os).length, 0, 'dropped by the rebuild');
  waitFor(os, () => snap(os).tubeSent === 1, 90, 'sent again, once');
  waitFor(os, () => atDesk(os, 1), 90, 'back');
  run(os, 10);
  assert.equal(snap(os).tubeSent, 1);
  // A rebuild without the tube: the lead has no trip, and nothing is left of the old one.
  os.setAgentTool(1, QUESTION);
  run(os, DT);
  os.rebuildFromLayout(layoutOf({ noTube: true }));
  run(os, 20);
  assert.equal(snap(os).tube, null);
  assert.equal(tubeRoutes(os).length, 0);
  assert.equal(snap(os).tubeSent, 1);
});

test('the floor on show changing drops the route and no effect plays; coming back sends the lead once, a lead already posted is not sent again', () => {
  const c = office(2);
  const { os } = c;
  seated(c, 1);
  seated(c, 2);
  askPermission(os, 1);
  waitFor(os, () => tubeRoutes(os).length === 1, 10, 'on its way');
  run(os, 1);
  assert.ok(setAeroUpdate(upd(FB)));
  run(os, 2);
  assert.equal(tubeRoutes(os).length, 0, 'dropped with the floor');
  assert.equal(snap(os).tubeSent, 0);
  run(os, 20);
  assert.equal(snap(os).tubeSent, 0, 'nothing posted off the floor');
  assert.equal(capsules(os), 0);
  assert.equal(c.sounds.n, 0);
  // Back: the need is still open and was never posted.
  assert.ok(setAeroUpdate(upd(FA)));
  waitFor(os, () => snap(os).tubeSent === 1, 90, 'posted after returning');
  waitFor(os, () => atDesk(os, 1), 90, 'at its desk');
  // Away and back after posting: not again.
  assert.ok(setAeroUpdate(upd(FB)));
  run(os, 2);
  assert.ok(setAeroUpdate(upd(FA)));
  run(os, 30);
  assert.equal(snap(os).tubeSent, 1);
  assert.equal(capsules(os), 1);
});

test('a lead of a floor that is not on show gets no trip and no effect', () => {
  loadCatalog();
  const os = new OfficeState(layoutOf());
  const sounds = { n: 0 };
  os.aero.tubeSound = () => {
    sounds.n++;
  };
  os.addAgent(1, 0, 0, LEAD_SEATS[0], true, FB);
  assert.ok(setAeroUpdate(upd(FA)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  askPermission(os, 1);
  run(os, 30);
  assert.equal(snap(os).tubeSent, 0);
  assert.equal(capsules(os), 0);
  assert.equal(sounds.n, 0);
  assert.equal(tubeRoutes(os).length, 0);
});

// ── The queue ─────────────────────────────────────────────────────

test('three queue in front of the tube and the fourth waits at its desk until a place is free', () => {
  const c = office(4);
  const { os } = c;
  for (const id of [1, 2, 3, 4]) seated(c, id);
  for (const id of [1, 2, 3, 4]) askPermission(os, id);
  os.update(DT);
  const routes = tubeRoutes(os);
  assert.equal(routes.length, 3, 'three have a place');
  assert.deepEqual(
    routes.map((r) => ({ col: r.col, row: r.row })).sort((a, b) => a.row - b.row),
    QUEUE,
    'the three places of the queue, one each',
  );
  assert.equal(lead(os, 4).routine, null, 'the fourth has none');
  assert.ok(atDesk(os, 4), 'and stays at its desk');
  // Everyone gets to post, one at a time, the fourth after a place is free.
  waitFor(os, () => snap(os).tubeSent === 4, 120, 'all four posted');
  const posts = snap(os).tubePosts;
  assert.deepEqual(posts.map((p) => p.id).sort(), [1, 2, 3, 4]);
  assert.ok(posts.every((p) => same(p, FRONT)));
  assert.equal(capsules(os), 4);
  assert.equal(c.sounds.n, 4);
  for (const id of [1, 2, 3, 4]) waitFor(os, () => atDesk(os, id), 90, `lead ${id} back`);
  run(os, 20);
  assert.equal(snap(os).tubeSent, 4, 'once each');
});

test('a lead from its desk takes the place behind one still walking to a place, never ahead of it', () => {
  const c = office(3);
  const { os } = c;
  for (const id of [1, 2, 3]) seated(c, id);
  const routes = (
    os.aero as unknown as { routes: Map<number, { arrived?: boolean; slot?: number }> }
  ).routes;
  askPermission(os, 1);
  waitFor(os, () => same(tileOf(os, 1), FRONT), 60, 'the first at the front');
  askPermission(os, 2);
  os.update(DT);
  assert.equal(routes.get(2)?.slot, 1, 'the second takes the place behind');
  // The first leaves while the second is still on the way to its place.
  waitFor(
    os,
    () => !routes.has(1) && !same(tileOf(os, 1), FRONT) && routes.get(2)?.arrived !== true,
    20,
    'the first has left the front while the second is still walking',
  );
  assert.equal(routes.get(2)?.arrived, false, 'the second is still walking');
  askPermission(os, 3);
  os.update(DT);
  assert.equal(routes.get(3)?.slot, 2, 'the third is behind the second, not at the free front');
  waitFor(os, () => snap(os).tubeSent === 3, 120, 'all posted');
  assert.deepEqual(
    snap(os).tubePosts.map((p) => p.id),
    [1, 2, 3],
    'in order',
  );
});

test('the queue is one at the front at a time: two leads never post on one tile together', () => {
  const c = office(3);
  const { os } = c;
  for (const id of [1, 2, 3]) seated(c, id);
  for (const id of [1, 2, 3]) askPermission(os, id);
  let worst = 0;
  for (let t = 0; t < 90 && snap(os).tubeSent < 3; t += DT) {
    os.update(DT);
    const onFront = [1, 2, 3].filter(
      (id) => same(tileOf(os, id), FRONT) && lead(os, id).routine?.phase === 'at',
    );
    worst = Math.max(worst, onFront.length);
  }
  assert.equal(snap(os).tubeSent, 3);
  assert.equal(worst, 1);
});

test('while anybody is on the way, the whole queue is reserved; with nobody it is not', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  const priv = os.aero as unknown as {
    occupied(except: number): Set<string>;
    protonSpots(kind: string): Array<{ col: number; row: number }>;
  };
  const key = (t: { col: number; row: number }) => `${t.col},${t.row}`;
  for (const t of QUEUE) assert.ok(!priv.occupied(Number.NaN).has(key(t)), 'free with no trip');
  askPermission(os, 1);
  os.update(DT);
  assert.equal(tubeRoutes(os).length, 1);
  const taken = priv.occupied(Number.NaN);
  for (const t of QUEUE) assert.ok(taken.has(key(t)), `${key(t)} reserved`);
  // Proton's spots and a break's targets are drawn from what is not taken.
  for (const spot of priv.protonSpots('agent')) {
    assert.ok(!QUEUE.some((t) => same(t, spot)), 'Proton is not offered a queue tile');
  }
  // An idle lead's Lounge pick is not on the queue either.
  assert.ok(!taken.has('0,0'));
});

test('Proton on a spot that is in the queue gives it up when a trip starts', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  run(os, 1);
  const cat = os.aero.proton!;
  assert.ok(cat, 'Proton is on show');
  // She stands on the queue's middle tile as an `agent` spot (beside a worker), a long stay.
  cat.place(QUEUE[1]);
  cat.spot = 'agent';
  (cat as unknown as { timer: number }).timer = 100; // mid-stay: she would not move on her own
  assert.ok(QUEUE.some((t) => same(t, cat.spotTile())));
  askPermission(os, 1);
  os.update(DT);
  assert.equal(tubeRoutes(os).length, 1);
  os.update(DT);
  assert.ok(
    cat.spot === null || !QUEUE.some((t) => same(t, cat.spotTile())),
    'her spot is not a queue tile any more',
  );
  run(os, 3);
  assert.ok(!QUEUE.some((t) => same(t, { col: cat.col, row: cat.row })), 'she has left the queue');
});

// ── Not a lead's business, and no tube ────────────────────────────

test('a teammate (a lead of its own team) is not sent', () => {
  const c = office(2);
  const { os } = c;
  seated(c, 2);
  os.characters.get(2)!.leadAgentId = 1;
  askPermission(os, 2);
  run(os, 20);
  assert.equal(tubeRoutes(os).length, 0);
  assert.equal(snap(os).tubeSent, 0);
});

test('with no tube in the layout nothing changes: a permission lead stays at its desk, a question lead works on', () => {
  const c = office(2, { noTube: true });
  const { os } = c;
  seated(c, 1);
  seated(c, 2);
  askPermission(os, 1);
  os.setAgentTool(2, QUESTION);
  os.setAgentActive(2, true);
  run(os, 30);
  assert.equal(snap(os).tube, null);
  assert.equal(snap(os).tubeSent, 0);
  assert.equal(tubeRoutes(os).length, 0);
  assert.ok(atDesk(os, 1));
  assert.ok(atDesk(os, 2));
  assert.equal(capsules(os), 0);
  assert.equal(c.sounds.n, 0);
});

test('an idle lead with no need is not sent; waiting is not a need', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  os.showWaitingBubble(1, true);
  run(os, 30);
  assert.equal(snap(os).tubeSent, 0);
  assert.equal(tubeRoutes(os).length, 0);
});

test('the tool counts and the latches of a lead that is gone are forgotten', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  askPermission(os, 1);
  assert.ok(os.toolStarts.has(1));
  waitFor(c.os, () => snap(os).tubeSent === 1, 60, 'posted');
  os.removeAgent(1);
  run(os, MATRIX_EFFECT_DURATION + 1);
  assert.ok(!os.characters.has(1));
  assert.ok(!os.toolStarts.has(1));
  const priv = os.aero as unknown as { tubeLatch: Map<number, string> };
  assert.equal(priv.tubeLatch.size, 0);
});

// ── The effect and the sound ──────────────────────────────────────

test('with Reduced Motion the effect is refused but the whoosh still plays, and the trip is counted', () => {
  const c = office(1);
  const { os } = c;
  seated(c, 1);
  os.aero.fx = new Effects(undefined, () => true);
  askPermission(os, 1);
  waitFor(os, () => snap(os).tubeSent === 1, 60, 'posted');
  assert.equal(capsules(os), 0, 'no effect');
  assert.equal(c.sounds.n, 1, 'the sound');
});

test('the capsule effect is the burst in brass and glass colours and counts as its own kind', () => {
  const fx = new Effects(undefined, () => false);
  assert.equal(fx.start('capsule', 10, 10, 3), true);
  assert.equal(fx.started.capsule, 1);
  assert.equal(fx.started.burst, undefined);
});

/** The audio the page would make: counted, and shared by every test (the sound module keeps the first context it makes). */
const audio = { contexts: 0, notes: 0 };
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    audio.contexts++;
  }
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {
        audio.notes++;
      },
      stop() {},
    };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  }
  resume() {
    return Promise.resolve();
  }
}

/** Runs `body` with the fake audio in place of the browser's. */
async function withAudio(body: () => Promise<void> | void): Promise<void> {
  const g = globalThis as unknown as { AudioContext?: unknown };
  const before = g.AudioContext;
  g.AudioContext = FakeAudioContext;
  try {
    await body();
  } finally {
    g.AudioContext = before;
  }
}

test('the whoosh plays two notes through the sound switch: none when it is off', async () => {
  await withAudio(async () => {
    setSoundEnabled(false);
    const notes = audio.notes;
    const contexts = audio.contexts;
    await playTubeSound();
    assert.equal(audio.contexts, contexts, 'no audio with the switch off');
    assert.equal(audio.notes, notes);
    setSoundEnabled(true);
    await playTubeSound();
    assert.equal(audio.notes, notes + 2, 'two notes');
  });
});

test('the office plays the page sound by default: once a trip, and nothing with the switch off', async () => {
  await withAudio(() => {
    loadCatalog();
    const os = new OfficeState(layoutOf());
    os.aero.rng = seeded(3);
    os.addAgent(1, 0, 0, LEAD_SEATS[0], true, FA);
    assert.ok(setAeroUpdate(upd(FA)));
    run(os, MATRIX_EFFECT_DURATION + 0.5);
    os.setAgentActive(1, false);
    setSoundEnabled(false);
    const quiet = audio.notes;
    askPermission(os, 1);
    waitFor(os, () => snap(os).tubeSent === 1, 60, 'posted with the switch off');
    assert.equal(audio.notes, quiet, 'no note played');
    os.clearPermissionBubble(1);
    run(os, 1);
    setSoundEnabled(true);
    os.setAgentTool(1, QUESTION);
    waitFor(os, () => snap(os).tubeSent === 2, 90, 'posted with the switch on');
    assert.equal(audio.notes, quiet + 2, 'the two notes of one whoosh');
  });
});
