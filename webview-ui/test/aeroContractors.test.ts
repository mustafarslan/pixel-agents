/**
 * Aero's front desk (docs/work/phase6-contractors/plan.md, task 3b round 1): the receptionist and the guard, seated on chairs held
 * from the moment the layout is built, never handed out by any seat pick, greeting real lead arrivals.
 *
 * The layout is by hand: a 14x8 room with one ordinary desk seat, and the two desk chairs (the uids end the way the open office's
 * do) facing down.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedFurniture, Seat } from '../src/office/types.js';
import { Direction, TileType } from '../src/office/types.js';

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
