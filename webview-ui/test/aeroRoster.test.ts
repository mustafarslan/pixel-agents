/**
 * Aero's staff roster per floor (docs/work/phase6-roster/plan.md, task 3a): the agents' `floor` key and caps, people keyed by
 * floor, the owner's shared people (hidden where the floor's roster has the type, the 16 cap per floor), the match order,
 * subagents of off-floor leads queued, borrowed pod benches with their PCs, freezing off the floor, and the overlay name rule.
 *
 * The layout is by hand (a unit test loads no furniture catalog but its own): Pod 1 in columns 1..8 with a lead's cushioned bench
 * and two wooden benches, each facing a PC below it; the Lounge in columns 16..21; a corridor between.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { PERSON_ID_BASE, resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { drawAeroOverlay } from '../src/aero/overlay.js';
import {
  MAX_AGENT_ROOMS,
  MAX_AGENTS,
  MAX_AGENTS_PER_FLOOR,
  MAX_FLOORS,
  parseAeroUpdate,
} from '../src/aero/update.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, PlacedFurniture, Seat } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  MATRIX_EFFECT_DURATION,
  TileType,
} from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';
const FC = 'cccccccccccc';

// ── The update ─────────────────────────────────────────────────────

const base = () => ({ lunch: false, meeting: null, inbox: 0, lounge: true });
const agent = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: slug,
  slug,
  ...extra,
});

test('an agent may carry a floor: 12 lowercase hex, exact keys, never with a room', () => {
  const one = (a: Record<string, unknown>) => ({ ...base(), agents: [a] });
  const good = one(agent('reviewer', { floor: FA }));
  assert.deepEqual(parseAeroUpdate(good), good);
  for (const bad of ['', 'AAAAAAAAAAAA', 'aaaaaaaaaaa', 'aaaaaaaaaaaaa', 'prruns', 5, null]) {
    assert.equal(parseAeroUpdate(one(agent('x', { floor: bad }))), null, String(bad));
  }
  assert.equal(parseAeroUpdate(one(agent('x', { floor: FA, room: FB }))), null, 'floor and room');
  assert.equal(parseAeroUpdate(one(agent('x', { floor: FA, extra: 1 }))), null);
  // The same type on two floors is two characters; twice on one floor is a duplicate; a room one beside it is another.
  const two = {
    ...base(),
    agents: [
      agent('reviewer', { floor: FA }),
      agent('reviewer', { floor: FB }),
      agent('reviewer'),
      agent('reviewer', { room: FA }),
    ],
  };
  assert.deepEqual(parseAeroUpdate(two), two);
  assert.equal(
    parseAeroUpdate({ ...base(), agents: [agent('r', { floor: FA }), agent('r', { floor: FA })] }),
    null,
  );
  // A floor key is not a room key: the same hex in both is not a duplicate.
  assert.notEqual(
    parseAeroUpdate({ ...base(), agents: [agent('r', { floor: FA }), agent('r', { room: FA })] }),
    null,
  );
});

test('the caps: 16 a floor, 16 floors, the owner’s 16 once, 272 in all; one more rejects the whole update', () => {
  assert.equal(MAX_AGENTS_PER_FLOOR, 16);
  assert.equal(MAX_AGENTS, 16 * MAX_FLOORS + 16);
  assert.equal(MAX_AGENTS, 272);
  const floors = Array.from({ length: MAX_FLOORS }, (_, i) => i.toString(16).padStart(12, '0'));
  const onFloor = (floor: string, n: number) =>
    Array.from({ length: n }, (_, i) => agent(`t${i}`, { floor }));
  const owner = (n: number) => Array.from({ length: n }, (_, i) => agent(`o${i}`));
  const full = {
    ...base(),
    agents: [...floors.flatMap((f) => onFloor(f, 16)), ...owner(16)],
    floor: { id: floors[0], number: 1, name: 'f', rooms: [floors[0]] },
  };
  assert.equal(full.agents.length, 272);
  assert.notEqual(parseAeroUpdate(full), null, 'every list full');
  // A floor with 17.
  assert.equal(
    parseAeroUpdate({ ...base(), agents: [...onFloor(FA, 17)] }),
    null,
    '17 on one floor',
  );
  // The owner's 17.
  assert.equal(parseAeroUpdate({ ...base(), agents: owner(17) }), null, '17 of the owner');
  // 273 in all.
  assert.equal(
    parseAeroUpdate({ ...base(), agents: [...full.agents, agent('extra', { room: FA })] }),
    null,
  );
  // With no floor on show (the Rooms style) the staff are at most 16 in all: the rooms' agents and the owner's together.
  const rooms = (n: number) =>
    Array.from({ length: n }, (_, i) => agent(`r${i}`, { room: floors[i % 4] }));
  assert.equal(MAX_AGENT_ROOMS, 16);
  assert.notEqual(parseAeroUpdate({ ...base(), agents: rooms(16) }), null);
  assert.equal(parseAeroUpdate({ ...base(), agents: rooms(17) }), null);
  assert.notEqual(parseAeroUpdate({ ...base(), agents: [...rooms(8), ...owner(8)] }), null);
  assert.equal(parseAeroUpdate({ ...base(), agents: [...rooms(9), ...owner(8)] }), null, '17 in all');
});

test('the fullest update, as Aero builds it, fits the host’s 64 KB', () => {
  const name = 'é'.repeat(40);
  const floors = Array.from({ length: MAX_FLOORS }, (_, i) => i.toString(16).padStart(12, '0'));
  const agents = [
    ...floors.flatMap((floor) =>
      Array.from({ length: 16 }, (_, i) => ({
        name,
        slug: `${i.toString(16)}${'a'.repeat(39)}`,
        floor,
      })),
    ),
    ...Array.from({ length: 16 }, (_, i) => ({
      name,
      slug: `o${i.toString(16)}${'a'.repeat(38)}`,
    })),
  ];
  const area = (i: number) => `Area ${i}`.padEnd(40, 'é');
  const update = {
    lunch: true,
    meeting: { time: '12:30', title: 'é'.repeat(60), soon: true },
    inbox: 99_999,
    agents,
    lounge: true,
    pods: {
      mappings: Object.fromEntries(
        Array.from({ length: 32 }, (_, i) => [
          `d${i}`.padEnd(40, 'é'),
          [0, 1, 2, 3].map((k) => area(i * 4 + k)),
        ]),
      ),
      labels: Object.fromEntries(
        Array.from({ length: 16 }, (_, i) => [area(i), { name: 'n'.repeat(40), dim: true }]),
      ),
    },
    floor: {
      id: FA,
      number: MAX_FLOORS,
      name: '😀'.repeat(32),
      rooms: Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(12, '0')),
    },
  };
  assert.notEqual(parseAeroUpdate(update), null);
  const bytes = new TextEncoder().encode(JSON.stringify(update)).length;
  assert.ok(bytes < 64 * 1024, `${bytes} bytes`);
});

// ── The office ─────────────────────────────────────────────────────

const COLS = 24;
const ROWS = 9;
const LEAD_BENCH = 'p1-lead';
const WOOD_A = 'p1-wood-a';
const WOOD_B = 'p1-wood-b';
const PC_LEAD = 'pc-lead';
const PC_A = 'pc-a';
const PC_B = 'pc-b';
const L = 10; // the Lounge's column offset from the one the other office tests use
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';

function seat(uid: string, col: number, row: number, facingDir: Direction = Direction.DOWN): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir, assigned: false };
}

let catalogReady = false;
function loadCatalog(): void {
  if (catalogReady) return;
  const sprite = (color: string) => Array.from({ length: 16 }, () => new Array<string>(16).fill(color));
  const entry = (id: string, state: 'on' | 'off') => ({
    id,
    label: id,
    category: 'electronics',
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: false,
    canPlaceOnWalls: false,
    groupId: 'pc',
    state,
  });
  assert.ok(
    buildDynamicCatalog({
      catalog: [entry('PC_OFF', 'off'), entry('PC_ON', 'on')],
      sprites: { PC_OFF: sprite('#111111'), PC_ON: sprite('#22ff22') },
    }),
  );
  catalogReady = true;
}

/** Pod 1 (columns 1..8, rows 2..6): the lead's bench at column 1, wooden benches at 4 and 7, a PC below each. */
function build(benches: Array<[string, number]> = [[WOOD_A, 4], [WOOD_B, 7]]): OfficeState {
  loadCatalog();
  const furniture: PlacedFurniture[] = [
    { uid: 'aero-0a1b2c3d-lounge-0', type: 'WHITEBOARD', col: 6 + L, row: 0 },
    { uid: 'aero-0a1b2c3d-lounge-1', type: 'CLOCK', col: 8 + L, row: 0 },
    { uid: LOUNGE_SEAT, type: 'SOFA_FRONT', col: 7 + L, row: 2 },
    { uid: 'aero-0a1b2c3d-lounge-3', type: 'COFFEE_TABLE', col: 8 + L, row: 4 },
    { uid: LEAD_BENCH, type: 'CUSHIONED_BENCH', col: 1, row: 3 },
    { uid: PC_LEAD, type: 'PC_OFF', col: 1, row: 4 },
    ...benches.flatMap(([uid, col], i) => [
      { uid, type: 'WOODEN_BENCH', col, row: 3 },
      { uid: i === 0 ? PC_A : PC_B, type: 'PC_OFF', col, row: 4 },
    ]),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 6; r++) {
    for (let c = 1; c <= 8; c++) areaTiles[r * COLS + c] = 'Pod 1';
    for (let c = 6 + L; c <= 11 + L; c++) areaTiles[r * COLS + c] = 'Lounge';
  }
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  const wall = (c: number, r: number) => {
    tiles[r * COLS + c] = TileType.WALL;
  };
  for (let c = 5 + L; c < COLS; c++) for (const r of [0, 1]) wall(c, r);
  for (let r = 2; r <= 7; r++) {
    wall(12 + L, r);
    wall(13 + L, r);
    if (r !== 5) wall(5 + L, r);
  }
  for (let c = 6 + L; c <= 10 + L; c++) wall(c, 7);
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture,
    areas: [
      { label: 'Pod 1', color: AREA_LABEL_FALLBACK_COLOR },
      { label: 'Lounge', color: AREA_LABEL_FALLBACK_COLOR },
    ],
    areaTiles,
    pets: [],
  };
  const os = new OfficeState(layout);
  os.seats = new Map([
    [LEAD_BENCH, seat(LEAD_BENCH, 1, 3)],
    ...benches.map(([uid, col]) => [uid, seat(uid, col, 3)] as [string, Seat]),
    [LOUNGE_SEAT, seat(LOUNGE_SEAT, 7 + L, 2)],
  ]);
  for (const [, col] of [[LEAD_BENCH, 1], ...benches] as Array<[string, number]>) {
    os.blockedTiles.add(`${col},3`);
  }
  os.blockedTiles.add(`${7 + L},2`);
  os.blockedTiles.add(`${8 + L},4`);
  os.walkableTiles = os.walkableTiles.filter((t) => !os.blockedTiles.has(`${t.col},${t.row}`));
  return os;
}

const rooms = (shown: string) => [shown];
function upd(
  shown: string | null,
  agents: unknown[],
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...base(),
    agents,
    pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Pod 1'], [FC]: ['Pod 1'] }, labels: {} },
    ...(shown === null
      ? {}
      : { floor: { id: shown, number: shown === FA ? 1 : 2, name: 'f', rooms: rooms(shown) } }),
    ...over,
  };
}
const staff = (floor: string, ...slugs: string[]) =>
  slugs.map((s) => agent(s, { floor, name: s[0].toUpperCase() + s.slice(1) }));
const shared = (...slugs: string[]) =>
  slugs.map((s) => agent(s, { name: s[0].toUpperCase() + s.slice(1) }));

function run(os: OfficeState, seconds: number, dt = 0.1): void {
  for (let t = 0; t < seconds; t += dt) os.update(dt);
}
function until(os: OfficeState, done: () => boolean, seconds = 60, what = 'condition'): void {
  for (let t = 0; t < seconds; t += 0.1) {
    if (done()) return;
    os.update(0.1);
  }
  assert.ok(done(), `${what} within ${seconds}s`);
}
const spawned = (os: OfficeState, seconds = MATRIX_EFFECT_DURATION + 0.5) => run(os, seconds);

/** A working lead of floor `floor`, seated by the pods. */
function lead(os: OfficeState, id: number, floor: string): void {
  os.addAgent(id, 0, 0, undefined, true, floor);
  os.setAgentActive(id, true);
}

const person = (os: OfficeState, slug: string, floor: string | null = null) =>
  os.aero.people.find((p) => p.slug === slug && p.floor === floor)!;
const onShow = (os: OfficeState, slug: string, floor: string | null = null): boolean =>
  os.aero.personOnFloor(person(os, slug, floor));
const names = (os: OfficeState): string[] =>
  os.aero.people.filter((p) => os.aero.personOnFloor(p)).map((p) => p.slug).sort();

test('people are keyed by floor: the same type on two floors is two people, each on its own floor only', () => {
  const os = build();
  assert.ok(setAeroUpdate(upd(FA, [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer', 'planner')])));
  spawned(os);
  assert.equal(os.aero.people.length, 3);
  assert.ok(os.aero.people.every((p) => p.ch.id <= PERSON_ID_BASE));
  assert.deepEqual(
    os.aero.people.map((p) => [p.slug, p.floor, p.room]),
    [
      ['reviewer', FA, null],
      ['reviewer', FB, null],
      ['planner', FB, null],
    ],
  );
  assert.deepEqual(names(os), ['reviewer']);
  assert.equal(os.aero.characters([]).length, 1, 'only floor A’s person is drawn');
  assert.deepEqual(
    os.aero.snapshot().people.map((p) => p.floor),
    [FA, FB, FB],
    'the snapshot says the floor',
  );
  // The other floor on show: the staff swap, nobody is made or lost.
  assert.ok(setAeroUpdate(upd(FB, [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer', 'planner')])));
  os.update(0.1);
  assert.equal(os.aero.people.length, 3);
  assert.deepEqual(names(os), ['planner', 'reviewer']);
  // A person whose floor leaves the update despawns; the others stay.
  assert.ok(setAeroUpdate(upd(FB, staff(FB, 'planner'))));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.deepEqual(
    os.aero.people.map((p) => [p.slug, p.floor]),
    [['planner', FB]],
  );
});

test('personOnFloor is public and follows update.floor.id; an update without a floor shows everyone', () => {
  const os = build();
  assert.ok(setAeroUpdate(upd(null, [...staff(FA, 'reviewer'), ...staff(FB, 'planner')])));
  spawned(os);
  assert.deepEqual(names(os), ['planner', 'reviewer']);
  assert.ok(setAeroUpdate(upd(FA, [...staff(FA, 'reviewer'), ...staff(FB, 'planner')])));
  os.update(0.1);
  assert.deepEqual(names(os), ['reviewer']);
});

test('the owner’s people are one shared set: on the floor on show, hidden where its roster has the type', () => {
  const os = build();
  const agents = [...staff(FA, 'reviewer'), ...shared('reviewer', 'explorer'), ...staff(FB, 'planner')];
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  assert.equal(os.aero.people.length, 4, 'the owner’s are made once, whatever the floors');
  assert.deepEqual(names(os), ['explorer', 'reviewer'], 'floor A: its reviewer, the owner’s explorer');
  assert.equal(onShow(os, 'reviewer', null), false, 'the owner’s reviewer is hidden on floor A');
  assert.equal(onShow(os, 'reviewer', FA), true);
  assert.ok(setAeroUpdate(upd(FB, agents)));
  os.update(0.1);
  assert.equal(onShow(os, 'reviewer', null), true, 'floor B has no reviewer of its own');
  assert.equal(onShow(os, 'explorer', null), true);
  assert.equal(onShow(os, 'planner', FB), true);
  assert.equal(onShow(os, 'reviewer', FA), false);
  assert.deepEqual(names(os), ['explorer', 'planner', 'reviewer']);
});

test('16 staff at most on a floor: its own types first, then the owner’s until 16', () => {
  const os = build();
  const own = Array.from({ length: 10 }, (_, i) => `own${i}`);
  const mine = Array.from({ length: 10 }, (_, i) => `mine${i}`);
  const agents = [...staff(FA, ...own), ...shared(...mine)];
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  const shown = os.aero.people.filter((p) => os.aero.personOnFloor(p));
  assert.equal(shown.length, 16);
  assert.equal(shown.filter((p) => p.floor === FA).length, 10);
  assert.deepEqual(
    shown.filter((p) => p.floor === null).map((p) => p.slug),
    mine.slice(0, 6),
    'the owner’s first six, in the order given',
  );
  // A floor with its own 16 shows none of the owner’s.
  const full = build();
  assert.ok(
    setAeroUpdate(
      upd(FA, [...staff(FA, ...Array.from({ length: 16 }, (_, i) => `t${i}`)), ...shared('x')]),
    ),
  );
  spawned(full);
  assert.equal(
    full.aero.people.filter((p) => full.aero.personOnFloor(p)).length,
    16,
    'the owner’s x is not drawn on a floor of 16',
  );
  assert.equal(onShow(full, 'x'), false);
  // A floor of two shows the owner’s as it stands.
  assert.ok(setAeroUpdate(upd(FB, [...staff(FA, 'a'), ...staff(FB, 'b', 'c'), ...shared('x')])));
  full.update(0.1);
  assert.equal(onShow(full, 'x'), true);
});

// ── Matching a subagent ────────────────────────────────────────────

test('match order: a free person of the lead’s floor and type, else a free owner person, else stock', () => {
  const os = build();
  lead(os, 1, FA);
  const agents = [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer', 'tester'), ...shared('explorer', 'reviewer')];
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  const sub = (tool: string) => os.addSubagent(1, tool);
  // The floor’s own reviewer, not floor B’s and not the owner’s.
  sub('t1');
  assert.equal(os.aero.subagentStarted(1, 't1', 'Subtask: reviewer'), true);
  assert.equal(person(os, 'reviewer', FA).subId !== null, true);
  assert.equal(person(os, 'reviewer', FB).subId, null);
  assert.equal(person(os, 'reviewer', null).subId, null);
  // The floor’s reviewer is busy: the owner’s is hidden on this floor, so the second is stock.
  const second = sub('t2');
  assert.equal(os.aero.subagentStarted(1, 't2', 'Subtask: reviewer'), false);
  assert.equal(os.characters.get(second)!.aeroHidden, undefined);
  assert.equal(person(os, 'reviewer', null).subId, null);
  // A type the floor lacks goes to the owner’s person.
  sub('t3');
  assert.equal(os.aero.subagentStarted(1, 't3', 'Subtask: explorer'), true);
  assert.equal(person(os, 'explorer', null).subId !== null, true);
  // A type only another floor has stays stock.
  const other = sub('t4');
  assert.equal(os.aero.subagentStarted(1, 't4', 'Subtask: tester'), false);
  assert.equal(os.characters.get(other)!.aeroHidden, undefined);
  assert.equal(person(os, 'tester', FB).subId, null);
});

test('a subagent of a lead on another floor is queued with nobody assigned, and matched when its floor is shown', () => {
  const os = build();
  lead(os, 1, FB);
  const agents = [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer')];
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  const subId = os.addSubagent(1, 't1');
  const sub = os.characters.get(subId)!;
  assert.equal(os.aero.subagentStarted(1, 't1', 'Subtask: reviewer'), false, 'nobody is assigned');
  assert.equal(person(os, 'reviewer', FA).subId, null, 'not floor A’s reviewer');
  assert.equal(person(os, 'reviewer', FB).subId, null, 'not floor B’s yet');
  assert.equal(sub.aeroHidden, undefined);
  run(os, 1);
  assert.equal(person(os, 'reviewer', FB).subId, null, 'still nobody while the floor is off');
  // Its floor on show: the queued subagent is matched, its stock sprite hidden, the person walking.
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 0.3);
  assert.equal(person(os, 'reviewer', FB).subId, subId);
  assert.equal(sub.aeroHidden, true);
  assert.equal(os.aero.snapshot().people.find((p) => p.floor === FB)!.away, true);
  assert.equal(person(os, 'reviewer', FA).subId, null);
});

test('a queued subagent that ends before its floor is shown is forgotten', () => {
  const os = build();
  lead(os, 1, FB);
  const agents = staff(FB, 'reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  os.addSubagent(1, 't1');
  assert.equal(os.aero.subagentStarted(1, 't1', 'Subtask: reviewer'), false);
  os.removeSubagent(1, 't1');
  run(os, 1);
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 1);
  assert.equal(person(os, 'reviewer', FB).subId, null);
  assert.equal(os.aero.snapshot().hidden.length, 0);
});

// ── The benches ────────────────────────────────────────────────────

function startReviewer(os: OfficeState, tool = 't1', slug = 'reviewer'): number {
  const id = os.addSubagent(1, tool);
  assert.equal(os.aero.subagentStarted(1, tool, `Subtask: ${slug}`), true, slug);
  return id;
}

test('a working person takes a free wooden bench of the lead’s pod, borrowed and never assigned, and its PC is on', () => {
  const os = build();
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  spawned(os);
  assert.equal(os.seatZone(os.characters.get(1)!.seatId!), 'Pod 1', 'the lead is in the pod');
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'the person sits');
  assert.ok([WOOD_A, WOOD_B].includes(p.ch.seatId!), `on a wooden bench, not ${p.ch.seatId}`);
  assert.equal(os.seats.get(p.ch.seatId!)!.assigned, false, 'borrowed, never assigned');
  assert.equal(os.aero.snapshot().people.find((x) => x.floor === FA)!.bench, p.ch.seatId);
  assert.deepEqual(os.aero.snapshot().benches, [p.ch.seatId]);
  const pc = p.ch.seatId === WOOD_A ? PC_A : PC_B;
  const other = pc === PC_A ? PC_B : PC_A;
  const on = os.aero.snapshot().pcsOn;
  assert.ok(on.includes(pc), 'the PC it faces is on');
  assert.ok(!on.includes(other), 'the other bench’s PC is off');
  assert.ok(on.includes(PC_LEAD), 'the active lead’s own PC is on');
  assert.deepEqual(os.getPersistableSeats()[1].seatId, os.characters.get(1)!.seatId);
});

test('two people working in one pod: two benches, two more PCs on; a third finds none and stands near', () => {
  const os = build();
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer', 'planner', 'tester'))));
  spawned(os);
  startReviewer(os, 't1', 'reviewer');
  startReviewer(os, 't2', 'planner');
  const a = person(os, 'reviewer', FA);
  const b = person(os, 'planner', FA);
  until(
    os,
    () => a.ch.state === CharacterState.TYPE && b.ch.state === CharacterState.TYPE,
    60,
    'both sit',
  );
  assert.deepEqual([a.ch.seatId, b.ch.seatId].sort(), [WOOD_A, WOOD_B]);
  const on = os.aero.snapshot().pcsOn;
  assert.deepEqual([...on].sort(), [PC_A, PC_B, PC_LEAD].sort());
  // The third has no bench: it walks to the nearest free tile, as before, and holds no seat.
  startReviewer(os, 't3', 'tester');
  const c = person(os, 'tester', FA);
  assert.equal(c.ch.seatId, null);
  until(os, () => c.ch.state !== CharacterState.WALK, 60, 'the third arrives');
  assert.equal(os.aero.snapshot().benches.length, 2);
});

test('a bench that becomes assigned stands its borrower up, to the nearest free tile, and its PC goes off', () => {
  const os = build([[WOOD_A, 4]]);
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'sits');
  assert.equal(p.ch.seatId, WOOD_A);
  assert.ok(os.aero.snapshot().pcsOn.includes(PC_A));
  // A teammate of the lead takes the bench the stock way: the seat is assigned.
  os.seats.get(WOOD_A)!.assigned = true;
  run(os, 0.2);
  assert.equal(p.ch.seatId, null, 'stood up');
  assert.notEqual(p.ch.state, CharacterState.TYPE, 'not sitting');
  assert.deepEqual(os.aero.snapshot().benches, []);
  assert.ok(!os.aero.snapshot().pcsOn.includes(PC_A), 'the PC is off again');
  run(os, 3);
  assert.notEqual(`${p.ch.tileCol},${p.ch.tileRow}`, '4,3', 'walked off the bench tile');
  assert.equal(p.subId !== null, true, 'still away, working');
});

test('the benches follow the floor: released when it leaves, taken again when it returns', () => {
  const os = build();
  lead(os, 1, FA);
  const agents = staff(FA, 'reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'sits');
  const held = p.ch.seatId!;
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 0.2);
  assert.equal(os.aero.personOnFloor(p), false);
  assert.deepEqual(os.aero.snapshot().benches, [], 'released when the floor left');
  assert.ok(!os.aero.snapshot().pcsOn.includes(held === WOOD_A ? PC_A : PC_B));
  assert.ok(setAeroUpdate(upd(FA, agents)));
  run(os, 0.3);
  assert.equal(os.aero.personOnFloor(p), true);
  assert.ok([WOOD_A, WOOD_B].includes(p.ch.seatId!), 'a bench again');
  assert.deepEqual(os.aero.snapshot().benches, [p.ch.seatId]);
});

// ── Freezing off the floor ─────────────────────────────────────────

test('a person off the floor does not move; its stand-in ending there puts it on a Lounge tile, not walking in view', () => {
  const os = build();
  lead(os, 1, FA);
  const agents = staff(FA, 'reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  run(os, 0.3);
  assert.equal(p.ch.state, CharacterState.WALK);
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 0.2);
  const frozen = [p.ch.x, p.ch.y];
  run(os, 3);
  assert.deepEqual([p.ch.x, p.ch.y], frozen, 'frozen where it was');
  // Its job ends while the floor is off: it is home at once, on the Lounge, standing.
  os.removeSubagent(1, 't1');
  run(os, 0.2);
  assert.equal(p.subId, null);
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.ok(p.ch.tileCol >= 6 + L && p.ch.tileCol <= 11 + L, `in the Lounge: col ${p.ch.tileCol}`);
  assert.equal(p.returning, false);
  const fx = os.aero.fx.started.poof ?? 0;
  assert.ok(setAeroUpdate(upd(FA, agents)));
  run(os, 0.3);
  assert.equal(os.aero.fx.started.poof ?? 0, fx, 'no poof for a return nobody saw');
  assert.ok(p.ch.tileCol >= 6 + L, 'still in the Lounge when the floor is back');
});

// ── The overlay ────────────────────────────────────────────────────

/** What `drawAeroOverlay` writes with `fillText` on a stub context (the names and the other texts of the frame). */
function drawnTexts(os: OfficeState): string[] {
  const texts: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'fillText') return (text: string) => texts.push(text);
        if (prop === 'measureText') return () => ({ width: 8 });
        return () => undefined;
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  drawAeroOverlay(ctx, os, 0, 0, 2);
  return texts;
}

test('names are drawn for the people on the floor on show only, by personOnFloor (an owner person on another floor, too)', () => {
  const os = build();
  lead(os, 1, FB);
  const agents = [...staff(FA, 'reviewer'), ...staff(FB, 'planner'), ...shared('explorer')];
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  const shown = drawnTexts(os);
  assert.ok(shown.includes('Reviewer'), 'floor A’s person');
  assert.ok(shown.includes('Explorer'), 'the owner’s, who is on every floor');
  assert.ok(!shown.includes('Planner'), 'floor B’s person is not drawn on floor A');
  // The owner’s person stands in for a subagent of floor B’s lead: off the floor, so no name here.
  os.addSubagent(1, 't1');
  assert.equal(os.aero.subagentStarted(1, 't1', 'Subtask: explorer'), false, 'queued, floor B is off');
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 0.3);
  assert.equal(person(os, 'explorer').subId !== null, true);
  assert.ok(drawnTexts(os).includes('Explorer'), 'on floor B it is where its lead is');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  run(os, 0.2);
  assert.ok(!drawnTexts(os).includes('Explorer'), 'standing in on floor B: no name on floor A');
});

// ── Fix round ──────────────────────────────────────────────────────

test('with no floor (the Rooms style) the owner’s person is hidden where a room agent has the type, 16 in all', () => {
  const os = build();
  const agents = [
    agent('reviewer', { room: FA, name: 'Reviewer' }),
    ...shared('reviewer', 'explorer'),
  ];
  assert.ok(setAeroUpdate(upd(null, agents)));
  spawned(os);
  assert.equal(os.aero.people.length, 3);
  const owners = os.aero.people.filter((p) => p.floor === null && p.room === null);
  assert.deepEqual(
    owners.map((p) => [p.slug, os.aero.personOnFloor(p)]),
    [
      ['reviewer', false],
      ['explorer', true],
    ],
  );
  // 10 room agents leave six places for the owner’s.
  const many = build();
  const rooms = Array.from({ length: 10 }, (_, i) => agent(`r${i}`, { room: FA, name: `R${i}` }));
  const mine = Array.from({ length: 6 }, (_, i) => agent(`m${i}`, { name: `M${i}` }));
  assert.ok(setAeroUpdate(upd(null, [...rooms, ...mine])));
  spawned(many);
  assert.equal(many.aero.people.filter((p) => many.aero.personOnFloor(p)).length, 16);
});

test('the snapshot says which people are shown', () => {
  const os = build();
  assert.ok(setAeroUpdate(upd(FA, [...staff(FA, 'reviewer'), ...staff(FB, 'planner'), ...shared('explorer')])));
  spawned(os);
  const shownOf = () => Object.fromEntries(os.aero.snapshot().people.map((p) => [p.slug, p.shown]));
  assert.deepEqual(shownOf(), { reviewer: true, planner: false, explorer: true });
  assert.ok(setAeroUpdate(upd(FB, [...staff(FA, 'reviewer'), ...staff(FB, 'planner'), ...shared('explorer')])));
  os.update(0.1);
  assert.deepEqual(shownOf(), { reviewer: false, planner: true, explorer: true });
});

test('a person whose bench was let go with its floor stands up on return when no bench is free, and stays off a tile it does not own', () => {
  const os = build([[WOOD_A, 4]]);
  lead(os, 1, FA);
  const agents = staff(FA, 'reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'sits');
  assert.equal(p.ch.seatId, WOOD_A);
  assert.ok(setAeroUpdate(upd(FB, agents)));
  run(os, 0.2);
  assert.equal(p.bench, null);
  // While the floor is off somebody is seated on the bench.
  os.seats.get(WOOD_A)!.assigned = true;
  assert.ok(setAeroUpdate(upd(FA, agents)));
  run(os, 3);
  assert.equal(p.bench, null);
  assert.equal(p.ch.seatId, null);
  assert.notEqual(`${p.ch.tileCol},${p.ch.tileRow}`, '4,3', 'off the bench tile');
  assert.ok(!os.aero.snapshot().pcsOn.includes(PC_A), 'its PC is off');
});

test('a layout rebuild lets the benches go: the people get up and their PCs go off', () => {
  const os = build();
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'sits');
  const bench = p.ch.seatId!;
  const benchSeat = os.seats.get(bench)!;
  const spot = `${benchSeat.seatCol},${benchSeat.seatRow}`;
  assert.ok(os.aero.snapshot().pcsOn.includes(bench === WOOD_A ? PC_A : PC_B));
  os.rebuildFromLayout(os.layout);
  os.update(0.1);
  assert.equal(p.bench, null);
  assert.deepEqual(os.aero.snapshot().benches, []);
  assert.ok(!os.aero.snapshot().pcsOn.includes(bench === WOOD_A ? PC_A : PC_B), 'refreshed at once');
  run(os, 3);
  assert.notEqual(`${p.ch.tileCol},${p.ch.tileRow}`, spot, 'not left sitting on the old bench tile');
});

test('a person whose stand-in ended before the tick takes the next subagent of its type', () => {
  const os = build();
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  spawned(os);
  startReviewer(os, 't1');
  const p = person(os, 'reviewer', FA);
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'sits');
  os.removeSubagent(1, 't1');
  const second = os.addSubagent(1, 't2');
  assert.equal(os.aero.subagentStarted(1, 't2', 'Subtask: reviewer'), true, 'no tick between');
  assert.equal(p.subId, second);
  assert.equal(os.characters.get(second)!.aeroHidden, true);
  run(os, 2);
  assert.equal(p.subId, second, 'it stays away for the second');
  assert.ok(p.bench !== null, 'on a bench again');
});

test('a subagent that starts before the first update is queued and matched once the people are made', () => {
  const os = build();
  lead(os, 1, FA);
  const subId = os.addSubagent(1, 't1');
  assert.equal(os.aero.subagentStarted(1, 't1', 'Subtask: reviewer'), false, 'nobody yet');
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  run(os, 0.5);
  assert.equal(person(os, 'reviewer', FA).subId, subId);
  assert.equal(os.characters.get(subId)!.aeroHidden, true);
});

test('a working person with no bench does not search again every tick, and takes one that is freed later', () => {
  const os = build([[WOOD_A, 4]]);
  lead(os, 1, FA);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  spawned(os);
  os.seats.get(WOOD_A)!.assigned = true;
  startReviewer(os);
  const p = person(os, 'reviewer', FA);
  assert.equal(p.bench, null);
  let searches = 0;
  const original = os.benchSeatsFor.bind(os);
  os.benchSeatsFor = (...args: Parameters<typeof original>) => {
    searches++;
    return original(...args);
  };
  run(os, 5);
  assert.equal(searches, 0, 'no new search while nothing changed');
  os.seats.get(WOOD_A)!.assigned = false;
  run(os, 0.3);
  assert.ok(searches >= 1);
  assert.equal(p.bench, WOOD_A, 'the freed bench is taken');
});

// ── Loose ends: the Lounge tiles and the floor switch ──────────────

const loungeKeys = (os: OfficeState): Set<string> =>
  new Set(os.aero.loungeWalkable.map((t) => `${t.col},${t.row}`));

test('a person spawns on a Lounge tile no hidden person of its floor stands on', () => {
  const os = build();
  os.aero.rng = () => 0;
  assert.ok(setAeroUpdate(upd(FA, staff(FB, 'x'))));
  spawned(os);
  const x = person(os, 'x', FB);
  assert.equal(onShow(os, 'x', FB), false, 'x is on another floor');
  assert.ok(setAeroUpdate(upd(FA, staff(FB, 'x', 'y'))));
  spawned(os);
  const y = person(os, 'y', FB);
  assert.notDeepEqual([y.ch.tileCol, y.ch.tileRow], [x.ch.tileCol, x.ch.tileRow]);
});

test('a hidden person of another floor does not take a tile from this floor’s person', () => {
  const os = build();
  os.aero.rng = () => 0;
  assert.ok(setAeroUpdate(upd(FA, staff(FB, 'x'))));
  spawned(os);
  const x = person(os, 'x', FB);
  assert.ok(setAeroUpdate(upd(FA, [...staff(FB, 'x'), ...staff(FA, 'y')])));
  spawned(os);
  const y = person(os, 'y', FA);
  assert.deepEqual([y.ch.tileCol, y.ch.tileRow], [x.ch.tileCol, x.ch.tileRow], 'floors apart may share');
});

test('the owner’s people count with everyone: a floor’s person keeps off their tile', () => {
  const os = build();
  os.aero.rng = () => 0;
  // The owner's reviewer is hidden on floor A (which has its own); it stands on the first tile.
  assert.ok(setAeroUpdate(upd(FA, [...staff(FA, 'reviewer'), ...shared('reviewer')])));
  spawned(os);
  const owner = person(os, 'reviewer', null);
  assert.equal(onShow(os, 'reviewer', null), false);
  assert.ok(setAeroUpdate(upd(FA, [...staff(FA, 'reviewer'), ...shared('reviewer'), ...staff(FB, 'z')])));
  spawned(os);
  const z = person(os, 'z', FB);
  assert.notDeepEqual([z.ch.tileCol, z.ch.tileRow], [owner.ch.tileCol, owner.ch.tileRow]);
});

test('with every Lounge tile held by people of its floor, a person still gets one (the old rule)', () => {
  const os = build();
  os.aero.rng = () => 0;
  os.update(0.1);
  os.aero.loungeWalkable = os.aero.loungeWalkable.slice(0, 3);
  const n = os.aero.loungeWalkable.length;
  assert.equal(n, 3);
  const slugs = Array.from({ length: n }, (_, i) => `h${i}`);
  assert.ok(setAeroUpdate(upd(FA, staff(FB, ...slugs))));
  spawned(os);
  assert.equal(os.aero.people.length, n);
  const tiles = new Set(os.aero.people.map((p) => `${p.ch.tileCol},${p.ch.tileRow}`));
  assert.equal(tiles.size, n, 'one each');
  assert.ok(setAeroUpdate(upd(FA, staff(FB, ...slugs, 'extra'))));
  spawned(os);
  const extra = person(os, 'extra', FB);
  assert.ok(extra, 'spawned');
  assert.ok(loungeKeys(os).has(`${extra.ch.tileCol},${extra.ch.tileRow}`), 'on a Lounge tile');
});

test('an owner person walking home when the floor id changes is home at once, standing, without a poof', () => {
  const os = build();
  lead(os, 1, FA);
  const agents = shared('reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', null);
  run(os, 0.3);
  assert.ok(setAeroUpdate(upd(FA, agents)));
  os.removeSubagent(1, 't1');
  run(os, 0.2);
  assert.equal(p.subId, null);
  assert.equal(p.returning, true, 'walking home');
  assert.equal(p.ch.state, CharacterState.WALK);
  assert.equal(onShow(os, 'reviewer', null), true, 'seen on both floors');
  const fx = os.aero.fx.started.poof ?? 0;
  assert.ok(setAeroUpdate(upd(FB, agents)));
  os.update(0.1);
  assert.equal(p.returning, false);
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.ok(loungeKeys(os).has(`${p.ch.tileCol},${p.ch.tileRow}`), 'on a Lounge tile');
  assert.deepEqual([p.ch.x, p.ch.y], [p.ch.tileCol * 16 + 8, p.ch.tileRow * 16 + 8]);
  assert.equal(os.aero.fx.started.poof ?? 0, fx, 'no poof');
});

test('a person walking home is left walking when the floor id does not change', () => {
  const os = build();
  lead(os, 1, FA);
  const agents = shared('reviewer');
  assert.ok(setAeroUpdate(upd(FA, agents)));
  spawned(os);
  startReviewer(os);
  const p = person(os, 'reviewer', null);
  run(os, 0.3);
  os.removeSubagent(1, 't1');
  run(os, 0.2);
  assert.equal(p.returning, true);
  assert.ok(setAeroUpdate(upd(FA, agents)));
  os.update(0.1);
  assert.equal(p.returning, true);
  assert.equal(p.ch.state, CharacterState.WALK);
});
