/**
 * Proton, the owner's cat (docs/work/phase6-proton/plan.md, round 1: the fork): a British Shorthair, blue point, who wanders the open
 * office on the floor on show. She never takes a seat a person or a lead could need, never leaves the allowed tiles (everywhere inside
 * the turnstiles except the toilets and the lift lobby), paths on her own blocked set, and gets up the moment a seat is wanted.
 *
 * `buildWorld` is a 54x36 open office with Aero's labels: Pod 1 (a lead bench, two PC benches), a hall, the atrium with its head, the
 * terrace, the café, the toilets, security with two turnstiles, the lifts, the Lounge with unlabelled sofas and reception with a
 * sofa seen from the front and one seen from behind.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { getAeroUpdate, resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { drawAeroOverlay } from '../src/aero/overlay.js';
import {
  pickKind,
  planFor,
  PROTON_FIRST_WAIT_SEC,
  PROTON_GRIDS,
  PROTON_PALETTE,
  PROTON_SPRITES,
  protonArea,
  type ProtonMode,
  protonSpriteOf,
  SPOT_KINDS,
  type SpotKind,
  spotWeights,
  stayFor,
} from '../src/aero/proton.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { renderScene } from '../src/office/engine/renderer.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import { Direction, MATRIX_EFFECT_DURATION, TileType } from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

const COLS = 54;
const ROWS = 36;
const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';
const LEAD = 'p1-lead';
const LOUNGE_SOFAS = ['aero-0a1b2c3d-lounge-2', 'aero-0a1b2c3d-lounge-3', 'aero-0a1b2c3d-lounge-4'];
const REC_SOFA = 'rec-sofa';
const REC_BACK = 'rec-sofa-back';
const NAP_SEATS = [...LOUNGE_SOFAS, REC_SOFA];

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
  const catalog = [
    entry('PC_OFF', 'electronics', 1, 1, { groupId: 'pc', state: 'off' }),
    entry('PC_ON', 'electronics', 1, 1, { groupId: 'pc', state: 'on' }),
    entry('DESK', 'desks', 1, 1, { isDesk: true }),
    entry('CUSHIONED_BENCH', 'chairs', 1, 1),
    entry('WOODEN_BENCH', 'chairs', 1, 1),
    entry('SOFA_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('SOFA_SIDE', 'chairs', 1, 1, { orientation: 'side' }),
    entry('SOFA_BACK', 'chairs', 1, 1, { orientation: 'back' }),
    // Aero writes a mirrored side sofa as `SOFA_SIDE:left`; the page keeps that as its own type.
    entry('SOFA_SIDE:left', 'chairs', 1, 1, { orientation: 'left' }),
    entry('AERO_ELEVATOR', 'misc', 2, 2, { backgroundTiles: 1 }),
    entry('AERO_TURNSTILE', 'misc', 1, 2, { backgroundTiles: 1 }),
  ];
  const sprites = Object.fromEntries(catalog.map((c) => [c.id, sprite('#445566')]));
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
  catalogReady = true;
}

const LOUNGE_SEAT_TILES = [
  { col: 31, row: 22 },
  { col: 33, row: 22 },
  { col: 36, row: 22 },
];

function buildWorld(pieces: PlacedFurniture[] = []): OfficeState {
  loadCatalog();
  const f = (uid: string, type: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type,
    col,
    row,
  });
  const furniture: PlacedFurniture[] = [
    // Pod 1 (columns 1-7, rows 2-6): three PCs on desks, the lead's bench in the middle, a wooden bench either side.
    ...[2, 4, 6].map((c) => f(`pc-${c}`, 'PC_OFF', c, 2)),
    ...[2, 4, 6].map((c) => f(`desk-${c}`, 'DESK', c, 3)),
    f('p1-wood-a', 'WOODEN_BENCH', 2, 4),
    f(LEAD, 'CUSHIONED_BENCH', 4, 4),
    f('p1-wood-b', 'WOODEN_BENCH', 6, 4),
    // The Lounge: its pieces, then two sofas seen from the front and one from the side.
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 18),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 18),
    f(LOUNGE_SOFAS[0], 'SOFA_FRONT', LOUNGE_SEAT_TILES[0].col, LOUNGE_SEAT_TILES[0].row),
    f(LOUNGE_SOFAS[1], 'SOFA_FRONT', LOUNGE_SEAT_TILES[1].col, LOUNGE_SEAT_TILES[1].row),
    f(LOUNGE_SOFAS[2], 'SOFA_SIDE', LOUNGE_SEAT_TILES[2].col, LOUNGE_SEAT_TILES[2].row),
    // Reception: a sofa from the front and one seen from behind.
    f(REC_SOFA, 'SOFA_FRONT', 33, 29),
    f(REC_BACK, 'SOFA_BACK', 36, 29),
    // Security: the two turnstiles flanking the atrium, and the lifts below them.
    f('turn-a', 'AERO_TURNSTILE', 25, 32),
    f('turn-b', 'AERO_TURNSTILE', 28, 32),
    f('lift-0', 'AERO_ELEVATOR', 25, 34),
    f('lift-1', 'AERO_ELEVATOR', 27, 34),
    ...pieces,
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
  zone('Hall', 25, 28, 2, 6); // the head of the atrium
  zone('Hall', 1, 52, 7, 17); // the gallery and the promenade
  zone('Terrace', 1, 6, 18, 25);
  zone('Café', 7, 16, 18, 34);
  zone('Toilets', 1, 6, 28, 33);
  zone('Security', 17, 24, 28, 34);
  zone('Hall', 25, 28, 18, 34); // the atrium, down to the lobby
  zone('Lounge', 29, 39, 18, 25);
  zone('Reception', 29, 39, 26, 34);
  for (const t of LOUNGE_SEAT_TILES) areaTiles[t.row * COLS + t.col] = null; // the Lounge's seats are unlabelled
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areas: ['Pod 1', 'Hall', 'Terrace', 'Café', 'Toilets', 'Security', 'Lounge', 'Reception'].map(
      (label) => ({ label, color: AREA_LABEL_FALLBACK_COLOR }),
    ),
    areaTiles,
    pets: [],
  };
  return new OfficeState(layout);
}

const upd = (floor = FA, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents: [],
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Pod 1'] }, labels: {} },
  floor: { id: floor, number: 1, name: 'f', rooms: [floor] },
  ...extra,
});

/** The Rooms style's update: no live pods. */
function rooms(): Record<string, unknown> {
  const update = upd();
  delete update['pods'];
  return update;
}

const run = (os: OfficeState, seconds: number, dt = 0.1) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) os.update(dt);
};

/** A small seeded generator (mulberry32). */
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

/** The office with a working lead on Pod 1's bench, the update in force and the cat placed. */
function office(
  rng: () => number,
  extra: Record<string, unknown> = {},
  pieces: PlacedFurniture[] = [],
): OfficeState {
  const os = buildWorld(pieces);
  os.aero.rng = rng;
  os.addAgent(1, 0, 0, undefined, true, FA);
  os.setAgentActive(1, true);
  assert.ok(setAeroUpdate(upd(FA, extra)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.equal(os.characters.get(1)!.seatId, LEAD, 'the lead sits on the cushioned bench');
  return os;
}

const key = (c: number, r: number) => `${c},${r}`;
const cat = (os: OfficeState) => os.aero.snapshot().proton;

// ── The allowed tiles ──────────────────────────────────────────────

test('the allowed tiles: labelled, unblocked, reachable; never the toilets, the lift lobby or the turnstile throat', () => {
  const os = office(seeded(1));
  const allowed = os.aero.protonAllowed();
  assert.ok(allowed.size > 200, `a wide area, got ${allowed.size}`);
  const labelOf = (k: string) => {
    const [c, r] = k.split(',').map(Number);
    return os.layout.areaTiles![r * COLS + c];
  };
  const seatKeys = new Set([...os.seats.values()].map((s) => key(s.seatCol, s.seatRow)));
  for (const k of allowed) {
    assert.ok(!os.blockedTiles.has(k) || seatKeys.has(k), `${k} is unblocked or a seat`);
    assert.notEqual(labelOf(k), 'Toilets', `${k} is not in the toilets`);
    if (labelOf(k) === null || labelOf(k) === undefined) {
      assert.ok(
        LOUNGE_SEAT_TILES.some((t) => key(t.col, t.row) === k),
        `${k} is unlabelled, so it must be a Lounge seat`,
      );
    }
  }
  for (const t of os.aero.lobby)
    assert.ok(!allowed.has(key(t.col, t.row)), `lobby ${t.col},${t.row}`);
  for (let c = 25; c <= 28; c++) {
    for (let r = 33; r < ROWS; r++) assert.ok(!allowed.has(key(c, r)), `throat ${c},${r}`);
  }
  // The places she goes are all in.
  for (const k of ['25,2', '28,2', '3,4', '5,4', '8,21', '10,21', '8,24', '9,24', '3,20']) {
    assert.ok(allowed.has(k), `${k} is allowed`);
  }
  // A sofa seen from the front is in, one seen from behind is not a nap seat.
  assert.ok(allowed.has(key(33, 29)));
  assert.ok(allowed.has(key(31, 22)));
});

test('protonArea keeps only the largest reachable part, drops the toilets, the lobby and the turnstile rows, adds sofa seats beside it', () => {
  const cols = 8;
  const rows = 8;
  const labels: Array<string | null> = new Array(cols * rows).fill(null);
  const set = (c: number, r: number, label: string | null) => (labels[r * cols + c] = label);
  for (let c = 0; c < 6; c++) for (let r = 0; r < 4; r++) set(c, r, 'Hall');
  set(7, 0, 'Hall'); // an island nobody can reach
  set(0, 5, 'Toilets');
  set(1, 5, 'Toilets');
  set(0, 6, 'Hall'); // behind the toilets only: cut off
  for (let c = 2; c < 5; c++) set(c, 5, 'Hall'); // below the turnstile rows
  const area = protonArea({
    cols,
    rows,
    areaTiles: labels,
    blocked: new Set(['2,1']),
    lobby: [{ col: 3, row: 3 }],
    turnstiles: [
      { col: 2, row: 3, w: 1, h: 2 },
      { col: 4, row: 3, w: 1, h: 2 },
    ],
    sofaSeats: [{ col: 6, row: 1 }],
    loungeSeats: [{ col: 7, row: 6 }],
  });
  assert.ok(area.walk.has('0,0'));
  assert.ok(!area.walk.has('2,1'), 'blocked');
  assert.ok(!area.walk.has('7,0'), 'an island');
  assert.ok(!area.walk.has('0,5') && !area.walk.has('1,5'), 'toilets');
  assert.ok(!area.walk.has('0,6'), 'cut off');
  assert.ok(!area.walk.has('3,3'), 'the lobby');
  assert.ok(!area.walk.has('2,4') && !area.walk.has('3,5'), 'below the turnstile rows');
  assert.ok(area.seats.has('6,1'), 'a sofa seat beside the area');
  assert.ok(!area.seats.has('7,6'), 'a lounge seat with no neighbour in the area is not allowed');
  assert.ok(area.blocked.has('2,1') && area.blocked.has('7,0') && area.blocked.has('3,3'));
  assert.ok(!area.blocked.has('0,0'));
});

// ── When she shows ─────────────────────────────────────────────────

test('no cat without an update, in the Rooms style (no live pods) or with the Lounge off; one made first is not drawn frozen', () => {
  const off = buildWorld();
  off.aero.rng = seeded(2);
  run(off, 5);
  assert.equal(cat(off), null, 'off: no update');
  // The cat exists first, then each way of switching her off.
  const os = office(seeded(2));
  assert.notEqual(cat(os), null, 'on with pods in force');
  assert.ok(os.aero.proton, 'the cat is made');
  assert.ok(setAeroUpdate(rooms()));
  run(os, 2);
  assert.equal(getAeroUpdate()!.pods, undefined);
  assert.equal(cat(os), null, 'rooms: no pods');
  assert.equal(os.aero.protonView(), null);
  assert.ok(setAeroUpdate(upd()));
  run(os, 2);
  assert.notEqual(cat(os), null, 'back on');
  assert.ok(setAeroUpdate(upd(FA, { lounge: false })));
  run(os, 2);
  assert.equal(cat(os), null, 'lounge off: not in the snapshot');
  assert.equal(os.aero.protonView(), null, 'lounge off: not drawn');
  assert.deepEqual(os.aero.protonSprites(), []);
  assert.ok(setAeroUpdate(upd()));
  run(os, 1);
  assert.notEqual(cat(os), null, 'back on with pods in force');
});

// ── Her first moves ────────────────────────────────────────────────

test('she waits about three seconds where she is placed, then moves', () => {
  for (const seed of [3, 4, 5, 6]) {
    const os = buildWorld();
    os.aero.rng = seeded(seed);
    os.addAgent(1, 0, 0, undefined, true, FA);
    os.setAgentActive(1, true);
    assert.ok(setAeroUpdate(upd()));
    let shownAt = -1;
    let moveAt = -1;
    let at = { col: -1, row: -1 };
    for (let t = 0; t < 15; t += 0.1) {
      os.update(0.1);
      const c = cat(os);
      if (c === null) continue;
      if (shownAt < 0) {
        shownAt = t;
        at = { col: c.col, row: c.row };
      }
      if (c.mode === 'walk' || c.moves > 0) {
        moveAt = t;
        break;
      }
      assert.deepEqual({ col: c.col, row: c.row }, at, `seed ${seed}: still at ${t}`);
    }
    assert.ok(shownAt >= 0 && moveAt >= 0, `seed ${seed}: shown ${shownAt}, moved ${moveAt}`);
    const waited = moveAt - shownAt;
    assert.ok(
      waited >= PROTON_FIRST_WAIT_SEC - 0.15 && waited <= PROTON_FIRST_WAIT_SEC + 0.35,
      `seed ${seed}: waited ${waited}`,
    );
  }
});

test('she moves within ten seconds of any moment, and moves again within thirty seconds', () => {
  for (const seed of [3, 4, 5, 6]) {
    const os = office(seeded(seed));
    const baseline = cat(os)!.moves;
    let firstAt = -1;
    let secondAt = -1;
    for (let t = 0; t < 40; t += 0.1) {
      os.update(0.1);
      const moves = cat(os)!.moves;
      if (firstAt < 0 && moves > baseline) firstAt = t;
      if (firstAt >= 0 && secondAt < 0 && moves > baseline + 1 && t > firstAt + 1) secondAt = t;
    }
    assert.ok(firstAt >= 0 && firstAt <= 10, `seed ${seed}: first move at ${firstAt}`);
    assert.ok(secondAt >= 0 && secondAt <= 30, `seed ${seed}: moves again at ${secondAt}`);
  }
});

// ── Spots: weights and timings ─────────────────────────────────────

test('spot weights: sofa 25, by an agent 30, sun 15, under a desk 15, café 15, and 35 at lunch', () => {
  assert.deepEqual(SPOT_KINDS, ['agent', 'sofa', 'sun', 'desk', 'cafe']);
  assert.deepEqual(spotWeights(false), { agent: 30, sofa: 25, sun: 15, desk: 15, cafe: 15 });
  assert.deepEqual(spotWeights(true), { agent: 30, sofa: 25, sun: 15, desk: 15, cafe: 35 });
});

test('pickKind follows the weights with a seeded rng, renormalised over the kinds that have a spot', () => {
  const draw = (available: SpotKind[], lunch: boolean, n = 20000) => {
    const rng = seeded(7);
    const counts: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const k = pickKind(rng, new Set(available), lunch)!;
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  };
  const near = (got: number | undefined, share: number, n: number) =>
    Math.abs((got ?? 0) / n - share) < 0.015;
  const all = draw([...SPOT_KINDS], false);
  const total = 100;
  for (const [kind, w] of Object.entries(spotWeights(false))) {
    assert.ok(near(all[kind], w / total, 20000), `${kind}: ${all[kind]}`);
  }
  const lunch = draw([...SPOT_KINDS], true);
  const lunchTotal = 30 + 25 + 15 + 15 + 35;
  assert.ok(near(lunch['cafe'], 35 / lunchTotal, 20000), `cafe at lunch: ${lunch['cafe']}`);
  assert.ok((lunch['cafe'] ?? 0) > (all['cafe'] ?? 0), 'more begging at lunch');
  const few = draw(['sofa', 'sun'], false);
  assert.ok(near(few['sofa'], 25 / 40, 20000) && near(few['sun'], 15 / 40, 20000), 'renormalised');
  assert.equal(Object.keys(few).length, 2);
  assert.equal(pickKind(seeded(1), new Set(), false), null, 'no spot at all');
});

test('stays last 10 to 20 seconds, capped by what she does there; a nap is knead then sleep, never over 20', () => {
  const rng = seeded(8);
  const caps: Record<SpotKind, number> = { agent: 15, sofa: 20, sun: 20, desk: 12, cafe: 10 };
  for (const kind of SPOT_KINDS) {
    for (let i = 0; i < 300; i++) {
      const stay = stayFor(kind, rng);
      assert.ok(stay >= 10 - 1e-9 && stay <= caps[kind] + 1e-9, `${kind} stay ${stay}`);
      const plan = planFor(kind, stay);
      const sum = plan.reduce((a, p) => a + p.secs, 0);
      assert.ok(Math.abs(sum - stay) < 1e-6, `${kind}: phases add up to the stay`);
      assert.ok(sum <= 20 + 1e-9);
      for (const p of plan) assert.ok(p.secs > 0, `${kind} ${p.mode} lasts`);
    }
  }
  const nap = planFor('sofa', 18);
  assert.deepEqual(
    nap.map((p) => p.mode),
    ['knead', 'sleep'],
  );
  assert.equal(nap[0].secs, 4);
  assert.equal(nap[1].secs, 14);
  assert.deepEqual(
    planFor('sun', 15).map((p) => p.mode),
    ['stretch', 'sleep'],
  );
});

// ── The long run: where she goes and what she takes ────────────────

interface Watch {
  kinds: Set<string>;
  seats: Set<string>;
  moves: number;
  stays: number[];
  bad: string[];
}

/** Runs `seconds` and records where she is, the kinds of spot she goes to and the length of each stay. */
function watch(os: OfficeState, seconds: number): Watch {
  const allowed = os.aero.protonAllowed();
  const out: Watch = { kinds: new Set(), seats: new Set(), moves: 0, stays: [], bad: [] };
  let still = 0;
  let spot: string | null = null;
  const closeStay = () => {
    if (still > 0 && spot !== null) out.stays.push(still);
    still = 0;
  };
  for (let t = 0; t < seconds; t += 0.1) {
    os.update(0.1);
    const p = os.aero.proton!;
    if (!allowed.has(key(p.col, p.row))) out.bad.push(`off the allowed tiles at ${p.col},${p.row}`);
    if (p.spot) out.kinds.add(p.spot);
    if (p.seat) out.seats.add(p.seat);
    if (p.mode === 'walk') {
      closeStay();
      spot = p.spot;
    } else {
      still += 0.1;
    }
  }
  closeStay();
  out.moves = os.aero.proton!.moves;
  return out;
}

test('over minutes she stays on the allowed tiles, visits every kind of spot, and every stay is 10 to 20 seconds', () => {
  const seen = new Set<string>();
  for (const seed of [11, 12, 13]) {
    const os = office(seeded(seed));
    const w = watch(os, 500);
    assert.deepEqual(w.bad, [], `seed ${seed}`);
    for (const k of w.kinds) seen.add(k);
    assert.ok(w.moves > 60, `seed ${seed}: she wanders, got ${w.moves} tiles`);
    assert.ok(w.stays.length > 10);
    // The first wait (3 s) is not a stay at a spot; the rest are.
    for (const s of w.stays) assert.ok(s <= 20.3, `seed ${seed}: a stay of ${s}`);
    const real = w.stays.filter((s) => s >= 9.8);
    assert.ok(real.length >= w.stays.length - 2, `seed ${seed}: stays ${w.stays.join()}`);
  }
  assert.deepEqual([...seen].sort(), [...SPOT_KINDS].sort());
});

test('she is never on the toilets or the lift lobby, whatever the seed', () => {
  for (const seed of [21, 22, 23, 24]) {
    const os = office(seeded(seed));
    const lobby = new Set(os.aero.lobby.map((t) => key(t.col, t.row)));
    for (let t = 0; t < 400; t += 0.1) {
      os.update(0.1);
      const p = os.aero.proton!;
      assert.ok(!lobby.has(key(p.col, p.row)), `seed ${seed}: lobby at ${t}`);
      assert.ok(!(p.col >= 25 && p.col <= 28 && p.row >= 33), `seed ${seed}: throat at ${t}`);
      const label = os.layout.areaTiles![p.row * COLS + p.col];
      assert.notEqual(label, 'Toilets', `seed ${seed}: toilets at ${t}`);
    }
  }
});

test('she naps only on a sofa seen from the front or the side, never behind a sofa back', () => {
  const seats = new Set<string>();
  for (const seed of [31, 32, 33, 34, 35]) {
    const os = office(seeded(seed));
    const w = watch(os, 500);
    for (const s of w.seats) seats.add(s);
  }
  assert.ok(seats.size > 0, 'she naps somewhere');
  for (const s of seats) assert.ok(NAP_SEATS.includes(s), `a nap seat: ${s}`);
  assert.ok(!seats.has(REC_BACK));
});

test('she naps only on a free seat: not on one that is assigned, routed to, or held by a lead', () => {
  // Every sofa but the reception one is held; she can only ever take that one.
  const os = office(seeded(41));
  for (const s of LOUNGE_SOFAS) os.seats.get(s)!.assigned = true;
  const w = watch(os, 600);
  assert.deepEqual(w.bad, []);
  assert.ok(
    [...w.seats].every((s) => s === REC_SOFA),
    `seats: ${[...w.seats].join()}`,
  );
  assert.ok(w.seats.has(REC_SOFA), 'and she does take it');
  // Now it is held too: no nap seat at all.
  const none = office(seeded(42));
  for (const s of NAP_SEATS) none.seats.get(s)!.assigned = true;
  const w2 = watch(none, 600);
  assert.equal(w2.seats.size, 0);
  assert.ok(!w2.kinds.has('sofa'));
});

test('she never naps on the tile of a seat a lead is routed to', () => {
  // Two idle leads go to the Lounge on their own; the cat naps on the sofas they have not taken.
  const os = office(seeded(43));
  os.setAgentActive(1, false);
  os.addAgent(2, 0, 0, undefined, true, FA);
  os.addAgent(3, 0, 0, undefined, true, FA);
  let routed = 0;
  let napped = 0;
  for (let t = 0; t < 400; t += 0.1) {
    os.update(0.1);
    const p = os.aero.proton!;
    if (os.aero.routes.size > 0) routed++;
    if (p.seat === null || (p.mode !== 'sleep' && p.mode !== 'knead')) continue;
    napped++;
    for (const r of os.aero.routes.values()) {
      assert.ok(
        !(r.target.col === p.col && r.target.row === p.row),
        `a route to her nap seat at ${t}`,
      );
    }
  }
  assert.ok(routed > 0, 'leads were routed');
  assert.ok(napped > 0, 'she napped while leads were routed');
});

// ── Giving up a seat ───────────────────────────────────────────────

/** Naps with a rng that always picks the sofa kind (r = 0.4 lies in the sofa's band); returns once she sleeps on a seat. */
function napping(): { os: OfficeState; seat: string } {
  const os = office(() => 0.4);
  for (let t = 0; t < 120; t += 0.1) {
    os.update(0.1);
    const p = os.aero.proton!;
    if (p.seat !== null && (p.mode === 'sleep' || p.mode === 'knead')) {
      return { os, seat: p.seat };
    }
  }
  assert.fail('she never napped');
}

test('she gets up the tick a seat is gone: assigned, routed to, or a character stands on it', () => {
  {
    const { os, seat } = napping();
    os.seats.get(seat)!.assigned = true;
    os.update(0.1);
    const p = os.aero.proton!;
    assert.notEqual(p.seat, seat, 'assigned: she let go of it');
    assert.ok(!(p.mode === 'sleep' && p.seat === seat));
  }
  {
    const { os, seat } = napping();
    const s = os.seats.get(seat)!;
    os.aero.routes.set(1, {
      mode: 'rest',
      target: { col: s.seatCol, row: s.seatRow },
      seatUid: seat,
      arrived: false,
      tries: 0,
    });
    os.aero.afterTick(0.1);
    assert.notEqual(os.aero.proton!.seat, seat, 'routed: she let go of it');
  }
  {
    const { os, seat } = napping();
    const s = os.seats.get(seat)!;
    const lead = os.characters.get(1)!;
    lead.tileCol = s.seatCol;
    lead.tileRow = s.seatRow;
    os.aero.afterTick(0.1);
    assert.notEqual(os.aero.proton!.seat, seat, 'a character on it: she let go of it');
  }
});

test('a layout rebuild drops her seat and puts her on a walk tile, not on the seat she held', () => {
  const { os, seat } = napping();
  const seatTiles = new Set([...os.seats.values()].map((x) => key(x.seatCol, x.seatRow)));
  assert.ok(seatTiles.has(key(os.aero.proton!.col, os.aero.proton!.row)), 'she sleeps on a seat');
  os.rebuildFromLayout(os.getLayout());
  os.aero.snapshot(); // a refresh, without a step
  const p = os.aero.proton!;
  assert.ok(os.aero.protonAllowed().has(key(p.col, p.row)), 'on an allowed tile');
  assert.ok(!seatTiles.has(key(p.col, p.row)), 'on a walk tile, not a seat');
  assert.equal(p.seat, null, 'she holds no seat');
  os.update(0.1);
  const q = os.aero.proton!;
  assert.ok(q.seat === null || q.mode === 'walk', `${seat} is not held on: ${q.seat} ${q.mode}`);
});

test('protonAllowed only reads: it does not refresh her away', () => {
  const { os, seat } = napping();
  const before = os.aero.proton!;
  assert.equal(before.seat, seat);
  // A rebuilt layout is refreshed by a tick or a snapshot; a read alone must not do it (and so must not reset her).
  os.rebuildFromLayout(os.getLayout());
  os.aero.protonAllowed();
  os.aero.protonAllowed();
  assert.equal(os.aero.proton!.seat, seat, 'still holds her seat');
  assert.ok(before.mode === 'sleep' || before.mode === 'knead');
});

test('pre-empted mid-walk she finishes the step to the next tile and then decides again; she never snaps back or lands on the seat', () => {
  const os = office(() => 0.4);
  let seat: string | null = null;
  for (let t = 0; t < 200 && seat === null; t += 0.1) {
    os.update(0.1);
    const p = os.aero.proton!;
    const mid = (p.x - 8) % 16 !== 0 || (p.y - 8) % 16 !== 0;
    // Far from the seat (at least three tiles to go) and between two tiles.
    if (p.mode === 'walk' && p.seat !== null && mid) {
      const s = os.seats.get(p.seat)!;
      if (Math.abs(s.seatCol - p.col) + Math.abs(s.seatRow - p.row) >= 3) seat = p.seat;
    }
  }
  assert.ok(seat, 'she walks to a nap seat');
  const p = os.aero.proton!;
  const from = { x: p.x, y: p.y, col: p.col, row: p.row, moves: p.moves };
  os.seats.get(seat!)!.assigned = true;
  os.update(0.1);
  const q = os.aero.proton!;
  assert.notEqual(q.seat, seat, 'she let go of the seat');
  const aCentre = { x: from.col * 16 + 8, y: from.row * 16 + 8 };
  assert.ok(q.x !== aCentre.x || q.y !== aCentre.y, 'not snapped back to her last whole tile');
  assert.ok(
    Math.hypot(q.x - aCentre.x, q.y - aCentre.y) >=
      Math.hypot(from.x - aCentre.x, from.y - aCentre.y),
    'she kept going forward',
  );
  const s = os.seats.get(seat!)!;
  for (let t = 0; t < 4; t += 0.1) {
    os.update(0.1);
    const r = os.aero.proton!;
    assert.ok(!(r.col === s.seatCol && r.row === s.seatRow), 'never on the vacated seat');
  }
  assert.ok(os.aero.proton!.moves > from.moves);
});

test('a side sofa Aero writes as SOFA_SIDE:left is a nap seat too', () => {
  const left = { uid: 'rec-left', type: 'SOFA_SIDE:left', col: 31, row: 29 };
  const os = office(seeded(45), {}, [left]);
  for (const s of NAP_SEATS) os.seats.get(s)!.assigned = true;
  assert.ok(os.seats.has('rec-left'), 'the piece is a seat');
  assert.ok(os.aero.protonAllowed().has(key(31, 29)), 'and an allowed tile');
  const w = watch(os, 600);
  assert.deepEqual(w.bad, []);
  assert.ok(w.seats.has('rec-left'), `seats: ${[...w.seats].join()}`);
  assert.ok([...w.seats].every((x) => x === 'rec-left'));
});

// ── One cat across floors ──────────────────────────────────────────

test('there is one Proton: the same cat, unmoved by a floor switch, still on show', () => {
  const os = office(seeded(51));
  run(os, 20);
  const before = os.aero.proton;
  assert.ok(before);
  const where = { col: before.col, row: before.row, moves: before.moves };
  assert.ok(setAeroUpdate(upd(FB)));
  os.update(0.1);
  const after = cat(os);
  assert.ok(after, 'shown after the switch');
  assert.equal(os.aero.proton, before, 'the same cat');
  assert.ok(Math.abs(after.col - where.col) + Math.abs(after.row - where.row) <= 1, 'unmoved');
  assert.ok(after.moves >= where.moves);
  run(os, 60);
  assert.ok(cat(os)!.moves > where.moves, 'she keeps wandering on the new floor');
});

// ── The snapshot ───────────────────────────────────────────────────

test('the snapshot has proton {col,row,mode,moves,seat,spot} and each lead’s seat id', () => {
  const os = office(seeded(61));
  const snap = os.aero.snapshot();
  assert.deepEqual(
    Object.keys(snap.proton!).sort(),
    ['col', 'moves', 'mode', 'row', 'seat', 'spot'].sort(),
  );
  assert.equal(typeof snap.proton!.col, 'number');
  assert.equal(snap.proton!.seat, null);
  const lead = snap.leads.find((l) => l.id === 1)!;
  assert.equal(lead.seat, LEAD);
  run(os, 200);
  const later = os.aero.snapshot().proton!;
  assert.ok(later.moves > 0);
  assert.ok(['walk', 'sit', 'sleep', 'groom', 'stretch', 'knead'].includes(later.mode));
});

// ── Her look ───────────────────────────────────────────────────────

test('her sprite grids are whole: 16x16, in the palette, every action with three frames, and the look of a blue point', () => {
  const modes: ProtonMode[] = ['sit', 'sleep', 'groom', 'stretch', 'knead'];
  const names = ['walkDown', 'walkUp', 'walkRight', ...modes];
  assert.deepEqual(Object.keys(PROTON_GRIDS).sort(), [...names].sort());
  const palette = new Set(Object.keys(PROTON_PALETTE));
  for (const name of names) {
    const frames = PROTON_GRIDS[name as keyof typeof PROTON_GRIDS];
    assert.equal(frames.length, 3, `${name} has three frames`);
    for (const [i, map] of frames.entries()) {
      assert.equal(map.length, 16, `${name}[${i}] rows`);
      for (const row of map) {
        assert.equal(row.length, 16, `${name}[${i}] row width`);
        for (const ch of row) assert.ok(ch === '.' || palette.has(ch), `${name}[${i}] has ${ch}`);
      }
      assert.ok(map.join('').replace(/\./g, '').length > 40, `${name}[${i}] is drawn`);
    }
  }
  const colours = Object.values(PROTON_PALETTE).map((c) => c.toLowerCase());
  for (const c of ['#f5efe2', '#6b7a8f', '#4e5b6e', '#4fa3e3', '#d98695', '#3f3740']) {
    assert.ok(colours.includes(c), `palette has ${c}`);
  }
  // Decoded once: the same array object every time (the sprite cache keys on it), left frames flipped from the right ones.
  const a = protonSpriteOf('walk', Direction.LEFT, 0);
  assert.equal(protonSpriteOf('walk', Direction.LEFT, 0), a);
  const right = protonSpriteOf('walk', Direction.RIGHT, 0);
  assert.equal(a.length, 16);
  assert.deepEqual(a[5], [...right[5]].reverse());
  for (const dir of [Direction.DOWN, Direction.UP, Direction.LEFT, Direction.RIGHT]) {
    assert.equal(PROTON_SPRITES.walk[dir].length, 3);
    for (const f of PROTON_SPRITES.walk[dir]) assert.equal(f.length, 16);
  }
  // A blue point: blue eyes and blue-grey ears on the front view.
  const front = PROTON_SPRITES.walk[Direction.DOWN][0].flat();
  assert.ok(front.includes('#4fa3e3'), 'blue eyes');
  assert.ok(front.includes('#6b7a8f'), 'blue-grey points');
  assert.ok(front.includes('#f5efe2'), 'a cream body');
});

// ── Drawing ────────────────────────────────────────────────────────

function stubCanvas(): void {
  const g = globalThis as unknown as { document?: unknown };
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
    }),
  };
}

test('renderScene draws extra sprites z-sorted with the rest, anchored bottom-centre', () => {
  stubCanvas();
  const drawn: Array<{ tag: string; x: number; y: number }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'drawImage')
          return (img: { tag?: string }, x: number, y: number) => {
            drawn.push({ tag: String(img.tag ?? ''), x, y });
          };
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  const sprite16 = (c: string) => Array.from({ length: 16 }, () => new Array<string>(16).fill(c));
  const near = sprite16('#333333');
  const far = sprite16('#444444');
  renderScene(
    ctx,
    [],
    [],
    10,
    20,
    2,
    null,
    null,
    [],
    [
      { sprite: near, x: 40, y: 64, zY: 72 },
      { sprite: far, x: 24, y: 32, zY: 40 },
    ],
  );
  assert.equal(drawn.length, 2);
  // Sorted by zY: the far one first. Bottom-centre at (x, y): zoom 2, so a 32 px wide sprite.
  assert.deepEqual(
    [drawn[0].x, drawn[0].y],
    [Math.round(10 + 24 * 2 - 16), Math.round(20 + 32 * 2 - 32)],
  );
  assert.deepEqual(
    [drawn[1].x, drawn[1].y],
    [Math.round(10 + 40 * 2 - 16), Math.round(20 + 64 * 2 - 32)],
  );
});

test('her name, Proton, is drawn over her like the people’s names, only while she is on show', () => {
  const texts = (os: OfficeState): string[] => {
    const out: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'fillText') return (text: string) => out.push(text);
          if (prop === 'measureText') return () => ({ width: 8 });
          return () => undefined;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    drawAeroOverlay(ctx, os, 0, 0, 2);
    return out;
  };
  const os = office(seeded(71));
  assert.ok(texts(os).includes('Proton'));
  const names = os.aero.labels(true).map((l) => `${l.first}`);
  assert.ok(!names.includes('Proton'), 'she is not among the labels');
  assert.ok(setAeroUpdate(rooms()));
  os.update(0.1);
  assert.ok(!texts(os).includes('Proton'), 'no cat in the Rooms style');
});

test('the view she is drawn from: her sprite, her pixel position, z-sorted by her row’s bottom edge', () => {
  const os = office(seeded(72));
  const v = os.aero.protonView()!;
  assert.ok(v);
  const p = os.aero.proton!;
  assert.equal(v.x, p.x);
  assert.equal(v.zY, p.y + 8);
  assert.equal(v.sprite.length, 16);
  assert.ok(setAeroUpdate(rooms()));
  os.update(0.1);
  assert.equal(os.aero.protonView(), null);
  assert.deepEqual(os.aero.protonSprites(), []);
});

// ── What a sped-up frame must not hide ───────────────────────────

test('the snapshot latches the tiles she stood on outside her area since the last read, whatever the frame rate', () => {
  const os = office(seeded(71), { timeScale: 8 });
  run(os, 20, 0.05);
  assert.deepEqual(os.aero.snapshot().protonStray, [], 'she wanders inside her area');
  const area = (os.aero as unknown as { area: { walk: Set<string>; seats: Set<string> } }).area;
  let bad: { col: number; row: number } | null = null;
  for (let r = 0; r < ROWS && !bad; r++) {
    for (let c = 0; c < COLS && !bad; c++) {
      if (!area.walk.has(key(c, r)) && !area.seats.has(key(c, r))) bad = { col: c, row: r };
    }
  }
  assert.ok(bad, 'the layout has a tile outside her area');
  os.aero.proton!.place(bad);
  // One frame (eight sub-steps) is all it takes: she leaves the tile again within it, and the snapshot still says she stood there.
  os.update(0.05);
  const stray = os.aero.snapshot().protonStray;
  assert.ok(stray.includes(key(bad.col, bad.row)), `latched ${stray.join(' ')}`);
  assert.deepEqual(os.aero.snapshot().protonStray, [], 'read and cleared');
});
