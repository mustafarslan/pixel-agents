/**
 * Breaks and café lunch (docs/work/phase6-breaks/plan.md, round 1: the fork).
 *
 * `buildWorld` is a 54x36 open office with the pieces Aero's layout has for the breaks: a pod with a lead's benches and a water
 * cooler, the café (coffee machine, buffet counter, four bar stools, two tables for four), the terrace (two ashtray stands, two
 * benches), two vending machines (the Hall's and the Fun room's), and the Lounge with a table and three sofas. The rng is injected and
 * either seeded or fixed: `pickRoutine` draws breaks in the order cooler, coffee, vending, smoke from the bottom, so a fixed 0.05 is
 * the cooler, 0.2 coffee, 0.33 vending and 0.45 a smoke, and anything from 0.5 up the Lounge.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { drawAeroOverlay } from '../src/aero/overlay.js';
import {
  BAR_SEC,
  BREAK_KINDS,
  BUFFET_SEC,
  COFFEE_SEC,
  COOLER_SEC,
  PICK_MAX_SEC,
  PICK_MIN_SEC,
  pickDelay,
  pickRoutine,
  pruneCooldowns,
  SMOKE_COOLDOWN_SEC,
  smokeAllowed,
  smokeSeconds,
  VENDING_SEC,
} from '../src/aero/routines.js';
import { buildStations } from '../src/aero/stations.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  MATRIX_EFFECT_DURATION,
  TileType,
} from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

const COLS = 54;
const ROWS = 36;
const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';
const LEAD_SEATS = ['lead-1', 'lead-2', 'lead-3', 'lead-4', 'lead-5'];
const LOUNGE_SOFAS = ['aero-0a1b2c3d-lounge-2', 'aero-0a1b2c3d-lounge-3', 'aero-0a1b2c3d-lounge-4'];
const BAR = [11, 12, 13, 14].map((c) => ({ col: c, row: 24 }));
const BUFFET = [
  { col: 8, row: 24 },
  { col: 9, row: 24 },
];
const COOLER_FRONT = { col: 7, row: 4 };
const COFFEE_FRONT = { col: 10, row: 21 };
const ASHTRAYS = [
  { col: 3, row: 21 },
  { col: 3, row: 24 },
];
const TERRACE_BENCHES = [
  { col: 5, row: 20 },
  { col: 5, row: 23 },
];
const VENDING_FRONTS = [
  { col: 9, row: 28 },
  { col: 42, row: 21 },
];
const DINING = [
  [13, 26],
  [13, 29],
  [12, 28],
  [15, 28],
  [13, 31],
  [13, 34],
  [12, 33],
  [15, 33],
].map(([col, row]) => ({ col, row }));

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
    entry('WOODEN_CHAIR_FRONT', 'chairs', 1, 2, { orientation: 'front', backgroundTiles: 1 }),
    entry('WOODEN_CHAIR_BACK', 'chairs', 1, 2, { orientation: 'back', backgroundTiles: 1 }),
    entry('WOODEN_CHAIR_SIDE', 'chairs', 1, 2, { orientation: 'side', backgroundTiles: 1 }),
    entry('WOODEN_CHAIR_SIDE:left', 'chairs', 1, 2, { orientation: 'left', backgroundTiles: 1 }),
    entry('SMALL_TABLE_FRONT', 'furniture', 2, 2, { backgroundTiles: 1 }),
    entry('COFFEE_TABLE', 'furniture', 2, 2),
    entry('WHITEBOARD', 'decor', 2, 2),
    entry('CLOCK', 'decor', 1, 2),
    entry('AERO_WATERCOOLER', 'misc', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_COFFEE_MACHINE', 'misc', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_BUFFET_COUNTER', 'misc', 2, 2, { backgroundTiles: 1 }),
    entry('AERO_VENDING_MACHINE', 'misc', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_ASHTRAY_STAND', 'misc', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_ELEVATOR', 'misc', 2, 2, { backgroundTiles: 1 }),
    entry('AERO_TURNSTILE', 'misc', 1, 2, { backgroundTiles: 1 }),
  ];
  const sprites = Object.fromEntries(catalog.map((c) => [c.id, sprite('#445566')]));
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
  catalogReady = true;
}

interface WorldOptions {
  /** Where the coffee machine's top-left is. */
  coffee?: { col: number; row: number };
  /** No dining tables: only the four bar stools are café seats. */
  noDining?: boolean;
  /** Tiles that are walls, to wall a seat off. */
  walls?: Array<{ col: number; row: number }>;
}

function buildWorld(opts: WorldOptions = {}): OfficeState {
  loadCatalog();
  const f = (uid: string, type: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type,
    col,
    row,
  });
  const coffee = opts.coffee ?? { col: 10, row: 19 };
  const dining = (n: number, x: number, y: number): PlacedFurniture[] => [
    f(`dining-${n}-t`, 'SMALL_TABLE_FRONT', x, y),
    f(`dining-${n}-n`, 'WOODEN_CHAIR_FRONT', x, y - 2),
    f(`dining-${n}-s`, 'WOODEN_CHAIR_BACK', x, y + 1),
    f(`dining-${n}-w`, 'WOODEN_CHAIR_SIDE', x - 1, y),
    f(`dining-${n}-e`, 'WOODEN_CHAIR_SIDE:left', x + 2, y),
  ];
  const furniture: PlacedFurniture[] = [
    // Pod 1 (columns 1-7, rows 2-6): PCs on desks, five lead benches, a water cooler at the east edge.
    ...[2, 4, 6].map((c) => f(`pc-${c}`, 'PC_OFF', c, 2)),
    ...[2, 4, 6].map((c) => f(`desk-${c}`, 'DESK', c, 3)),
    ...LEAD_SEATS.map((uid, i) => f(uid, 'CUSHIONED_BENCH', 2 + i, 6)),
    f('p1-wood-a', 'WOODEN_BENCH', 2, 4),
    f('p1-wood-b', 'WOODEN_BENCH', 6, 4),
    f('pod-cooler', 'AERO_WATERCOOLER', 7, 2),
    // The Lounge: whiteboard, clock, three sofas and a table.
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 18),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 18),
    f(LOUNGE_SOFAS[0], 'SOFA_FRONT', 31, 22),
    f(LOUNGE_SOFAS[1], 'SOFA_FRONT', 33, 22),
    f(LOUNGE_SOFAS[2], 'SOFA_SIDE', 36, 22),
    f('aero-0a1b2c3d-lounge-5', 'COFFEE_TABLE', 34, 20),
    // The café.
    f('coffee-machine', 'AERO_COFFEE_MACHINE', coffee.col, coffee.row),
    f('buffet', 'AERO_BUFFET_COUNTER', 8, 22),
    ...[11, 12, 13, 14].map((c) => f(`stool-${c}`, 'WOODEN_BENCH', c, 24)),
    ...(opts.noDining ? [] : [...dining(1, 13, 27), ...dining(2, 13, 32)]),
    // The terrace.
    f('ashtray-a', 'AERO_ASHTRAY_STAND', 3, 19),
    f('ashtray-b', 'AERO_ASHTRAY_STAND', 3, 22),
    f('terrace-bench-a', 'WOODEN_BENCH', 5, 20),
    f('terrace-bench-b', 'WOODEN_BENCH', 5, 23),
    // The vending machines.
    f('vending-hall', 'AERO_VENDING_MACHINE', 9, 26),
    f('vending-fun', 'AERO_VENDING_MACHINE', 42, 19),
    // Security: the turnstiles and the lifts.
    f('turn-a', 'AERO_TURNSTILE', 25, 32),
    f('turn-b', 'AERO_TURNSTILE', 28, 32),
    f('lift-0', 'AERO_ELEVATOR', 25, 34),
    f('lift-1', 'AERO_ELEVATOR', 27, 34),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
  zone('Hall', 25, 28, 2, 6);
  zone('Hall', 1, 52, 7, 17);
  zone('Terrace', 1, 6, 18, 25);
  zone('Café', 7, 16, 18, 34);
  zone('Hall', 9, 10, 26, 33); // the passage the Hall's vending machine stands in
  zone('Toilets', 1, 6, 28, 33);
  zone('Security', 17, 24, 28, 34);
  zone('Hall', 25, 28, 18, 34);
  zone('Lounge', 29, 39, 18, 25);
  zone('Reception', 29, 39, 26, 34);
  zone('Fun', 40, 52, 18, 34);
  // As in Aero's layout: the Fun room's wall at (42..50, 18..19) carries its vending machine, and the wall is unlabelled.
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  for (let r = 18; r <= 19; r++) {
    for (let c = 42; c <= 50; c++) {
      tiles[r * COLS + c] = TileType.WALL;
      areaTiles[r * COLS + c] = null;
    }
  }
  for (const uid of LOUNGE_SOFAS) {
    const piece = furniture.find((p) => p.uid === uid)!;
    areaTiles[piece.row * COLS + piece.col] = null; // the Lounge's seats are unlabelled
  }
  for (const w of opts.walls ?? []) tiles[w.row * COLS + w.col] = TileType.WALL;
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture,
    areas: [
      'Pod 1',
      'Hall',
      'Terrace',
      'Café',
      'Toilets',
      'Security',
      'Lounge',
      'Reception',
      'Fun',
    ].map((label) => ({ label, color: AREA_LABEL_FALLBACK_COLOR })),
    areaTiles,
    pets: [],
  };
  return new OfficeState(layout);
}

const person = (slug: string, floor: string) => ({ name: slug, slug, floor });
const STAFF_A = ['reviewer', 'architect', 'tester', 'writer', 'planner', 'scout'].map((s) =>
  person(s, FA),
);
const STAFF_B = ['debugger', 'designer', 'analyst'].map((s) => person(s, FB));

const upd = (
  floor: string,
  agents: unknown[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents,
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Pod 1'] }, labels: {} },
  floor: { id: floor, number: 1, name: 'f', rooms: [floor] },
  ...extra,
});

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

const fixed = (v: number) => () => v;
const DT = 0.1;
/** How long a lead at the Lounge table takes to notice a free café seat: its recheck, three seconds, and the walk. */
const LUNCH_WAIT = 12;

/** Runs `seconds` of the office. */
function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) os.update(DT);
}

/** Runs until `done` holds; returns the seconds it took. Fails after `max`. */
function waitFor(os: OfficeState, done: () => boolean, max: number, what: string): number {
  let t = 0;
  for (; t < max; t += DT) {
    if (done()) return t;
    os.update(DT);
  }
  assert.ok(done(), `${what} within ${max}s`);
  return t;
}

interface Setup {
  /** Leads on idle, one per seat of `LEAD_SEATS`. */
  leads?: number;
  agents?: unknown[];
  lunch?: boolean;
  floor?: string;
  rng: () => number;
  opts?: WorldOptions;
}

/** The office with `leads` idle leads at their desks and the update in force, the people made and standing. */
function office(s: Setup): OfficeState {
  const os = buildWorld(s.opts);
  os.aero.rng = s.rng;
  for (let i = 0; i < (s.leads ?? 0); i++) os.addAgent(i + 1, 0, 0, LEAD_SEATS[i], true, FA);
  assert.ok(setAeroUpdate(upd(s.floor ?? FA, s.agents ?? [], { lunch: s.lunch === true })));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  for (let i = 0; i < (s.leads ?? 0); i++) os.setAgentActive(i + 1, false);
  return os;
}

const snap = (os: OfficeState) => os.aero.snapshot();
const lead = (os: OfficeState, id: number) => snap(os).leads.find((l) => l.id === id)!;
const staffNamed = (os: OfficeState, slug: string) => snap(os).people.find((p) => p.slug === slug)!;
const key = (t: { col: number; row: number }) => `${t.col},${t.row}`;
const tileOf = (os: OfficeState, id: number) => {
  const c = os.characters.get(id)!;
  return { col: c.tileCol, row: c.tileRow };
};
const inList = (list: Array<{ col: number; row: number }>, t: { col: number; row: number }) =>
  list.some((x) => x.col === t.col && x.row === t.row);

// ── The pure part ──────────────────────────────────────────────────

test('the weights: about half the picks are a break, the four kinds in their shares, none that cannot be had', () => {
  const rng = seeded(11);
  const all = { cooler: true, coffee: true, vending: true, smoke: true };
  const counts: Record<string, number> = {};
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const k = pickRoutine(rng, all);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const breaks = N - (counts['lounge'] ?? 0);
  assert.ok(breaks / N > 0.47 && breaks / N < 0.53, `about half are breaks, got ${breaks / N}`);
  for (const [kind, share] of [
    ['cooler', 0.14],
    ['coffee', 0.14],
    ['vending', 0.1],
    ['smoke', 0.12],
  ] as const) {
    assert.ok(Math.abs(counts[kind] / N - share) < 0.02, `${kind}: ${counts[kind] / N}`);
  }
  // A kind that cannot be had is never drawn, and the Lounge gets its share.
  const none = { cooler: false, coffee: true, vending: false, smoke: false };
  const rng2 = seeded(12);
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) seen.add(pickRoutine(rng2, none));
  assert.deepEqual([...seen].sort(), ['coffee', 'lounge']);
  assert.equal(pickRoutine(fixed(0.99), {}), 'lounge');
  // The fixed values this file relies on.
  assert.equal(pickRoutine(fixed(0.05), all), 'cooler');
  assert.equal(pickRoutine(fixed(0.2), all), 'coffee');
  assert.equal(pickRoutine(fixed(0.33), all), 'vending');
  assert.equal(pickRoutine(fixed(0.45), all), 'smoke');
  assert.equal(pickRoutine(fixed(0.5), all), 'lounge');
  assert.deepEqual([...BREAK_KINDS], ['cooler', 'coffee', 'vending', 'smoke']);
});

test('the timing: a pick every 25 to 45 s, smokes of 10 to 14 s, the stays of the plan', () => {
  const rng = seeded(5);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const d = pickDelay(rng);
    min = Math.min(min, d);
    max = Math.max(max, d);
    const s = smokeSeconds(rng);
    assert.ok(s >= 10 && s <= 14, `smoke ${s}`);
  }
  assert.ok(min >= PICK_MIN_SEC && max <= PICK_MAX_SEC);
  assert.ok(min < 26 && max > 44, 'the whole range is used');
  assert.deepEqual([PICK_MIN_SEC, PICK_MAX_SEC], [25, 45]);
  assert.deepEqual([COOLER_SEC, COFFEE_SEC, BAR_SEC, VENDING_SEC, BUFFET_SEC], [4, 4, 8, 4, 2.5]);
});

test('smoking: at most two at once, and the same person not again within three minutes', () => {
  assert.equal(smokeAllowed(0, undefined, 0), true);
  assert.equal(smokeAllowed(1, undefined, 0), true);
  assert.equal(smokeAllowed(2, undefined, 0), false, 'the cap');
  assert.equal(smokeAllowed(0, 100, 100 + SMOKE_COOLDOWN_SEC - 0.1), false);
  assert.equal(smokeAllowed(0, 100, 100 + SMOKE_COOLDOWN_SEC), true);
  assert.equal(SMOKE_COOLDOWN_SEC, 180);
  const smoked = new Map([
    [1, 0],
    [2, 100],
  ]);
  pruneCooldowns(smoked, 185);
  assert.deepEqual([...smoked.keys()], [2], 'the one past its cooldown is forgotten');
});

// ── The targets ────────────────────────────────────────────────────

test('the targets are found from the layout, each with its facing; a moved piece moves its target', () => {
  const os = buildWorld();
  const b = buildStations(os).breaks;
  const tiles = (list: Array<{ col: number; row: number }>) => list.map(key).sort();
  assert.deepEqual(tiles(b.coffee), [key(COFFEE_FRONT)]);
  assert.deepEqual(tiles(b.vending), tiles(VENDING_FRONTS));
  assert.deepEqual(tiles(b.ashtrays), tiles(ASHTRAYS));
  assert.deepEqual(tiles(b.buffet), tiles(BUFFET));
  assert.deepEqual(tiles(b.bar), tiles(BAR));
  assert.deepEqual(tiles(b.dining), tiles(DINING));
  assert.deepEqual(tiles(b.terrace), tiles(TERRACE_BENCHES));
  for (const spot of [...b.coffee, ...b.vending, ...b.ashtrays, ...b.buffet]) {
    assert.equal(spot.seat, null, 'a prop front is a standing place');
    assert.equal(spot.dir, Direction.UP, 'facing up toward the prop');
  }
  for (const spot of [...b.bar, ...b.dining, ...b.terrace]) {
    assert.notEqual(spot.seat, null, 'a seat');
    assert.equal(spot.dir, os.seats.get(spot.seat!)!.facingDir);
  }
  // The Hall's machine and the Fun room's are told apart by their room.
  assert.deepEqual(
    b.vending.map((v) => v.zone),
    ['Hall', 'Fun'],
  );
  // A layout that puts the coffee machine elsewhere moves its target; nothing is hard-coded.
  const moved = buildStations(buildWorld({ coffee: { col: 12, row: 19 } })).breaks;
  assert.deepEqual(tiles(moved.coffee), [key({ col: 12, row: 21 })]);
  // The pod's cooler is the stock one.
  assert.deepEqual(
    buildStations(os).coolers.map((c) => key(c)),
    [key(COOLER_FRONT)],
  );
  // No dining tables: four café seats.
  const bare = buildStations(buildWorld({ noDining: true })).breaks;
  assert.equal(bare.dining.length, 0);
  assert.equal(bare.bar.length, 4);
});

// ── Leads ──────────────────────────────────────────────────────────

test('a lead goes to the Lounge first, and picks its next place 25 to 45 s after it got there', () => {
  const os = office({ leads: 1, rng: fixed(0.9) });
  waitFor(os, () => os.aero.routes.get(1)?.arrived === true, 80, 'arrival at the Lounge');
  const route = os.aero.routes.get(1)!;
  assert.equal(route.kind, 'lounge');
  assert.ok(route.timer! >= PICK_MIN_SEC && route.timer! <= PICK_MAX_SEC, `timer ${route.timer}`);
  assert.deepEqual(
    [lead(os, 1).routine?.kind, lead(os, 1).routine?.phase],
    ['lounge', 'at'],
    'the snapshot says where it is',
  );
  // 0.9 draws the Lounge: it stays, and asks again after another 25 to 45 s.
  run(os, 24);
  assert.equal(os.aero.routes.get(1), route, 'still the same route before 25 s');
  run(os, PICK_MAX_SEC + 1);
  assert.equal(os.aero.routes.get(1), route, 'the Lounge pick keeps the route');
  assert.ok(route.timer! > 0 && route.timer! <= PICK_MAX_SEC);
});

test('coffee: 4 s at the machine with steam and a cup, then 8 s on a bar stool, then back to the Lounge', () => {
  const os = office({ leads: 1, rng: fixed(0.2) });
  waitFor(os, () => lead(os, 1).routine?.kind === 'coffee', 120, 'a coffee pick');
  assert.equal(lead(os, 1).routine?.phase, 'walking');
  const deskBefore = os.seats.get('lead-1')!.assigned;
  assert.equal(deskBefore, true, 'the desk seat stays its own');
  assert.equal(snap(os).fxStarted['steam'] ?? 0, 0, 'no steam before it gets there');
  waitFor(os, () => lead(os, 1).routine?.phase === 'at', 60, 'the machine');
  assert.deepEqual(tileOf(os, 1), COFFEE_FRONT);
  assert.equal(os.characters.get(1)!.dir, Direction.UP, 'facing the machine');
  assert.equal(os.aero.bubbleFor(1), '☕');
  assert.equal(snap(os).fxStarted['steam'], 1, 'steam on arrival');
  assert.equal(snap(os).fxStarted['poof'] ?? 0, 0, 'not a walking-home poof');
  const atMachine = waitFor(
    os,
    () => lead(os, 1).routine?.phase !== 'at',
    10,
    'leaving the machine',
  );
  assert.ok(atMachine >= COFFEE_SEC - 0.3 && atMachine <= COFFEE_SEC + 0.3, `${atMachine}`);
  waitFor(os, () => lead(os, 1).routine?.phase === 'bar', 10, 'the bar stool');
  const stool = lead(os, 1).routine!;
  assert.ok(inList(BAR, stool), 'a bar stool');
  assert.deepEqual(tileOf(os, 1), { col: stool.col, row: stool.row });
  assert.equal(os.characters.get(1)!.state, CharacterState.TYPE, 'sitting');
  assert.equal(os.aero.bubbleFor(1), '☕');
  const onStool = waitFor(os, () => lead(os, 1).routine?.kind !== 'coffee', 20, 'the stool time');
  assert.ok(onStool >= BAR_SEC - 0.3 && onStool <= BAR_SEC + 0.3, `${onStool}`);
  assert.equal(snap(os).fxStarted['steam'], 1, 'one coffee, one steam');
  waitFor(os, () => lead(os, 1).routine?.kind === 'lounge', 60, 'back to the Lounge');
  assert.equal(os.seats.get('lead-1')!.assigned, true);
});

test('the water cooler: the lead’s own pod’s, 4 s, a drop of water', () => {
  const os = office({ leads: 1, rng: fixed(0.05) });
  waitFor(os, () => lead(os, 1).routine?.kind === 'cooler', 120, 'a cooler pick');
  waitFor(os, () => lead(os, 1).routine?.phase === 'at', 30, 'the cooler');
  assert.deepEqual(tileOf(os, 1), COOLER_FRONT);
  assert.equal(os.aero.bubbleFor(1), '\u{1F4A7}');
  const stay = waitFor(os, () => lead(os, 1).routine?.kind !== 'cooler', 10, 'the cooler time');
  assert.ok(stay >= COOLER_SEC - 0.3 && stay <= COOLER_SEC + 0.3, `${stay}`);
});

test('vending: the Hall’s or the Fun room’s, 4 s, a drink or a chocolate bar by the machine', () => {
  const seen = new Map<string, string>();
  for (const turn of [0.1, 0.9]) {
    const os = office({ leads: 1, rng: fixed(0.9) });
    waitFor(os, () => os.aero.routes.get(1)?.arrived === true, 80, 'arrival');
    // The pick by hand, with the draws it makes: vending, then which machine.
    const draws = [0.33, turn];
    os.aero.rng = () => draws.shift() ?? 0.9;
    const pick = (os.aero as unknown as { pickBreak(ch: unknown, staff: boolean): boolean })
      .pickBreak;
    assert.equal(pick.call(os.aero, os.characters.get(1), false), true);
    os.aero.rng = fixed(0.9);
    assert.equal(lead(os, 1).routine?.kind, 'vending');
    waitFor(os, () => lead(os, 1).routine?.phase === 'at', 90, 'the machine');
    const t = tileOf(os, 1);
    assert.ok(inList(VENDING_FRONTS, t), 'a vending front');
    seen.set(key(t), os.aero.bubbleFor(1)!);
    const stay = waitFor(os, () => lead(os, 1).routine?.kind !== 'vending', 10, 'the machine time');
    assert.ok(stay >= VENDING_SEC - 0.3 && stay <= VENDING_SEC + 0.3, `${stay}`);
  }
  assert.equal(seen.size, 2, 'both machines are used');
  for (const [tile, bubble] of seen) {
    assert.equal(bubble, tile === key(VENDING_FRONTS[1]) ? '\u{1F36B}' : '\u{1F964}', tile);
  }
});

test('a smoke: 10 to 14 s at an ashtray or a terrace bench, the wisp on arrival, a cigarette over the head', () => {
  const os = office({ leads: 1, rng: fixed(0.45) });
  waitFor(os, () => lead(os, 1).routine?.kind === 'smoke', 120, 'a smoke pick');
  assert.equal(snap(os).smokers, 1);
  waitFor(os, () => lead(os, 1).routine?.phase === 'at', 40, 'the terrace');
  const t = tileOf(os, 1);
  assert.ok(inList([...ASHTRAYS, ...TERRACE_BENCHES], t), `${key(t)} is a smoking place`);
  assert.equal(os.aero.bubbleFor(1), '\u{1F6AC}');
  assert.equal(snap(os).fxStarted['smoke'], 1);
  const stay = waitFor(os, () => lead(os, 1).routine?.kind !== 'smoke', 20, 'the smoke time');
  assert.ok(stay >= 10 - 0.3 && stay <= 14 + 0.3, `${stay}`);
  assert.equal(snap(os).smokers, 0);
});

test('a lead that turns active mid-break walks to its desk, standing at the cooler or seated on the stool', () => {
  for (const [rng, phase] of [
    [fixed(0.05), 'at'],
    [fixed(0.2), 'bar'],
  ] as const) {
    const os = office({ leads: 1, rng });
    waitFor(
      os,
      () => lead(os, 1).routine?.phase === phase && lead(os, 1).routine?.kind !== 'lounge',
      150,
      phase,
    );
    assert.ok(os.aero.routes.has(1));
    os.setAgentActive(1, true);
    const desk = os.seats.get('lead-1')!;
    waitFor(
      os,
      () =>
        tileOf(os, 1).col === desk.seatCol &&
        tileOf(os, 1).row === desk.seatRow &&
        os.characters.get(1)!.state === CharacterState.TYPE,
      60,
      `the desk from ${phase}`,
    );
    assert.equal(os.aero.routes.has(1), false, 'the break is over');
    assert.equal(lead(os, 1).routine, null);
  }
});

test('a permission bubble ends a break at once', () => {
  const os = office({ leads: 1, rng: fixed(0.05) });
  waitFor(os, () => lead(os, 1).routine?.kind === 'cooler', 120, 'a cooler pick');
  os.showPermissionBubble(1);
  os.update(DT);
  assert.equal(os.aero.routes.has(1), false);
});

// ── Idle staff ─────────────────────────────────────────────────────

test('an idle staff member picks a place 25 to 45 s on, reaches its target, stays its time and wanders home', () => {
  const os = office({ agents: [person('reviewer', FA)], rng: fixed(0.05) });
  const t0 = waitFor(os, () => staffNamed(os, 'reviewer').routine !== null, 80, 'a cooler pick');
  assert.ok(t0 >= PICK_MIN_SEC - 0.5 && t0 <= PICK_MAX_SEC + 1, `first pick at ${t0}`);
  assert.equal(staffNamed(os, 'reviewer').routine!.kind, 'cooler');
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.phase === 'at', 40, 'the cooler');
  const ava = staffNamed(os, 'reviewer');
  assert.deepEqual({ col: ava.col, row: ava.row }, COOLER_FRONT);
  const bubbles = os.aero.staffBubbles();
  assert.deepEqual(
    bubbles.map((b) => b.text),
    ['\u{1F4A7}'],
    'the bubble is drawn through the people',
  );
  // Seen through the overlay too.
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText') return (text: string) => texts.push(text);
        if (prop === 'measureText') return () => ({ width: 8 });
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  drawAeroOverlay(ctx, os, 0, 0, 2);
  assert.ok(texts.includes('\u{1F4A7}'), 'the overlay draws the staff bubble');
  const stay = waitFor(
    os,
    () => staffNamed(os, 'reviewer').routine === null,
    10,
    'the cooler time',
  );
  assert.ok(stay >= COOLER_SEC - 0.3 && stay <= COOLER_SEC + 0.3, `${stay}`);
  assert.deepEqual(os.aero.staffBubbles(), []);
  // It walks home over the Lounge floor, not stuck at the cooler.
  const lounge = snap(os).lounge!;
  assert.ok(lounge.floor > 0);
  waitFor(
    os,
    () => {
      const p = staffNamed(os, 'reviewer');
      return p.state === 'idle' && !(p.col === COOLER_FRONT.col && p.row === COOLER_FRONT.row);
    },
    30,
    'leaving the cooler',
  );
});

test('staff coffee: the machine, then a stool; the staff member holds no seat of its own', () => {
  const os = office({ agents: [person('reviewer', FA)], rng: fixed(0.2) });
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.kind === 'coffee', 90, 'a coffee pick');
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.phase === 'at', 60, 'the machine');
  assert.equal(snap(os).fxStarted['steam'], 1);
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.phase === 'bar', 15, 'the stool');
  const p = staffNamed(os, 'reviewer');
  assert.ok(inList(BAR, p));
  assert.equal(p.state, CharacterState.TYPE);
  for (const uid of ['stool-11', 'stool-12', 'stool-13', 'stool-14']) {
    assert.equal(os.seats.get(uid)!.assigned, false, 'never `assigned`');
  }
  waitFor(os, () => staffNamed(os, 'reviewer').routine === null, 20, 'the end');
});

test('a person ends its break when a subagent needs it, and when its entry leaves the roster', () => {
  const os = office({ leads: 1, agents: [person('reviewer', FA)], rng: fixed(0.05) });
  os.setAgentActive(1, true);
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.kind === 'cooler', 90, 'a cooler pick');
  assert.equal(os.aero.staffRoutes.size, 1);
  os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: reviewer'), true);
  os.update(DT);
  assert.equal(os.aero.staffRoutes.size, 0, 'the break ended');
  assert.equal(staffNamed(os, 'reviewer').away, true);
  // The same for a roster that loses the person.
  const second = office({ agents: [person('reviewer', FA)], rng: fixed(0.05) });
  waitFor(second, () => staffNamed(second, 'reviewer').routine?.kind === 'cooler', 90, 'a pick');
  assert.ok(setAeroUpdate(upd(FA, [])));
  run(second, 1);
  assert.equal(second.aero.staffRoutes.size, 0);
});

test('a person’s own tile is never taken from its own point of view; the others see it taken', () => {
  const os = office({ agents: [person('reviewer', FA)], rng: fixed(0.9) });
  const p = os.aero.people[0];
  const occupied = (os.aero as unknown as { occupied(id: number): Set<string> }).occupied.bind(
    os.aero,
  );
  const tile = key({ col: p.ch.tileCol, row: p.ch.tileRow });
  assert.equal(occupied(p.ch.id).has(tile), false);
  assert.equal(occupied(Number.NaN).has(tile), true);
});

// ── Lunch ──────────────────────────────────────────────────────────

test('lunch: the buffet first (two at a time), then a café seat while lunch lasts; the third goes straight to a seat', () => {
  const os = office({ leads: 3, lunch: true, rng: seeded(3) });
  os.update(DT);
  const routes = [1, 2, 3].map((id) => os.aero.routes.get(id)!);
  assert.ok(
    routes.every((r) => r.mode === 'lunch' && r.kind === 'lunch'),
    'all three eat in the café',
  );
  const atBuffet = routes.filter((r) => r.next);
  assert.equal(atBuffet.length, 2, 'two at the buffet');
  assert.ok(atBuffet.every((r) => inList(BUFFET, r.target)));
  const direct = routes.find((r) => !r.next)!;
  assert.notEqual(direct.seatUid, null, 'the third goes to a seat');
  const targets = routes.flatMap((r) => [r.target, ...(r.next ? [r.next.target] : [])].map(key));
  assert.equal(new Set(targets).size, targets.length, 'no two share a tile');
  waitFor(os, () => [1, 2, 3].every((id) => lead(os, id).routine?.phase === 'seat'), 60, 'seated');
  const seats = [1, 2, 3].map((id) => lead(os, id).routine!);
  assert.equal(new Set(seats.map(key)).size, 3);
  for (const s of seats) {
    assert.ok(inList([...BAR, ...DINING], s), `${key(s)} is a café seat`);
  }
  const food = ['\u{1F35C}', '\u{1F957}'];
  for (const id of [1, 2, 3]) assert.ok(food.includes(os.aero.bubbleFor(id)!));
  // They stay for as long as lunch lasts.
  run(os, 90);
  for (const id of [1, 2, 3]) assert.equal(lead(os, id).routine?.phase, 'seat');
  // Lunch is over: back to the Lounge.
  assert.ok(setAeroUpdate(upd(FA, [], { lunch: false })));
  waitFor(
    os,
    () => [1, 2, 3].every((id) => lead(os, id).routine?.kind === 'lounge'),
    80,
    'back to the Lounge',
  );
});

test('the buffet takes 2.5 s, then the lead walks to the seat that was kept for it', () => {
  const os = office({ leads: 1, lunch: true, rng: seeded(4) });
  os.update(DT);
  const first = os.aero.routes.get(1)!;
  const seatTile = first.next!.target;
  waitFor(os, () => lead(os, 1).routine?.phase === 'at', 40, 'the buffet');
  const stay = waitFor(os, () => lead(os, 1).routine?.phase !== 'at', 10, 'the buffet time');
  assert.ok(stay >= BUFFET_SEC - 0.3 && stay <= BUFFET_SEC + 0.3, `${stay}`);
  waitFor(os, () => lead(os, 1).routine?.phase === 'seat', 20, 'the seat');
  assert.deepEqual(tileOf(os, 1), seatTile);
});

test('café full: the lead left over eats at the Lounge table, and moves to the café when a seat frees', () => {
  const os = office({ leads: 3, lunch: true, rng: seeded(6), opts: { noDining: true } });
  // Three of the four café seats are some lead's desk, so they are not for lunch.
  for (const uid of ['stool-12', 'stool-13', 'stool-14']) os.seats.get(uid)!.assigned = true;
  os.update(DT);
  const kinds = [1, 2, 3].map((id) => os.aero.routes.get(id)!.kind);
  assert.equal(kinds.filter((k) => k === 'lunch').length, 1, 'one seat, one lunch in the café');
  const left = [1, 2, 3].filter((id) => os.aero.routes.get(id)!.kind === 'lounge');
  assert.equal(left.length, 2);
  for (const id of left) assert.equal(os.aero.routes.get(id)!.mode, 'lunch', 'the Lounge table');
  waitFor(os, () => left.every((id) => os.aero.routes.get(id)?.arrived === true), 90, 'the table');
  assert.equal(os.aero.bubbleFor(left[0]), '\u{1F35C}');
  // The diner in the café gets to work: its seat is free, and a diner at the table takes it within a few seconds.
  const diner = [1, 2, 3].find((id) => !left.includes(id))!;
  waitFor(os, () => lead(os, diner).routine?.phase === 'seat', 60, 'the diner seated');
  os.setAgentActive(diner, true);
  waitFor(
    os,
    () => left.some((id) => lead(os, id).routine?.kind === 'lunch'),
    LUNCH_WAIT,
    'a café seat taken by one from the table',
  );
});

test('staff eat in the café at lunch too, and go back to the Lounge when it is over', () => {
  const os = office({ agents: STAFF_A.slice(0, 3), lunch: true, rng: seeded(8) });
  waitFor(
    os,
    () => snap(os).people.every((p) => p.routine?.phase === 'seat'),
    60,
    'all three seated',
  );
  const seats = snap(os).people.map((p) => key(p.routine!));
  assert.equal(new Set(seats).size, 3);
  for (const p of snap(os).people) assert.ok(inList([...BAR, ...DINING], p.routine!));
  run(os, 60);
  assert.ok(snap(os).people.every((p) => p.routine?.phase === 'seat'));
  assert.ok(setAeroUpdate(upd(FA, STAFF_A.slice(0, 3))));
  waitFor(os, () => snap(os).people.every((p) => p.routine === null), 5, 'up from the table');
});

// ── The cap, the cooldown, the floors ──────────────────────────────

test('never more than two out smoking, and nobody twice within three minutes', () => {
  const os = office({ agents: STAFF_A, rng: fixed(0.45) });
  const startedAt = new Map<string, number[]>();
  const was = new Set<string>();
  let t = 0;
  let maxSmokers = 0;
  for (; t < 420; t += DT) {
    os.update(DT);
    const s = snap(os);
    const smoking = s.people.filter((p) => p.routine?.kind === 'smoke');
    assert.ok(smoking.length <= 2, `${smoking.length} smoking at ${t.toFixed(1)}`);
    assert.equal(s.smokers, smoking.length);
    maxSmokers = Math.max(maxSmokers, smoking.length);
    for (const p of s.people) {
      const on = p.routine?.kind === 'smoke';
      if (on && !was.has(p.name)) startedAt.set(p.name, [...(startedAt.get(p.name) ?? []), t]);
      if (on) was.add(p.name);
      else was.delete(p.name);
    }
  }
  assert.equal(maxSmokers, 2, 'the cap is reached');
  assert.ok(startedAt.size >= 4, `several people took a turn, got ${startedAt.size}`);
  let twice = 0;
  for (const times of startedAt.values()) {
    for (let i = 1; i < times.length; i++) {
      assert.ok(
        times[i] - times[i - 1] >= SMOKE_COOLDOWN_SEC - 1,
        `a smoker again after ${times[i] - times[i - 1]} s`,
      );
      twice++;
    }
  }
  assert.ok(twice >= 1, 'somebody got a second turn once the three minutes were over');
  // The cooldown map does not grow: it holds only the last three minutes.
  const smoked = (os.aero as unknown as { smoked: Map<number, number> }).smoked;
  assert.ok(smoked.size <= STAFF_A.length);
});

test('a floor switch keeps the cap per floor and fires no effect off the floor on show', () => {
  const os = office({ agents: [...STAFF_A.slice(0, 3), ...STAFF_B], rng: fixed(0.45) });
  waitFor(os, () => snap(os).smokers === 2, 150, 'two smoking on floor A');
  waitFor(
    os,
    () =>
      snap(os).people.filter((p) => p.routine?.kind === 'smoke' && p.routine.phase === 'at')
        .length === 2,
    40,
    'both there',
  );
  const smokeFx = snap(os).fxStarted['smoke'];
  assert.equal(smokeFx, 2);
  // Floor B comes on show: A's people are away, hold nothing and count for nothing.
  assert.ok(setAeroUpdate(upd(FB, [...STAFF_A.slice(0, 3), ...STAFF_B], { lunch: false })));
  run(os, 0.2);
  const s = snap(os);
  assert.equal(s.smokers, 0, 'the other floor’s smokers do not count');
  assert.equal(os.aero.staffRoutes.size, 0);
  for (const p of s.people.filter((q) => q.floor === FA)) {
    assert.equal(p.shown, false);
    assert.equal(p.routine, null, 'a frozen target is not kept');
  }
  const occupied = (os.aero as unknown as { occupied(id: number): Set<string> }).occupied.bind(
    os.aero,
  );
  for (const t of [...ASHTRAYS, ...TERRACE_BENCHES]) {
    assert.equal(occupied(Number.NaN).has(key(t)), false, `${key(t)} is free again`);
  }
  assert.equal(snap(os).fxStarted['smoke'], smokeFx, 'no effect for them');
  // B's own smokers take their turn: at most two, whatever A held.
  let max = 0;
  for (let t = 0; t < 150; t += DT) {
    os.update(DT);
    const now = snap(os);
    max = Math.max(max, now.smokers);
    assert.ok(now.smokers <= 2);
    assert.ok(
      now.people.filter((p) => p.floor === FA).every((p) => p.routine === null),
      'A stays frozen',
    );
  }
  assert.equal(max, 2, 'floor B reaches its own cap');
  // Back on A: the cap holds there.
  assert.ok(setAeroUpdate(upd(FA, [...STAFF_A.slice(0, 3), ...STAFF_B])));
  for (let t = 0; t < 150; t += DT) {
    os.update(DT);
    assert.ok(snap(os).smokers <= 2);
  }
});

test('with nobody of the floor on show nothing is routed and no effect starts', () => {
  const os = office({ agents: STAFF_A.slice(0, 3), rng: fixed(0.45) });
  assert.ok(setAeroUpdate(upd(FB, STAFF_A.slice(0, 3))));
  run(os, 120);
  assert.equal(os.aero.staffRoutes.size, 0);
  assert.equal(snap(os).fxStarted['smoke'] ?? 0, 0);
  assert.equal(snap(os).fxStarted['steam'] ?? 0, 0);
});

// ── Seats, Proton, the long day ────────────────────────────────────

test('a seat that is somebody’s desk is never a break seat', () => {
  const os = office({ leads: 1, agents: [person('reviewer', FA)], rng: fixed(0.2) });
  for (const uid of ['stool-11', 'stool-12', 'stool-13', 'stool-14'])
    os.seats.get(uid)!.assigned = true;
  for (let t = 0; t < 200; t += DT) {
    os.update(DT);
    const s = snap(os);
    for (const r of s.routes) assert.notEqual(r.kind, 'coffee', 'no coffee without a stool');
    for (const p of s.people) assert.notEqual(p.routine?.kind, 'coffee');
  }
});

test('Proton does not take a break tile, and still naps on a sofa that no break route ever targets', () => {
  const os = office({ leads: 2, agents: STAFF_A, rng: seeded(21) });
  const protonSpots = (
    os.aero as unknown as {
      protonSpots(kind: string): Array<{ col: number; row: number }>;
    }
  ).protonSpots.bind(os.aero);
  assert.ok(
    protonSpots('cafe').some((t) => key(t) === key(COFFEE_FRONT)),
    'free: she may go there',
  );
  const sofaTiles = new Set(
    LOUNGE_SOFAS.map((uid) =>
      key({ col: os.seats.get(uid)!.seatCol, row: os.seats.get(uid)!.seatRow }),
    ),
  );
  let napped = false;
  let breaks = 0;
  for (let t = 0; t < 900; t += DT) {
    os.update(DT);
    const s = snap(os);
    const targets: string[] = [];
    for (const r of [...s.leads.map((l) => l.routine), ...s.people.map((p) => p.routine)]) {
      if (!r || r.kind === 'lounge') continue;
      breaks++;
      assert.ok(!sofaTiles.has(key(r)), `a break routed to the sofa ${key(r)}`);
      if (r.seat !== null) assert.ok(!LOUNGE_SOFAS.includes(r.seat));
      targets.push(key(r));
    }
    assert.equal(new Set(targets).size, targets.length, 'no two breaks share a tile');
    const cat = s.proton;
    if (cat?.seat) napped = true;
    // Her spots never include a tile somebody stands on or heads for.
    if (Math.floor(t * 10) % 50 === 0) {
      const taken = new Set<string>();
      for (const r of [...s.leads.map((l) => l.routine), ...s.people.map((p) => p.routine)]) {
        if (r && r.kind !== 'lounge') taken.add(key(r));
      }
      for (const spot of [...protonSpots('cafe'), ...protonSpots('sun')]) {
        assert.ok(!taken.has(key(spot)), `her spot ${key(spot)} is a break target`);
      }
    }
  }
  assert.ok(breaks > 100, `breaks happened (${breaks} polls)`);
  assert.ok(napped, 'Proton napped on a sofa');
});

test('a seeded day: several kinds of break happen, every target distinct, on its own tile, within 300 s', () => {
  const os = office({ leads: 2, agents: STAFF_A, rng: seeded(99) });
  const kinds = new Set<string>();
  const allowed = os.aero.protonAllowed();
  for (let t = 0; t < 300; t += DT) {
    os.update(DT);
    const s = snap(os);
    const here: string[] = [];
    for (const r of [...s.leads.map((l) => l.routine), ...s.people.map((p) => p.routine)]) {
      if (!r) continue;
      here.push(key(r));
      if (r.kind !== 'lounge') {
        kinds.add(r.kind);
        if (r.seat === null) assert.ok(allowed.has(key(r)), `${key(r)} is an allowed tile`);
      }
    }
    // A Lounge route and a break never share a tile either.
    assert.equal(new Set(here).size, here.length);
    assert.ok(s.smokers <= 2);
  }
  assert.ok(kinds.size >= 3, `kinds seen: ${[...kinds].join(',')}`);
});

// ── The fix round ──────────────────────────────────────────────────

const priv = (os: OfficeState) =>
  os.aero as unknown as {
    pickBreak(ch: unknown, staff: boolean): boolean;
    pickAt: Map<number, number>;
    clock: number;
    proton: {
      spot: string | null;
      col: number;
      row: number;
      timer: number;
      place(t: { col: number; row: number }): void;
      spotTile(): { col: number; row: number };
    } | null;
  };

test('F1: a prop’s room is the room of its front tile: the Fun room’s vending machine on the unlabelled wall is the Fun room’s', () => {
  const os = buildWorld();
  const vending = buildStations(os).breaks.vending;
  const fun = vending.find((v) => key(v) === key(VENDING_FRONTS[1]))!;
  assert.equal(fun.zone, 'Fun');
  assert.equal(vending.find((v) => key(v) === key(VENDING_FRONTS[0]))!.zone, 'Hall');
});

test('F2: in the Rooms style (no pods in force) a room named Café or Terrace gives no break and no café lunch', () => {
  const os = buildWorld();
  os.aero.rng = fixed(0.2);
  os.addAgent(1, 0, 0, LEAD_SEATS[0], true, FA);
  // No `pods` key at all: the Rooms style.
  const rooms = (lunch: boolean): Record<string, unknown> => {
    const u = upd(FA, STAFF_A.slice(0, 2), { lunch });
    delete u['pods'];
    return u;
  };
  assert.ok(setAeroUpdate(rooms(false)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  os.setAgentActive(1, false);
  for (const lunch of [false, true]) {
    assert.ok(setAeroUpdate(rooms(lunch)));
    for (let t = 0; t < 120; t += DT) {
      os.update(DT);
      const s = snap(os);
      for (const r of [...s.leads.map((l) => l.routine), ...s.people.map((p) => p.routine)]) {
        if (r) assert.equal(r.kind, 'lounge', `no ${r.kind} outside the open office`);
      }
    }
  }
  assert.equal(os.aero.staffRoutes.size, 0);
});

test('F3: a staff member taken off the floor mid-break stands where it is; back on the floor it walks nowhere stale', () => {
  const os = office({ agents: STAFF_A.slice(0, 1), rng: fixed(0.05) });
  const p = os.aero.people[0];
  waitFor(
    os,
    () => staffNamed(os, 'reviewer').routine?.phase === 'walking' && p.ch.path.length > 0,
    90,
    'on the way to the cooler',
  );
  assert.ok(setAeroUpdate(upd(FB, STAFF_A.slice(0, 1))));
  os.update(DT);
  assert.equal(os.aero.staffRoutes.size, 0);
  assert.equal(p.ch.path.length, 0, 'the stale path is gone');
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.ok(setAeroUpdate(upd(FA, STAFF_A.slice(0, 1))));
  os.update(DT);
  if (os.aero.staffRoutes.size === 0) assert.equal(p.ch.path.length, 0, 'it does not finish it');
});

test('F4: the snapshot names the seat kept for the second stage while the first is walked, and the seat is one that can be reached', () => {
  // The stool nearest the machine and the buffet is walled in.
  const walls = [
    { col: 10, row: 24 },
    { col: 11, row: 23 },
    { col: 11, row: 25 },
  ];
  const os = office({ leads: 1, rng: fixed(0.9), opts: { walls } });
  waitFor(os, () => os.aero.routes.get(1)?.arrived === true, 80, 'arrival');
  os.aero.rng = fixed(0.2);
  assert.equal(priv(os).pickBreak(os.characters.get(1), false), true);
  os.aero.rng = fixed(0.9);
  const v = lead(os, 1).routine!;
  assert.equal(v.kind, 'coffee');
  assert.equal(v.phase, 'walking');
  const kept = os.aero.routes.get(1)!.next!;
  assert.equal(v.seat, kept.seatUid, 'the reserved seat is reported');
  assert.notEqual(v.seat, null);
  assert.notDeepEqual(kept.target, BAR[0], 'not the walled-in stool');
  assert.ok(inList(BAR, kept.target));
  // The lunch at the buffet keeps a reachable seat too.
  const lunchOs = office({ leads: 1, lunch: true, rng: seeded(4), opts: { walls } });
  lunchOs.update(DT);
  const first = lunchOs.aero.routes.get(1)!;
  assert.equal(first.kind, 'lunch');
  assert.equal(lead(lunchOs, 1).routine!.seat, first.next!.seatUid);
  assert.notDeepEqual(first.next!.target, BAR[0]);
});

test('F5: Proton gives up a café spot that a break route has taken, standing on it or heading to it', () => {
  for (const walking of [false, true]) {
    const os = office({ leads: 1, rng: fixed(0.9) });
    waitFor(os, () => os.aero.routes.get(1)?.arrived === true, 80, 'arrival');
    const cat = priv(os).proton!;
    assert.ok(cat, 'she is on show');
    const back = { col: COFFEE_FRONT.col, row: COFFEE_FRONT.row + 1 };
    cat.place(walking ? back : COFFEE_FRONT);
    const inner = cat as unknown as { spot: string | null; timer: number; path: unknown[] };
    inner.spot = 'cafe';
    inner.timer = 1000;
    if (walking) inner.path = [{ ...COFFEE_FRONT }];
    os.aero.rng = fixed(0.2);
    assert.equal(priv(os).pickBreak(os.characters.get(1), false), true);
    os.aero.rng = fixed(0.9);
    assert.deepEqual(os.aero.routes.get(1)!.target, COFFEE_FRONT);
    os.update(DT);
    const on = cat.spot === 'cafe' && key(cat.spotTile()) === key(COFFEE_FRONT);
    assert.equal(on, false, `she let go of the coffee front (walking: ${walking})`);
  }
});

test('F6a: a rest break ends when lunch starts', () => {
  const os = office({ agents: STAFF_A.slice(0, 1), rng: fixed(0.2) });
  waitFor(os, () => staffNamed(os, 'reviewer').routine?.phase === 'bar', 120, 'on the stool');
  assert.ok(setAeroUpdate(upd(FA, STAFF_A.slice(0, 1), { lunch: true })));
  os.update(DT);
  os.update(DT);
  for (const r of os.aero.staffRoutes.values()) assert.equal(r.mode, 'lunch', 'no rest route left');
});

test('F6b: when lunch ends, the idle pick a pick’s time away, not at once', () => {
  const os = office({ agents: STAFF_A.slice(0, 1), rng: fixed(0.2) });
  const o = priv(os) as unknown as {
    lunchWas: boolean;
    pickAt: Map<number, number>;
    clock: number;
  };
  // Lunch was on, and has just ended; the person is idle with a pick far off.
  o.lunchWas = true;
  for (const id of o.pickAt.keys()) o.pickAt.set(id, o.clock + 1000);
  os.update(DT);
  assert.equal(os.aero.staffRoutes.size, 0, 'no break started at once');
  assert.ok(o.pickAt.size > 0);
  for (const at of o.pickAt.values()) {
    assert.ok(at - o.clock >= PICK_MIN_SEC - 0.5, `the next pick is ${at - o.clock} s away`);
  }
});

test('F8: a contractor takes no break, however long it is idle', () => {
  const os = office({ leads: 1, agents: [person('reviewer', FA)], rng: fixed(0.05) });
  os.setAgentActive(1, true);
  const tools = ['tool-a', 'tool-b'];
  for (const tool of tools) {
    os.addSubagent(1, tool);
    assert.equal(os.aero.subagentStarted(1, tool, 'Subtask: reviewer'), true);
  }
  run(os, MATRIX_EFFECT_DURATION + 2);
  const contractor = os.aero.people.find((x) => x.contractor);
  assert.ok(contractor, 'a contractor was hired');
  for (const tool of tools) os.removeSubagent(1, tool);
  let personBroke = false;
  for (let t = 0; t < 100; t += DT) {
    os.update(DT);
    assert.equal(os.aero.staffRoutes.has(contractor.ch.id), false, 'the contractor has no route');
    if (os.aero.people.some((x) => !x.contractor && os.aero.staffRoutes.has(x.ch.id)))
      personBroke = true;
  }
  assert.ok(personBroke, 'the roster person, idle in the same time, did take a break');
});

test('F8: a break never targets a pod cooler a worker holds, and never moves that worker', () => {
  for (const slug of ['general-purpose', 'reviewer']) {
    const os = office({
      leads: 2,
      agents: [person('reviewer', FA)],
      rng: fixed(0.9),
    });
    os.setAgentActive(1, true);
    const subId = os.addSubagent(1, 'tool-w');
    os.aero.subagentStarted(1, 'tool-w', `Subtask: ${slug}`);
    os.setAgentTool(subId, 'Subtask');
    os.setAgentActive(subId, true);
    run(os, MATRIX_EFFECT_DURATION + 8);
    os.setAgentActive(subId, false);
    const sub = () =>
      os.aero.people.find((x) => x.subId === subId)?.ch ?? os.characters.get(subId)!;
    waitFor(
      os,
      () => key({ col: sub().tileCol, row: sub().tileRow }) === key(COOLER_FRONT),
      60,
      `${slug} at the cooler`,
    );
    os.aero.rng = fixed(0.05);
    for (let t = 0; t < 150; t += DT) {
      os.update(DT);
      assert.deepEqual(
        { col: sub().tileCol, row: sub().tileRow },
        COOLER_FRONT,
        `${slug} stays at the cooler`,
      );
      for (const l of snap(os).leads) assert.notEqual(l.routine?.kind, 'cooler');
      for (const q of snap(os).people) assert.notEqual(q.routine?.kind, 'cooler');
    }
  }
});

test('F8: a cooler reserved for a worker or a person on its way is not offered to a break', () => {
  for (const holder of ['person', 'worker']) {
    const os = office({ leads: 2, agents: [person('reviewer', FA)], rng: fixed(0.9) });
    os.setAgentActive(1, true);
    const subId = os.addSubagent(1, 'tool-h');
    os.aero.subagentStarted(
      1,
      'tool-h',
      holder === 'person' ? 'Subtask: reviewer' : 'Subtask: general-purpose',
    );
    os.setAgentTool(subId, 'Subtask');
    os.setAgentActive(subId, true);
    run(os, MATRIX_EFFECT_DURATION + 8);
    const held = { ...COOLER_FRONT };
    const p = os.aero.people.find((x) => x.subId === subId);
    const w = (os.aero as unknown as { subs: Map<number, { cooler: unknown }> }).subs.get(subId);
    if (holder === 'person') p!.cooler = held;
    else (w as { cooler: unknown }).cooler = held;
    const mover = p?.ch ?? os.characters.get(subId)!;
    const at = () => ({ col: mover.tileCol, row: mover.tileRow });
    const before = at();
    const plans = (
      os.aero as unknown as { plansFor(ch: unknown, k: string, staff: boolean): unknown[] }
    ).plansFor(os.characters.get(2), 'cooler', false);
    assert.equal(plans.length, 0, `${holder}: its cooler is not offered`);
    assert.deepEqual(at(), before, 'and nobody is moved');
  }
});
