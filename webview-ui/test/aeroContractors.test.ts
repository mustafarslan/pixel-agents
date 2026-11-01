/**
 * Aero's front desk and contractors (docs/work/phase6-contractors/plan.md, task 3b): the receptionist and the guard, seated on chairs
 * held from the moment the layout is built, never handed out by any seat pick, greeting real lead arrivals; and contractors hired out
 * of the lifts, reused, sent out, and kept apart from the floors and leads they are not for.
 *
 * The first tests use a 14x8 room by hand with one ordinary desk seat and the two desk chairs (the uids end the way the open
 * office's do) facing down; the contractor tests use `buildFloor` (Pod 1, the Lounge, two lifts).
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { hashKey, MEN_NAMES, WOMEN_NAMES } from '../src/aero/names.js';
import { PERSON_ID_BASE, resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { drawAeroOverlay } from '../src/aero/overlay.js';
import { PR_RUNS_ROOM } from '../src/aero/update.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { getLoadedCharacterCount } from '../src/office/sprites/spriteData.js';
import type { OfficeLayout, PlacedFurniture, Seat } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  MATRIX_EFFECT_DURATION,
  TileType,
} from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

const COLS = 14;
const ROWS = 8;
const DESK = 'desk-0';
const GUARD = 'aero-0a1b2c3d-security-2';
const RECEPTION = 'aero-0a1b2c3d-reception-0';
const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';

function seat(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: false };
}

function layoutOf(chairs: boolean): OfficeLayout {
  const furniture: PlacedFurniture[] = [{ uid: DESK, type: 'CUSHIONED_BENCH', col: 2, row: 2 }];
  if (chairs) {
    furniture.push(
      { uid: GUARD, type: 'CUSHIONED_CHAIR_FRONT', col: 6, row: 2 },
      { uid: RECEPTION, type: 'CUSHIONED_CHAIR_FRONT', col: 10, row: 2 },
    );
  }
  return {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    pets: [],
  };
}

/** An office with the desk seat, and the two chairs when `chairs`; the seats are set by hand as the other Aero tests do. */
function build(chairs = true): OfficeState {
  const os = new OfficeState(layoutOf(chairs));
  os.seats = new Map([
    [DESK, seat(DESK, 2, 2)],
    ...(chairs
      ? ([
          [GUARD, seat(GUARD, 6, 2)],
          [RECEPTION, seat(RECEPTION, 10, 2)],
        ] as Array<[string, Seat]>)
      : []),
  ]);
  for (const [, s] of os.seats) os.blockedTiles.add(`${s.seatCol},${s.seatRow}`);
  os.walkableTiles = os.walkableTiles.filter((t) => !os.blockedTiles.has(`${t.col},${t.row}`));
  return os;
}

const run = (os: OfficeState, seconds: number, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) os.update(dt);
};

test('a layout with the two chairs seats the receptionist and the guard, facing down, held and apart from every list of people', () => {
  const os = build();
  const snap = os.aero.snapshot();
  assert.deepEqual(
    snap.npcs.map((n) => [n.role, n.seat, n.col, n.row, n.dir]),
    [
      ['receptionist', RECEPTION, 10, 2, Direction.DOWN],
      ['guard', GUARD, 6, 2, Direction.DOWN],
    ],
  );
  assert.equal(new Set(snap.npcs.map((n) => n.id)).size, 2, 'fixed, distinct ids');
  assert.equal(os.seats.get(GUARD)!.assigned, true);
  assert.equal(os.seats.get(RECEPTION)!.assigned, true);
  assert.equal(os.seats.get(DESK)!.assigned, false);
  assert.equal(os.characters.size, 0);
  assert.equal(os.aero.people.length, 0);
  // They are drawn, and they stay put through ticks.
  assert.equal(os.getCharacters().length, 2);
  run(os, 5);
  assert.deepEqual(
    os.aero.snapshot().npcs.map((n) => [n.col, n.row]),
    [
      [10, 2],
      [6, 2],
    ],
  );
});

test('a layout without the chairs has no front desk', () => {
  const os = build(false);
  assert.deepEqual(os.aero.snapshot().npcs, []);
  assert.equal(os.getCharacters().length, 0);
});

test('a rebuilt layout holds the chairs again and keeps the same ids; one without them removes the desk', () => {
  const os = build();
  const ids = os.aero.snapshot().npcs.map((n) => n.id);
  os.rebuildFromLayout(layoutOf(true));
  // The rebuilt seats come from the catalog (none here): put the chairs in by hand and hold again.
  os.seats = new Map([
    [GUARD, seat(GUARD, 6, 2)],
    [RECEPTION, seat(RECEPTION, 10, 2)],
  ]);
  os.aero.holdFrontDesk();
  assert.equal(os.seats.get(GUARD)!.assigned, true);
  assert.deepEqual(
    os.aero.snapshot().npcs.map((n) => n.id),
    ids,
  );
  os.rebuildFromLayout(layoutOf(false));
  assert.deepEqual(os.aero.snapshot().npcs, []);
});

test('a saved seat on a chair is dropped, and no pick hands a chair out: preferred seat, overflow, and the seat closest to an anchor', () => {
  const os = build();
  // A restore asking for the guard's chair.
  os.addAgent(1, 0, 0, GUARD, true);
  assert.equal(os.characters.get(1)!.seatId, DESK, 'the one free seat, not the chair');
  // Stage 3: no free seat is left but the chairs; nobody gets one.
  os.addAgent(2, 0, 0, undefined, true);
  os.addAgent(3, 0, 0, undefined, true);
  for (const id of [2, 3]) assert.equal(os.characters.get(id)!.seatId, null, `agent ${id}`);
  // A teammate beside an anchor at the chairs: closestFreeSeat skips them.
  os.addAgent(4, 0, 0, undefined, true, undefined, 1);
  assert.equal(os.characters.get(4)!.seatId, null);
  assert.equal(os.seats.get(GUARD)!.assigned, true);
  assert.equal(os.seats.get(RECEPTION)!.assigned, true);
  // A rebuild: an agent seated on the chair (as a saved layout once had it) is moved off it.
  os.rebuildFromLayout(layoutOf(true));
  os.seats = new Map([
    [DESK, seat(DESK, 2, 2)],
    [GUARD, seat(GUARD, 6, 2)],
    [RECEPTION, seat(RECEPTION, 10, 2)],
  ]);
  os.aero.holdFrontDesk();
  for (const ch of os.characters.values()) {
    assert.notEqual(ch.seatId, GUARD);
    assert.notEqual(ch.seatId, RECEPTION);
  }
  // Even a character that kept the chair as seatId through a rebuild is dropped by the first pass.
  const a = os.characters.get(1)!;
  a.seatId = GUARD;
  os.rebuildFromLayout(layoutOf(true));
  assert.notEqual(a.seatId, GUARD);
});

test('greetings: a lead arriving with a spawn effect on the floor is greeted once per role, for 3 seconds', () => {
  const os = build();
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 0, guard: 0 });
  os.addAgent(1, 0, 0, undefined, false);
  const snap = os.aero.snapshot();
  assert.deepEqual(snap.greetings, { receptionist: 1, guard: 1 });
  assert.deepEqual(
    snap.npcs.map((n) => [n.role, n.greeting]),
    [
      ['receptionist', '\u{1F44B}'],
      ['guard', '\u{1FAAA}'],
    ],
  );
  run(os, 2.5);
  assert.equal(os.aero.snapshot().npcs[0].greeting, '\u{1F44B}', 'still shown before 3 s');
  run(os, 0.8);
  assert.deepEqual(
    os.aero.snapshot().npcs.map((n) => n.greeting),
    [null, null],
  );
  assert.deepEqual(
    os.aero.snapshot().greetings,
    { receptionist: 1, guard: 1 },
    'counted, not repeated',
  );
});

test('no greeting on a restore, on a character of another floor, or on a floor switch', () => {
  const os = build();
  // A restore passes skipSpawnEffect.
  os.addAgent(1, 0, 0, undefined, true);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 0, guard: 0 });
  // A lead of the floor not on show.
  const update = (shown: string) => ({
    lunch: false,
    meeting: null,
    inbox: 0,
    lounge: true,
    agents: [],
    pods: { mappings: {}, labels: {} },
    floor: { id: shown, number: 1, name: 'f', rooms: [shown] },
  });
  assert.ok(setAeroUpdate(update(FA)));
  os.addAgent(2, 0, 0, undefined, false, FB);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 0, guard: 0 }, 'off the floor');
  // Switching to its floor shows it: that is no arrival.
  assert.ok(setAeroUpdate(update(FB)));
  run(os, 1);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 0, guard: 0 }, 'floor switch');
  // A lead arriving on the floor on show now is greeted.
  os.addAgent(3, 0, 0, undefined, false, FB);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 1, guard: 1 });
});

test('a teammate (placed beside its lead) is not greeted: it appears by its lead, not at the entrance', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true);
  os.addAgent(2, 0, 0, undefined, false, undefined, 1);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 0, guard: 0 });
  os.addAgent(3, 0, 0, undefined, false);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 1, guard: 1 });
});

// ── Contractors ────────────────────────────────────────────────────
//
// Pod 1 in columns 1..8 (the lead's bench and two wooden benches, a PC below each), the Lounge in columns 16..21, and two lifts at
// the bottom, columns 10..13 of row 8 in front of them; the turnstiles block (10,7) and (13,7), the gap is columns 11 and 12.

const CROWS = 10;
const L = 10;
const LEAD_BENCH = 'p1-lead';
const WOOD_A = 'p1-wood-a';
const WOOD_B = 'p1-wood-b';
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';
const FC = 'cccccccccccc';

let catalogReady = false;
function loadCatalog(): void {
  if (catalogReady) return;
  const sprite = (color: string) =>
    Array.from({ length: 16 }, () => new Array<string>(16).fill(color));
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
      catalog: [
        entry('PC_OFF', 'off'),
        entry('PC_ON', 'on'),
        // The chairs, so a layout build makes seats of them as the page does.
        {
          ...entry('CUSHIONED_CHAIR_FRONT', 'off'),
          category: 'chairs',
          groupId: undefined,
          state: undefined,
          orientation: 'front',
        },
        {
          ...entry('CUSHIONED_BENCH', 'off'),
          category: 'chairs',
          groupId: undefined,
          state: undefined,
          orientation: 'front',
        },
      ],
      sprites: {
        PC_OFF: sprite('#111111'),
        PC_ON: sprite('#22ff22'),
        CUSHIONED_CHAIR_FRONT: sprite('#884422'),
        CUSHIONED_BENCH: sprite('#884422'),
      },
    }),
  );
  catalogReady = true;
}

function buildFloor(lifts = true): OfficeState {
  loadCatalog();
  const furniture: PlacedFurniture[] = [
    { uid: 'aero-0a1b2c3d-lounge-0', type: 'WHITEBOARD', col: 6 + L, row: 0 },
    { uid: 'aero-0a1b2c3d-lounge-1', type: 'CLOCK', col: 8 + L, row: 0 },
    { uid: LOUNGE_SEAT, type: 'SOFA_FRONT', col: 7 + L, row: 2 },
    { uid: 'aero-0a1b2c3d-lounge-3', type: 'COFFEE_TABLE', col: 8 + L, row: 4 },
    { uid: LEAD_BENCH, type: 'CUSHIONED_BENCH', col: 1, row: 3 },
    { uid: 'pc-lead', type: 'PC_OFF', col: 1, row: 4 },
    { uid: WOOD_A, type: 'WOODEN_BENCH', col: 4, row: 3 },
    { uid: 'pc-a', type: 'PC_OFF', col: 4, row: 4 },
    { uid: WOOD_B, type: 'WOODEN_BENCH', col: 7, row: 3 },
    { uid: 'pc-b', type: 'PC_OFF', col: 7, row: 4 },
    { uid: GUARD, type: 'CUSHIONED_CHAIR_FRONT', col: 3, row: 8 },
    { uid: RECEPTION, type: 'CUSHIONED_CHAIR_FRONT', col: 5, row: 8 },
    ...(lifts
      ? [
          { uid: 'lift-0', type: 'AERO_ELEVATOR', col: 10, row: 8 },
          { uid: 'lift-1', type: 'AERO_ELEVATOR', col: 12, row: 8 },
        ]
      : []),
  ];
  const areaTiles: Array<string | null> = new Array(24 * CROWS).fill(null);
  for (let r = 2; r <= 6; r++) {
    for (let c = 1; c <= 8; c++) areaTiles[r * 24 + c] = 'Pod 1';
    for (let c = 6 + L; c <= 11 + L; c++) areaTiles[r * 24 + c] = 'Lounge';
  }
  const tiles = new Array<TileType>(24 * CROWS).fill(TileType.FLOOR_1);
  const wall = (c: number, r: number) => {
    tiles[r * 24 + c] = TileType.WALL;
  };
  for (let c = 5 + L; c < 24; c++) for (const r of [0, 1]) wall(c, r);
  for (let r = 2; r <= 7; r++) {
    wall(12 + L, r);
    wall(13 + L, r);
    if (r !== 5) wall(5 + L, r);
  }
  for (let c = 6 + L; c <= 10 + L; c++) wall(c, 7);
  const layout: OfficeLayout = {
    version: 1,
    cols: 24,
    rows: CROWS,
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
    [WOOD_A, seat(WOOD_A, 4, 3)],
    [WOOD_B, seat(WOOD_B, 7, 3)],
    [LOUNGE_SEAT, seat(LOUNGE_SEAT, 7 + L, 2)],
    [GUARD, seat(GUARD, 3, 8)],
    [RECEPTION, seat(RECEPTION, 5, 8)],
  ]);
  for (const col of [1, 4, 7, 3, 5])
    os.blockedTiles.add(`${col},${col === 3 || col === 5 ? 8 : 3}`);
  for (const k of ['10,7', '13,7', '10,9', '11,9', '12,9', '13,9', `${7 + L},2`, `${8 + L},4`]) {
    os.blockedTiles.add(k);
  }
  os.walkableTiles = os.walkableTiles.filter((t) => !os.blockedTiles.has(`${t.col},${t.row}`));
  return os;
}

const upd = (shown: string | null, agents: unknown[]): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents,
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Pod 1'], [FC]: ['Pod 1'] }, labels: {} },
  ...(shown === null
    ? {}
    : { floor: { id: shown, number: shown === FA ? 1 : 2, name: 'f', rooms: [shown] } }),
});
const staff = (floor: string, ...slugs: string[]) =>
  slugs.map((s) => ({ name: s[0].toUpperCase() + s.slice(1), slug: s, floor }));

function until(os: OfficeState, done: () => boolean, seconds = 60, what = 'condition'): void {
  for (let t = 0; t < seconds; t += 0.1) {
    if (done()) return;
    os.update(0.1);
  }
  assert.ok(done(), `${what} within ${seconds}s`);
}

/** A floor A with a working lead and a reviewer, spawned. */
function floorA(os = buildFloor(), agents: unknown[] = staff(FA, 'reviewer')): OfficeState {
  os.addAgent(1, 0, 0, undefined, true, FA);
  os.setAgentActive(1, true);
  assert.ok(setAeroUpdate(upd(FA, agents)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  return os;
}
let tool = 0;
function start(os: OfficeState, slug = 'reviewer', parent = 1): { tool: string; ok: boolean } {
  const t = `tool-${++tool}`;
  os.addSubagent(parent, t);
  return { tool: t, ok: os.aero.subagentStarted(parent, t, `Subtask: ${slug}`) };
}
const contractors = (os: OfficeState) =>
  os.aero.snapshot().people.filter((p) => p.kind === 'contractor');
const liftTiles = ['10,8', '11,8', '12,8', '13,8'];

test('every person of the type busy: the next subagent hires a contractor out of a lift, named #2, to a bench in the lead’s pod', () => {
  const os = floorA();
  assert.deepEqual(
    os.aero.snapshot().lobby.map((t) => `${t.col},${t.row}`),
    liftTiles,
  );
  assert.equal(start(os).ok, true, 'the floor’s own reviewer');
  assert.equal(contractors(os).length, 0);
  const second = start(os);
  assert.equal(second.ok, true, 'a contractor');
  const [c] = contractors(os);
  assert.equal(c.name, 'Reviewer #2');
  assert.equal(c.number, 2);
  assert.ok(liftTiles.includes(`${c.col},${c.row}`), 'out of a lift');
  assert.ok(c.id <= PERSON_ID_BASE, 'a page-only id');
  assert.equal(
    os.aero.snapshot().greetings.receptionist,
    0,
    'greeted once it is out, not when hired',
  );
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.deepEqual(os.aero.snapshot().greetings, { receptionist: 1, guard: 1 });
  const p = os.aero.people.find((x) => x.contractor)!;
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'the contractor sits');
  const benches = os.aero
    .snapshot()
    .people.map((x) => x.bench)
    .sort();
  assert.deepEqual(benches, [WOOD_A, WOOD_B], 'both on benches of the lead’s pod');
  assert.equal(os.seats.get(p.ch.seatId!)!.assigned, false, 'borrowed, never assigned');
  assert.equal(os.characters.get(os.getSubagentId(1, second.tool)!)!.aeroHidden, true);
});

test('a duplicated subagentToolStart hires once: the second call is already matched', () => {
  const os = floorA();
  start(os);
  const { tool: t } = start(os);
  assert.equal(contractors(os).length, 1);
  assert.equal(os.aero.subagentStarted(1, t, 'Subtask: reviewer'), true);
  assert.equal(os.aero.subagentStarted(1, t, 'Subtask: reviewer'), true);
  assert.equal(contractors(os).length, 1);
  assert.equal(os.aero.people.length, 2);
});

test('contractors take the lowest free number, spawn on free lobby tiles, and are 8 at most on a floor', () => {
  const os = floorA();
  const tools: string[] = [];
  start(os);
  for (let i = 0; i < 3; i++) tools.push(start(os).tool);
  assert.deepEqual(
    contractors(os).map((c) => c.number),
    [2, 3, 4],
  );
  const spawn = contractors(os).map((c) => `${c.col},${c.row}`);
  assert.equal(new Set(spawn).size, 3, 'each on a free lobby tile');
  assert.ok(spawn.every((k) => liftTiles.includes(k)));
  // #3's work ends and it leaves; the next hire takes 3 again.
  os.removeSubagent(1, tools[1]);
  run(os, 130);
  assert.deepEqual(
    contractors(os).map((c) => c.number),
    [2, 4],
  );
  start(os);
  assert.deepEqual(
    contractors(os)
      .map((c) => c.number)
      .sort(),
    [2, 3, 4],
  );
  // Up to 8 on the floor; the next subagent stays stock.
  for (let i = 0; i < 5; i++) assert.equal(start(os).ok, true);
  assert.equal(contractors(os).length, 8);
  const extra = start(os);
  assert.equal(extra.ok, false);
  assert.equal(os.characters.get(os.getSubagentId(1, extra.tool)!)!.aeroHidden, undefined);
  assert.equal(contractors(os).length, 8);
  assert.equal(new Set(os.aero.people.map((p) => p.ch.id)).size, os.aero.people.length);
});

test('a contractor done waits in the Lounge, is reused within 120 s of ticks, and otherwise walks to the lift and despawns', () => {
  const os = floorA();
  start(os);
  const a = start(os);
  const id = contractors(os)[0].id;
  run(os, 8);
  os.removeSubagent(1, a.tool);
  until(
    os,
    () => contractors(os)[0].col >= 16 && contractors(os)[0].state !== CharacterState.WALK,
    30,
    'in the Lounge',
  );
  // Reused after a minute: same character, same name, no #3.
  run(os, 60);
  assert.ok(contractors(os)[0].idle >= 55);
  const again = start(os);
  assert.equal(again.ok, true);
  assert.deepEqual(
    contractors(os).map((c) => [c.id, c.name, c.idle]),
    [[id, 'Reviewer #2', 0]],
  );
  run(os, 8);
  // Done again: 119 s still waits, then it walks out.
  os.removeSubagent(1, again.tool);
  run(os, 3);
  run(os, 116);
  assert.equal(contractors(os)[0].leaving, false, '119 s of ticks');
  until(os, () => contractors(os).length === 0 || contractors(os)[0].leaving, 10, 'it starts out');
  // Reusable until the despawn starts: a start now takes it back.
  const back = start(os);
  assert.equal(back.ok, true);
  assert.deepEqual(
    contractors(os).map((c) => [c.id, c.leaving]),
    [[id, false]],
  );
  run(os, 8);
  os.removeSubagent(1, back.tool);
  // Gone for good: it walks to the lift lobby and despawns there.
  let last = contractors(os)[0];
  for (let t = 0; t < 200 && contractors(os).length > 0; t += 0.1) {
    os.update(0.1);
    if (contractors(os).length > 0) last = contractors(os)[0];
  }
  assert.equal(contractors(os).length, 0, 'despawned');
  assert.equal(last.leaving, true);
  assert.ok(
    liftTiles.includes(`${last.col},${last.row}`),
    `at the lift, not ${last.col},${last.row}`,
  );
});

test('a contractor expiring off the floor is removed at once, with no walk', () => {
  const os = floorA();
  start(os);
  const a = start(os);
  run(os, 8);
  os.removeSubagent(1, a.tool);
  run(os, 2);
  assert.ok(setAeroUpdate(upd(FB, staff(FA, 'reviewer'))));
  run(os, 1);
  assert.equal(contractors(os)[0].shown, false);
  run(os, 123);
  assert.equal(contractors(os).length, 0);
  assert.equal(os.aero.people.length, 1, 'the floor’s own reviewer stays');
});

test('no contractor for a PR-run lead, without a lift, or without a floor on show', () => {
  // A PR-run lead: a free person still stands in, past that the subagent is stock.
  const os = floorA();
  os.addAgent(2, 0, 0, undefined, true, PR_RUNS_ROOM);
  start(os);
  assert.equal(start(os, 'reviewer', 2).ok, false);
  assert.equal(contractors(os).length, 0);
  assert.equal(start(os).ok, true, 'a lead of the floor in the same state does get one');
  assert.equal(contractors(os).length, 1);
  // No lift in the layout.
  const bare = floorA(buildFloor(false));
  start(bare);
  assert.equal(start(bare).ok, false);
  assert.deepEqual(bare.aero.snapshot().lobby, []);
  assert.equal(contractors(bare).length, 0);
  // The Rooms style: no floor on show.
  const rooms = buildFloor();
  rooms.addAgent(1, 0, 0, undefined, true, FA);
  rooms.setAgentActive(1, true);
  assert.ok(setAeroUpdate(upd(null, [{ name: 'Reviewer', slug: 'reviewer', room: FA }])));
  run(rooms, 1);
  start(rooms);
  assert.equal(start(rooms).ok, false);
  assert.equal(contractors(rooms).length, 0);
});

test('an update does not despawn contractors: reconcile leaves them to their own timer', () => {
  const os = floorA();
  start(os);
  start(os);
  run(os, 3);
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  run(os, 3);
  const c = os.aero.people.find((p) => p.contractor)!;
  assert.equal(c.ch.matrixEffect, null);
  assert.equal(c.subId !== null, true);
  // Even an update that no longer lists the type keeps a contractor at work.
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'planner'))));
  run(os, 3);
  assert.equal(contractors(os).length, 1);
  assert.equal(os.aero.people.find((p) => p.contractor)!.ch.matrixEffect, null);
});

test('the floor switching while a contractor walks in freezes it, and it gets a bench on return', () => {
  const os = floorA();
  start(os);
  start(os);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const before = contractors(os)[0];
  assert.equal(before.state, CharacterState.WALK);
  assert.ok(setAeroUpdate(upd(FB, staff(FA, 'reviewer'))));
  run(os, 0.3);
  const away = contractors(os)[0];
  assert.equal(away.shown, false);
  run(os, 5);
  const frozen = contractors(os)[0];
  assert.deepEqual([frozen.col, frozen.row], [away.col, away.row]);
  assert.equal(frozen.bench, null, 'its bench is let go while its floor is off');
  assert.ok(setAeroUpdate(upd(FA, staff(FA, 'reviewer'))));
  const p = os.aero.people.find((x) => x.contractor)!;
  until(os, () => p.ch.state === CharacterState.TYPE, 60, 'back at a bench');
  assert.ok([WOOD_A, WOOD_B].includes(p.ch.seatId!));
  assert.equal(contractors(os).length, 1);
});

test('a layout rebuild takes away a contractor on its way out', () => {
  const os = floorA();
  start(os);
  const a = start(os);
  run(os, 8);
  os.removeSubagent(1, a.tool);
  until(os, () => contractors(os)[0]?.leaving === true, 150, 'it leaves');
  os.seats = new Map(os.seats);
  os.update(0.1);
  os.update(0.1);
  assert.equal(contractors(os).length, 0);
});

// ── The fix round ──────────────────────────────────────────────────

const freeContractor = (os: OfficeState) => {
  const p = os.aero.people.find((x) => x.contractor)!;
  return p;
};

test('a PR-run lead never reuses a contractor: past the free people the subagent is stock', () => {
  const os = floorA();
  os.addAgent(2, 0, 0, undefined, true, PR_RUNS_ROOM);
  start(os);
  const b = start(os);
  run(os, 8);
  os.removeSubagent(1, b.tool);
  run(os, 3);
  assert.equal(contractors(os)[0].away, false, 'the contractor is free');
  const pr = start(os, 'reviewer', 2);
  assert.equal(pr.ok, false, 'the person is busy, the free contractor is not for a PR run');
  assert.equal(freeContractor(os).subId, null);
  assert.equal(os.characters.get(os.getSubagentId(2, pr.tool)!)!.aeroHidden, undefined);
});

test('a subagent of another floor never reuses this floor’s free contractor: it hires its own, numbered per floor', () => {
  const os = floorA(buildFloor(), [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer')]);
  start(os);
  const b = start(os);
  run(os, 8);
  os.removeSubagent(1, b.tool);
  run(os, 3);
  const a = freeContractor(os);
  assert.equal(a.subId, null);
  assert.ok(setAeroUpdate(upd(FB, [...staff(FA, 'reviewer'), ...staff(FB, 'reviewer')])));
  os.addAgent(2, 0, 0, undefined, true, FB);
  os.setAgentActive(2, true);
  run(os, 1);
  assert.equal(start(os, 'reviewer', 2).ok, true, 'floor B’s own reviewer');
  assert.equal(start(os, 'reviewer', 2).ok, true, 'a contractor of floor B');
  assert.equal(a.subId, null, 'floor A’s contractor is untouched');
  const all = os.aero.snapshot().people.filter((p) => p.kind === 'contractor');
  assert.deepEqual(all.map((c) => [c.floor, c.number]).sort(), [
    [FA, 2],
    [FB, 2],
  ]);
});

test('a type the floor’s roster lacks is stock, with the floor’s person busy or not', () => {
  const os = floorA();
  start(os);
  for (const type of ['planner', 'general-purpose']) {
    assert.equal(start(os, type).ok, false, type);
  }
  assert.equal(contractors(os).length, 0);
});

test('a rebuilt layout drops a saved seat on a desk chair: the hold runs before the first pass', () => {
  loadCatalog();
  const os = new OfficeState(layoutOf(true));
  assert.ok(os.seats.has(GUARD) && os.seats.has(DESK), 'the catalog gives the chairs seats');
  assert.equal(os.seats.get(GUARD)!.assigned, true, 'held from the build');
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  assert.equal(ch.seatId, DESK);
  // The agent’s saved seat is the guard’s chair.
  ch.seatId = GUARD;
  os.rebuildFromLayout(layoutOf(true));
  assert.notEqual(ch.seatId, GUARD);
  assert.notEqual(ch.seatId, RECEPTION);
  assert.equal(os.seats.get(GUARD)!.assigned, true);
});

test('a contractor expiring on a lobby tile while walking stands and despawns there', () => {
  const os = floorA();
  start(os);
  const b = start(os);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const p = freeContractor(os);
  os.removeSubagent(1, b.tool);
  p.contractor!.idle = 119.95;
  // On a lift tile, on its way somewhere (an old path).
  p.ch.tileCol = 11;
  p.ch.tileRow = 8;
  p.ch.x = 11 * 16 + 8;
  p.ch.y = 8 * 16 + 8;
  p.ch.path = [
    { col: 12, row: 8 },
    { col: 13, row: 8 },
  ];
  p.ch.state = CharacterState.WALK;
  os.update(0.1);
  assert.equal(p.contractor!.leaving, true);
  assert.equal(p.ch.matrixEffect, 'despawn');
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.deepEqual([p.ch.tileCol, p.ch.tileRow], [11, 8]);
  assert.deepEqual(p.ch.path, []);
});

test('a stand-in for a PR-run lead whose home floor is not shown goes home unseen, not frozen at its desk', () => {
  const os = floorA();
  os.addAgent(2, 0, 0, undefined, true, PR_RUNS_ROOM);
  const t = start(os, 'reviewer', 2);
  assert.equal(t.ok, true);
  const p = os.aero.people.find((x) => !x.contractor)!;
  run(os, 3);
  assert.ok(setAeroUpdate(upd(FB, staff(FA, 'reviewer'))));
  run(os, 1);
  assert.equal(os.aero.personOnFloor(p), true, 'the PR run is on every floor, so is its stand-in');
  os.removeSubagent(2, t.tool);
  os.update(0.1);
  assert.equal(os.aero.personOnFloor(p), false, 'home is on floor A');
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.equal(p.returning, false);
  assert.ok(p.ch.tileCol >= 16, `snapped to the Lounge, at ${p.ch.tileCol},${p.ch.tileRow}`);
});

test('a layout rebuild stands the people at home even on the Lounge floor: nothing walks on, no stray poof', () => {
  const os = floorA();
  const t = start(os);
  const p = os.aero.people.find((x) => !x.contractor)!;
  run(os, 5);
  os.removeSubagent(1, t.tool);
  until(
    os,
    () => p.ch.tileCol >= 16 && p.ch.state === CharacterState.WALK,
    60,
    'walking home, on the Lounge',
  );
  assert.equal(p.returning, true);
  const poofs = os.aero.snapshot().fxStarted.poof ?? 0;
  os.seats = new Map(os.seats);
  os.update(0.1);
  assert.equal(p.returning, false);
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.deepEqual(p.ch.path, []);
  run(os, 10);
  assert.equal(os.aero.snapshot().fxStarted.poof ?? 0, poofs, 'no poof after the rebuild');
});

test('a reused leaving contractor with nowhere to route stops its walk to the lift', () => {
  const os = floorA();
  start(os);
  start(os);
  const c = start(os);
  assert.equal(c.ok, true);
  run(os, 8);
  os.removeSubagent(1, c.tool);
  const p = os.aero.people.filter((x) => x.contractor).find((x) => x.contractor!.number === 3)!;
  until(
    os,
    () => p.contractor!.leaving && p.ch.state === CharacterState.WALK,
    200,
    'walking to the lift',
  );
  os.walkableTiles = [];
  const again = start(os);
  assert.equal(again.ok, true, 'reused');
  assert.equal(p.contractor!.leaving, false);
  assert.notEqual(p.ch.state, CharacterState.WALK);
  assert.deepEqual(p.ch.path, []);
});

// ── Names and roles over the characters (docs/work/phase6-office-look/plan.md, task A) ──

const labelsOf = (os: OfficeState) => os.aero.snapshot().labels;
const labelOf = (os: OfficeState, kind: string, key?: string) =>
  labelsOf(os).find((l) => l.kind === kind && (key === undefined || l.key === key))!;

/** What `drawAeroOverlay` draws on a recording stub: the texts with their position, and the filled rectangles. */
function drawn(
  os: OfficeState,
  show?: { alwaysShowOverlay: boolean; hoveredId: number | null; selectedId: number | null },
) {
  let seq = 0;
  let font = '';
  const texts: Array<{ text: string; x: number; y: number; seq: number; size: number }> = [];
  const rects: Array<{ y: number; h: number; seq: number }> = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillText')
          return (text: string, x: number, y: number) =>
            texts.push({ text, x, y, seq: seq++, size: Number(/(\d+)px/.exec(font)?.[1] ?? 0) });
        if (prop === 'fillRect')
          return (_x: number, y: number, _w: number, h: number) => rects.push({ y, h, seq: seq++ });
        if (prop === 'measureText') return () => ({ width: 8 });
        return () => undefined;
      },
      set(_t, prop, value) {
        if (prop === 'font') font = String(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  drawAeroOverlay(ctx, os, 0, 0, 2, show);
  return { texts, rects };
}

test('labels: a person has a key, a palette hashed from it, a first name of its look, and its role from the slug', () => {
  const os = floorA(buildFloor(), staff(FA, 'code-reviewer', 'architect'));
  const palettes = Math.max(1, getLoadedCharacterCount());
  for (const [slug, role] of [
    ['code-reviewer', 'Reviewer'],
    ['architect', 'Architect'],
  ] as const) {
    const l = labelOf(os, 'person', `${FA}//${slug}`);
    assert.ok(l, slug);
    assert.equal(l.role, role);
    assert.equal(
      l.palette,
      hashKey(l.key) % palettes,
      'the palette follows the key, not the order',
    );
    assert.ok((l.palette % 2 === 0 ? MEN_NAMES : WOMEN_NAMES).includes(l.first), l.first);
    assert.equal(
      os.aero.people.find((p) => p.slug === slug)!.ch.palette,
      l.palette,
      'the label says the sprite’s palette',
    );
  }
});

test('labels: the front desk is Reception on a woman’s palette and Security on a man’s', () => {
  const os = floorA();
  const rec = labelOf(os, 'desk', 'desk/receptionist');
  const guard = labelOf(os, 'desk', 'desk/guard');
  assert.equal(rec.role, 'Reception');
  assert.equal(guard.role, 'Security');
  assert.equal(rec.palette % 2, 1);
  assert.equal(guard.palette % 2, 0);
  assert.ok(WOMEN_NAMES.includes(rec.first));
  assert.ok(MEN_NAMES.includes(guard.first));
});

test('labels: a contractor says Reviewer #2, a lead Lead, a PR run’s lead PR, and a stock subagent Subagent', () => {
  const os = floorA();
  start(os);
  start(os);
  assert.equal(labelOf(os, 'contractor').role, 'Reviewer #2');
  assert.match(labelOf(os, 'contractor').key, new RegExp(`^${FA}//reviewer#2$`));
  assert.equal(labelOf(os, 'lead').role, 'Lead');
  // A stock subagent nobody stands in for (no roster type matches) stays a stock character.
  os.addSubagent(1, 'plain');
  assert.equal(os.aero.subagentStarted(1, 'plain', 'Subtask: nobody-has-this'), false);
  assert.equal(labelOf(os, 'subagent').role, 'Subagent');
  // Another lead in the PR runs' folder.
  os.addAgent(2, 0, 0, undefined, true, FA);
  os.characters.get(2)!.directoryName = PR_RUNS_ROOM;
  const pr = labelsOf(os).find((l) => l.id === 2)!;
  assert.equal(pr.role, 'PR');
  assert.equal(pr.kind, 'lead');
});

test('labels: the names on show are all different, and the same after a reload', () => {
  const agents = staff(FA, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h');
  const first = floorA(buildFloor(), agents);
  start(first);
  const before = labelsOf(first);
  assert.ok(before.length >= 10);
  assert.equal(new Set(before.map((l) => l.first)).size, before.length, 'unique on the floor');
  assert.equal(new Set(before.map((l) => l.key)).size, before.length, 'unique keys');
  resetAeroUpdate();
  const again = floorA(buildFloor(), agents);
  start(again);
  const pick = (os: OfficeState) =>
    Object.fromEntries(
      labelsOf(os)
        .filter((l) => l.kind !== 'lead' && l.kind !== 'subagent')
        .map((l) => [l.key, `${l.first}/${l.palette}`]),
    );
  assert.deepEqual(pick(again), pick(first));
});

test('the overlay draws one line, Name · Role, with the bubble above it', () => {
  const os = floorA();
  const label = labelOf(os, 'person', `${FA}//reviewer`);
  const { texts } = drawn(os);
  const mine = texts.filter((t) => t.text.includes('Reviewer'));
  assert.deepEqual(
    mine.map((t) => t.text),
    [`${label.first} · Reviewer`, `${label.first} · Reviewer`],
    'one line (drawn twice, the shadow and the ink), not a name and a role apart',
  );
  const guard = labelOf(os, 'desk', 'desk/guard');
  assert.ok(texts.some((t) => t.text === `${guard.first} · Security`));
  // A greeting bubble stands above the guard’s line.
  os.aero.npcs.find((n) => n.role === 'guard')!.greet = 2;
  const withBubble = drawn(os);
  const line = withBubble.texts.filter((t) => t.text === `${guard.first} · Security`).pop()!;
  const bubble = withBubble.texts.find((t) => t.text === '\u{1FAAA}')!;
  assert.equal(bubble.x, line.x, 'over the same centre');
  // The bubble's plate (the last rectangle before its text) ends at or above the top of the name's letters.
  const plate = withBubble.rects.filter((r) => r.seq < bubble.seq).pop()!;
  assert.ok(
    plate.y + plate.h <= line.y - line.size,
    `the bubble's plate ends at ${plate.y + plate.h}, below the name's top at ${line.y - line.size}`,
  );
});

test('a route bubble over a lead in the Lounge stands above the lead’s name line', () => {
  const os = floorA();
  os.aero.routes.set(1, {
    mode: 'lunch',
    target: { col: 0, row: 0 },
    seatUid: null,
    arrived: true,
    tries: 0,
  });
  const lead = labelOf(os, 'lead');
  const out = drawn(os);
  const line = out.texts.filter((t) => t.text === `${lead.first} · Lead`).pop()!;
  const bubble = out.texts.find((t) => t.text === '\u{1F35C}')!;
  const plate = out.rects.filter((r) => r.seq < bubble.seq).pop()!;
  assert.ok(
    plate.y + plate.h <= line.y - line.size,
    `plate ends ${plate.y + plate.h}, name top ${line.y - line.size}`,
  );
  // The tool overlay showing for the lead hides the name, so the bubble stands where it always did.
  const shown = drawn(os, { alwaysShowOverlay: true, hoveredId: null, selectedId: null });
  const bare = shown.texts.find((t) => t.text === '\u{1F35C}')!;
  assert.ok(bare.y > bubble.y, 'no name line, no lift');
});

test('a lead’s name is hidden while the tool overlay shows for it: hovered, selected or always', () => {
  const os = floorA();
  const lead = labelOf(os, 'lead');
  const text = `${lead.first} · Lead`;
  const names = (show?: {
    alwaysShowOverlay: boolean;
    hoveredId: number | null;
    selectedId: number | null;
  }) => drawn(os, show).texts.filter((t) => t.text === text).length;
  assert.equal(names(), 2, 'drawn by default');
  assert.equal(names({ alwaysShowOverlay: false, hoveredId: null, selectedId: null }), 2);
  assert.equal(names({ alwaysShowOverlay: false, hoveredId: 1, selectedId: null }), 0, 'hovered');
  assert.equal(names({ alwaysShowOverlay: false, hoveredId: null, selectedId: 1 }), 0, 'selected');
  assert.equal(names({ alwaysShowOverlay: true, hoveredId: null, selectedId: null }), 0, 'always');
  // The people have no tool overlay: their names stay.
  const person = labelOf(os, 'person');
  const stays = drawn(os, { alwaysShowOverlay: true, hoveredId: null, selectedId: null });
  assert.ok(stays.texts.some((t) => t.text === `${person.first} · ${person.role}`));
});

// ── Fix round: stable names, orphans, looks, teammates ──

const firstsById = (os: OfficeState) => new Map(labelsOf(os).map((l) => [l.id, l.first] as const));

test('a lead keeps its first name when a lead of its folder with a lower id leaves', () => {
  const os = floorA();
  for (const id of [2, 3, 4]) {
    os.addAgent(id, 0, 0, undefined, true, FA);
    os.characters.get(id)!.directoryName = PR_RUNS_ROOM;
  }
  const before = firstsById(os);
  const keysBefore = new Map(labelsOf(os).map((l) => [l.id, l.key] as const));
  os.removeAgent(2);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const after = firstsById(os);
  assert.notEqual(
    labelsOf(os).find((l) => l.id === 3)!.key,
    keysBefore.get(3),
    'control: its rank, and so its key, moved up',
  );
  for (const id of [3, 4]) assert.equal(after.get(id), before.get(id), `lead ${id}`);
  assert.equal(after.has(2), false);
});

test('names stay when more characters arrive or the floor is switched and back', () => {
  const slugs = Array.from({ length: 16 }, (_, i) => `t${String(i).padStart(2, '0')}`);
  const os = floorA(buildFloor(), staff(FA, ...slugs));
  const before = firstsById(os);
  assert.ok(before.size >= 19);
  // A contractor of the first type, whose key sorts among the staff.
  start(os, 't00');
  start(os, 't00');
  assert.equal(labelsOf(os).filter((l) => l.kind === 'contractor').length, 1);
  const during = firstsById(os);
  for (const [id, first] of before)
    assert.equal(during.get(id), first, `character ${id} after a hire`);
  os.addAgent(2, 0, 0, undefined, true, FA);
  os.addAgent(3, 0, 0, undefined, true, FA);
  const more = firstsById(os);
  for (const [id, first] of before)
    assert.equal(more.get(id), first, `character ${id} after two leads`);
  // The other floor on show and back.
  const everyone = [...staff(FA, ...slugs), ...staff(FB, 'x1', 'x2')];
  assert.ok(setAeroUpdate(upd(FB, everyone)));
  run(os, 0.5);
  assert.ok(setAeroUpdate(upd(FA, everyone)));
  run(os, 0.5);
  const back = firstsById(os);
  for (const [id, first] of before)
    assert.equal(back.get(id), first, `character ${id} after a floor switch`);
});

test('labels: a teammate has its lead’s key and a Teammate role', () => {
  const os = floorA();
  os.addAgent(2, 0, 0, undefined, true, FA);
  os.characters.get(2)!.leadAgentId = 1;
  const lead = labelOf(os, 'lead');
  const mate = labelOf(os, 'teammate');
  assert.equal(mate.id, 2);
  assert.equal(mate.role, 'Teammate');
  assert.equal(mate.key, `${lead.key}/mate/0`);
});

test('characters whose lead is not on show do not share a key or a name', () => {
  const os = floorA();
  for (const [id, leadId] of [
    [2, 90],
    [3, 91],
    [4, 92],
  ] as const) {
    os.addAgent(id, 0, 0, undefined, true, FA);
    os.characters.get(id)!.leadAgentId = leadId;
  }
  const mates = labelsOf(os).filter((l) => l.kind === 'teammate');
  assert.equal(mates.length, 3);
  assert.equal(new Set(mates.map((l) => l.key)).size, 3, 'three keys');
  assert.equal(new Set(mates.map((l) => l.first)).size, 3, 'three names');
});

test('up to six staff on a floor never share a look, and none is tinted', () => {
  const palettes = Math.max(1, getLoadedCharacterCount());
  const slugs = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, palettes);
  const os = floorA(buildFloor(), staff(FA, ...slugs));
  const looks = os.aero.people
    .filter((p) => !p.contractor)
    .map((p) => [p.ch.palette, p.ch.hueShift]);
  assert.equal(looks.length, slugs.length);
  assert.equal(
    new Set(looks.map((l) => l[0])).size,
    slugs.length,
    `palettes ${JSON.stringify(looks)}`,
  );
  assert.ok(
    looks.every((l) => l[1] === 0),
    'no hue turn while palettes last',
  );
  // The names follow the final palettes.
  for (const l of labelsOf(os).filter((x) => x.kind === 'person')) {
    const p = os.aero.people.find((x) => x.ch.id === l.id)!;
    assert.equal(l.palette, p.ch.palette);
  }
  // The same floor made in another order gives the same looks.
  resetAeroUpdate();
  const again = floorA(buildFloor(), staff(FA, ...[...slugs].reverse()));
  const byKey = (o: OfficeState) =>
    Object.fromEntries(o.aero.people.map((p) => [p.slug, [p.ch.palette, p.ch.hueShift]]));
  assert.deepEqual(byKey(again), byKey(os));
});
