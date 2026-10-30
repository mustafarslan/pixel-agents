/**
 * Aero's routing on a real OfficeState: idle leads go to the Lounge and sit, lunch gathers them at the table, waiting
 * leads stay at their desks, configured characters walk to a lead and back, stock subagents they stand in for are
 * hidden, and a layout without Aero's Lounge (or no update) is plain stock.
 *
 * The layout is built by hand (no furniture catalog is loaded in a unit test): all floor, seats and blocked tiles set
 * directly, the Lounge in columns 6..11.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { PERSON_ID_BASE, resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedFurniture, Seat } from '../src/office/types.js';
import {
  CharacterState,
  Direction,
  MATRIX_EFFECT_DURATION,
  TileType,
} from '../src/office/types.js';

const COLS = 14;
const ROWS = 9;
const DESK = 'desk-seat';
const DESK_TILE = { col: 2, row: 2 };
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';
const LOUNGE_SEAT_2 = 'aero-0a1b2c3d-lounge-5';

afterEach(() => resetAeroUpdate());

function update(over: Record<string, unknown> = {}) {
  return {
    lunch: false,
    meeting: null,
    inbox: 0,
    agents: [] as Array<{ name: string; slug: string }>,
    lounge: true,
    ...over,
  };
}

function seat(uid: string, col: number, row: number, facingDir: Direction = Direction.DOWN): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir, assigned: false };
}

/** Floor everywhere, a corridor, the Lounge room in columns 6..11 rows 2..6 (unless `withLounge` is false). */
function build(withLounge = true): OfficeState {
  const furniture: PlacedFurniture[] = withLounge
    ? [
        { uid: 'aero-0a1b2c3d-lounge-0', type: 'WHITEBOARD', col: 6, row: 0 },
        { uid: 'aero-0a1b2c3d-lounge-1', type: 'CLOCK', col: 8, row: 0 },
        { uid: LOUNGE_SEAT, type: 'SOFA_FRONT', col: 7, row: 2 },
        { uid: LOUNGE_SEAT_2, type: 'SOFA_FRONT', col: 10, row: 3 },
        { uid: 'aero-0a1b2c3d-lounge-3', type: 'COFFEE_TABLE', col: 8, row: 4 },
      ]
    : [{ uid: 'main-1', type: 'COFFEE_TABLE', col: 8, row: 4 }];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 6; r++) {
    for (let c = 1; c <= 4; c++) areaTiles[r * COLS + c] = 'Work';
    for (let c = 6; c <= 11; c++) areaTiles[r * COLS + c] = withLounge ? 'Lounge' : 'Other';
  }
  // The Lounge is a walled room (columns 6..11, rows 2..6) with doors at (5,5) and (11,7), as Aero's rooms are.
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  const wall = (c: number, r: number) => {
    tiles[r * COLS + c] = TileType.WALL;
  };
  for (let c = 5; c < COLS; c++) for (const r of [0, 1]) wall(c, r);
  for (let r = 2; r <= 7; r++) {
    wall(12, r);
    wall(13, r);
    if (r !== 5) wall(5, r);
  }
  for (let c = 6; c <= 11; c++) if (c !== 11) wall(c, 7);
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture,
    areas: [
      { label: 'Work', color: AREA_LABEL_FALLBACK_COLOR },
      { label: withLounge ? 'Lounge' : 'Other', color: AREA_LABEL_FALLBACK_COLOR },
    ],
    areaTiles,
    pets: [],
  };
  const os = new OfficeState(layout);
  os.seats = new Map([
    [DESK, seat(DESK, DESK_TILE.col, DESK_TILE.row)],
    [LOUNGE_SEAT, seat(LOUNGE_SEAT, 7, 2, Direction.DOWN)],
    [LOUNGE_SEAT_2, seat(LOUNGE_SEAT_2, 10, 3, Direction.LEFT)],
  ]);
  os.blockedTiles = new Set(['7,2', '10,3', '8,4', '2,2']);
  os.walkableTiles = os.walkableTiles.filter((t) => !os.blockedTiles.has(`${t.col},${t.row}`));
  return os;
}

function lead(os: OfficeState, id = 1): void {
  os.addAgent(id, 0, 0, DESK, true);
}

function run(os: OfficeState, seconds: number, dt = 0.1): void {
  for (let t = 0; t < seconds; t += dt) os.update(dt);
}

/** Runs until `done` holds, up to `seconds`; fails otherwise. */
function until(os: OfficeState, done: () => boolean, seconds = 60, what = 'condition'): void {
  for (let t = 0; t < seconds; t += 0.1) {
    if (done()) return;
    os.update(0.1);
  }
  assert.ok(done(), `${what} within ${seconds}s`);
}

const at = (os: OfficeState, id: number) => {
  const ch = os.characters.get(id)!;
  return `${ch.tileCol},${ch.tileRow}`;
};

test('an idle lead walks to a free Lounge seat and sits; its desk seat stays its own', () => {
  const os = build();
  lead(os);
  assert.ok(setAeroUpdate(update()));
  os.setAgentActive(1, false);
  os.showWaitingBubble(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'arrival');
  const ch = os.characters.get(1)!;
  const route = os.aero.routes.get(1)!;
  assert.equal(route.mode, 'rest');
  assert.ok(route.seatUid === LOUNGE_SEAT || route.seatUid === LOUNGE_SEAT_2);
  const target = os.seats.get(route.seatUid!)!;
  assert.equal(at(os, 1), `${target.seatCol},${target.seatRow}`);
  assert.equal(ch.state, CharacterState.TYPE);
  assert.equal(ch.dir, target.facingDir);
  // Still there a long while later: the stock wander never takes it off the sofa.
  run(os, 120);
  assert.equal(at(os, 1), `${target.seatCol},${target.seatRow}`);
  assert.equal(ch.state, CharacterState.TYPE);
  // The routing tracks the seat itself: the stock assignment flags are untouched.
  assert.equal(os.seats.get(DESK)!.assigned, true);
  assert.equal(os.seats.get(LOUNGE_SEAT)!.assigned, false);
  assert.equal(os.seats.get(LOUNGE_SEAT_2)!.assigned, false);
});

test('when its session works again it walks back to its desk and types', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true);
  os.setAgentActive(1, true);
  until(
    os,
    () =>
      at(os, 1) === `${DESK_TILE.col},${DESK_TILE.row}` &&
      os.characters.get(1)!.state === CharacterState.TYPE,
    60,
    'back at the desk',
  );
  assert.equal(os.aero.routes.has(1), false);
  assert.equal(os.characters.get(1)!.isActive, true);
});

test('two idle leads take two different seats; a third stands on free Lounge floor', () => {
  const os = build();
  for (const id of [1, 2, 3]) {
    os.addAgent(id, 0, 0, undefined, true);
    os.characters.get(id)!.seatId = null;
  }
  // addAgent took seats for them; these three have none.
  for (const s of os.seats.values()) s.assigned = false;
  // Give them separate tiles to start from.
  os.characters.get(1)!.tileCol = 1;
  os.characters.get(2)!.tileCol = 3;
  os.characters.get(3)!.tileCol = 5;
  for (const id of [1, 2, 3]) {
    os.characters.get(id)!.tileRow = 7;
    os.characters.get(id)!.x = os.characters.get(id)!.tileCol * 16 + 8;
    os.characters.get(id)!.y = 7 * 16 + 8;
  }
  setAeroUpdate(update());
  for (const id of [1, 2, 3]) os.setAgentActive(id, false);
  until(
    os,
    () => [1, 2, 3].every((id) => os.aero.routes.get(id)?.arrived === true),
    90,
    'all arrived',
  );
  const places = [1, 2, 3].map((id) => at(os, id));
  assert.equal(new Set(places).size, 3, places.join(' '));
  const seatUids = [1, 2, 3].map((id) => os.aero.routes.get(id)!.seatUid);
  assert.equal(seatUids.filter((s) => s !== null).length, 2);
  const standing = [1, 2, 3].find((id) => os.aero.routes.get(id)!.seatUid === null)!;
  const ch = os.characters.get(standing)!;
  assert.ok(
    ch.tileCol >= 6 && ch.tileCol <= 11 && ch.tileRow >= 2 && ch.tileRow <= 6,
    at(os, standing),
  );
  assert.equal(ch.state, CharacterState.IDLE);
});

test('lunch: idle leads gather beside the Lounge table with a food bubble; after lunch they go back to seats', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ lunch: true }));
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'arrival at lunch');
  const route = os.aero.routes.get(1)!;
  assert.equal(route.mode, 'lunch');
  const [col, row] = at(os, 1).split(',').map(Number);
  // Beside the 1x1 table at (8,4) the stub catalog gives: a 4-neighbour of it, or a seat that is one.
  assert.equal(Math.abs(col - 8) + Math.abs(row - 4), 1, at(os, 1));
  assert.equal(os.aero.bubbleFor(1), '\u{1F35C}');
  // Lunch ends: it moves to a seat and chats instead.
  setAeroUpdate(update({ lunch: false }));
  until(
    os,
    () => os.aero.routes.get(1)?.mode === 'rest' && os.aero.routes.get(1)?.arrived === true,
    60,
    'rest after lunch',
  );
  assert.notEqual(os.aero.bubbleFor(1), '\u{1F35C}');
});

test('a lead with a permission bubble stays at its desk', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  os.showPermissionBubble(1);
  run(os, 90);
  assert.equal(os.aero.routes.size, 0);
  assert.equal(at(os, 1), `${DESK_TILE.col},${DESK_TILE.row}`);
  assert.equal(os.characters.get(1)!.state, CharacterState.TYPE);
});

test('the real idle sequence (a finished turn, then idle_prompt with awaitingInput) sends the lead to the Lounge; so does lunch', () => {
  // server claude.ts: `idle_prompt` is a turnEnd with awaitingInput:true for every idle session.
  for (const lunch of [false, true]) {
    const os = build();
    lead(os);
    setAeroUpdate(update({ lunch }));
    os.setAgentActive(1, true);
    run(os, 1);
    os.setAgentActive(1, false);
    os.showWaitingBubble(1, false); // Stop
    run(os, 3);
    os.showWaitingBubble(1, true); // idle_prompt, about a minute later
    // It does not wait for anything: the bubble (about two seconds) is no reason to stay.
    run(os, 0.5);
    assert.ok(os.aero.routes.has(1), 'routed while the idle_prompt bubble still shows');
    until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'arrival after idle_prompt');
    assert.equal(os.aero.routes.get(1)!.mode, lunch ? 'lunch' : 'rest');
    // The bubble is long gone and it is still there.
    run(os, 30);
    assert.equal(os.aero.routes.get(1)?.arrived, true);
  }
});

test('a question (an active tool) keeps the lead working at its desk', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, true);
  os.showWaitingBubble(1, true);
  run(os, 60);
  assert.equal(os.aero.routes.size, 0);
  assert.equal(at(os, 1), `${DESK_TILE.col},${DESK_TILE.row}`);
  assert.equal(os.characters.get(1)!.state, CharacterState.TYPE);
});

test('a failed assign is tried at most about once a second, and at once when a route changed', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  run(os, 0.2);
  os.aero.routes.clear();
  // No place the lead could take.
  for (const seat of os.seats.values()) if (seat.uid !== DESK) seat.assigned = true;
  os.aero.loungeWalkable = [];
  const real = os.aero.assign.bind(os.aero);
  let calls = 0;
  os.aero.assign = (ch, mode) => {
    calls++;
    return real(ch, mode);
  };
  run(os, 5);
  assert.ok(calls >= 1 && calls <= 6, `${calls} calls in 5 s`);
  // A place frees: it is found within the second.
  for (const seat of os.seats.values()) seat.assigned = seat.uid === DESK;
  os.aero.loungeWalkable = [{ col: 8, row: 3 }];
  until(os, () => os.aero.routes.has(1), 1.5, 'a new route');
});

test('when idle turns to lunch the lead gets up (no route, standing, no path) before the new place is found', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'arrival');
  const real = os.aero.assign.bind(os.aero);
  const seen: Array<{ state: string; path: number; routed: boolean }> = [];
  os.aero.assign = (ch, mode) => {
    seen.push({ state: ch.state, path: ch.path.length, routed: os.aero.routes.has(ch.id) });
    return real(ch, mode);
  };
  setAeroUpdate(update({ lunch: true }));
  until(os, () => os.aero.routes.get(1)?.mode === 'lunch', 5, 'lunch route');
  assert.deepEqual(seen[0], { state: CharacterState.IDLE, path: 0, routed: false });
});

test('a lead that works while still walking to the Lounge turns for its desk at once', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  run(os, 1.5);
  const ch = os.characters.get(1)!;
  assert.equal(ch.state, CharacterState.WALK);
  os.setAgentActive(1, true);
  os.update(0.1);
  const last = ch.path[ch.path.length - 1];
  assert.deepEqual(last, { col: DESK_TILE.col, row: DESK_TILE.row });
  assert.equal(os.aero.routes.has(1), false);
});

test('a new layout routes every routed lead again and stands the people on the new Lounge floor', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Reviewer', slug: 'reviewer' }] }));
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'arrival');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const before = os.aero.routes.get(1)!;
  const person = os.aero.people[0];
  // The person stands where the new layout has no Lounge floor.
  person.ch.tileCol = 1;
  person.ch.tileRow = 1;
  os.rebuildFromLayout({ ...os.layout });
  os.update(0.1);
  const after = os.aero.routes.get(1);
  assert.ok(after && after !== before, 'routed again');
  assert.ok(
    person.ch.tileCol >= 6 &&
      person.ch.tileCol <= 11 &&
      person.ch.tileRow >= 2 &&
      person.ch.tileRow <= 6,
    `${person.ch.tileCol},${person.ch.tileRow}`,
  );
});

test('a lead that is walking when the permission bubble comes goes to its desk', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update());
  os.setAgentActive(1, false);
  run(os, 1.5);
  assert.ok(os.aero.routes.has(1));
  assert.notEqual(at(os, 1), `${DESK_TILE.col},${DESK_TILE.row}`);
  os.showPermissionBubble(1);
  until(
    os,
    () =>
      at(os, 1) === `${DESK_TILE.col},${DESK_TILE.row}` &&
      os.characters.get(1)!.state === CharacterState.TYPE,
    60,
    'back at the desk',
  );
  assert.equal(os.aero.routes.size, 0);
});

test('without an update, or with lounge:false, or in a layout with no Aero Lounge, it is stock behaviour', () => {
  // No update: the stock rules stand up a finished lead and wander it; nothing is routed.
  const noUpdate = build();
  lead(noUpdate);
  noUpdate.setAgentActive(1, false);
  run(noUpdate, 30);
  assert.equal(noUpdate.aero.routes.size, 0);

  const off = build();
  lead(off);
  setAeroUpdate(update({ lounge: false, agents: [{ name: 'Reviewer', slug: 'reviewer' }] }));
  off.setAgentActive(1, false);
  run(off, 30);
  assert.equal(off.aero.routes.size, 0);
  assert.equal(off.aero.people.length, 0);

  const arranged = build(false);
  lead(arranged);
  setAeroUpdate(update({ agents: [{ name: 'Reviewer', slug: 'reviewer' }], inbox: 4 }));
  arranged.setAgentActive(1, false);
  run(arranged, 30);
  assert.equal(arranged.aero.lounge, null);
  assert.equal(arranged.aero.routes.size, 0);
  assert.equal(arranged.aero.people.length, 0);
  assert.equal(arranged.aero.wallHitAt(6.5 * 16, 8), null);
  // Badges still work there.
  arranged.addSubagent(1, 'tool-1');
  assert.equal(arranged.aero.badgeCounts().get(1), 1);
});

test('configured characters stand in the Lounge, outside characters, and wander only on its floor', () => {
  const os = build();
  lead(os);
  setAeroUpdate(
    update({
      agents: [
        { name: 'Code Reviewer', slug: 'code-reviewer' },
        { name: 'Explorer', slug: 'explorer' },
      ],
    }),
  );
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const people = os.aero.people;
  assert.deepEqual(
    people.map((p) => p.slug),
    ['code-reviewer', 'explorer'],
  );
  assert.deepEqual(
    people.map((p) => p.name),
    ['Code Reviewer', 'Explorer'],
  );
  assert.ok(people.every((p) => p.ch.id <= PERSON_ID_BASE));
  // Not in `characters`: no seat payload, no palette count, no hit test; but drawn.
  assert.equal(os.characters.size, 1);
  assert.deepEqual(Object.keys(os.getPersistableSeats()), ['1']);
  assert.equal(os.getCharacters().length, 3);
  for (let i = 0; i < 600; i++) {
    os.update(0.1);
    for (const p of os.aero.people) {
      assert.ok(
        p.ch.tileCol >= 6 && p.ch.tileCol <= 11 && p.ch.tileRow >= 2 && p.ch.tileRow <= 6,
        `${p.slug} at ${p.ch.tileCol},${p.ch.tileRow}`,
      );
    }
  }
  assert.equal(os.getCharacterAt(people[0].ch.x, people[0].ch.y - 8), null);
});

test('at most eight configured characters; one dropped from the update leaves; a name change relabels', () => {
  const os = build();
  setAeroUpdate(
    update({ agents: Array.from({ length: 8 }, (_, i) => ({ name: `A${i}`, slug: `a${i}` })) }),
  );
  run(os, 1);
  assert.equal(os.aero.people.length, 8);
  setAeroUpdate(update({ agents: [{ name: 'Renamed', slug: 'a0' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.deepEqual(
    os.aero.people.map((p) => [p.slug, p.name]),
    [['a0', 'Renamed']],
  );
  // A rejected update (nine agents) changes nothing.
  assert.equal(
    setAeroUpdate(
      update({ agents: Array.from({ length: 9 }, (_, i) => ({ name: `B${i}`, slug: `b${i}` })) }),
    ),
    false,
  );
  run(os, 1);
  assert.deepEqual(
    os.aero.people.map((p) => p.slug),
    ['a0'],
  );
});

test('a SubagentStart naming a configured agent hides the stock sprite and walks that character to the lead; it walks back after', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const person = os.aero.people[0];
  const startCol = person.ch.tileCol;

  const subId = os.addSubagent(1, 'tool-1');
  const sub = os.characters.get(subId)!;
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: code-reviewer'), true);
  assert.equal(sub.aeroHidden, true);
  assert.ok(!os.getCharacters().includes(sub));
  assert.equal(os.getCharacterAt(sub.x, sub.y - 8), null);
  assert.equal(os.aero.snapshot().people[0].away, true);
  assert.deepEqual(os.aero.snapshot().hidden, [subId]);
  // The badge counts it.
  assert.equal(os.aero.badgeCounts().get(1), 1);

  // The person walks out of the Lounge to beside the lead (the lead's desk is outside the Lounge).
  until(
    os,
    () =>
      Math.abs(person.ch.tileCol - 2) + Math.abs(person.ch.tileRow - 2) <= 2 &&
      person.ch.state === CharacterState.TYPE,
    60,
    'arrival at the lead',
  );
  assert.ok(person.ch.tileCol < 6, `walked out of the Lounge (from col ${startCol})`);

  // A second Task of the same type while it is away stays stock.
  const second = os.addSubagent(1, 'tool-2');
  assert.equal(os.aero.subagentStarted(1, 'tool-2', 'Subtask: code-reviewer'), false);
  assert.equal(os.characters.get(second)!.aeroHidden, undefined);
  os.removeSubagent(1, 'tool-2');

  // It ends: the stock sub despawns, the person walks home.
  os.removeSubagent(1, 'tool-1');
  until(
    os,
    () =>
      os.aero.snapshot().people[0].away === false &&
      person.ch.tileCol >= 6 &&
      person.ch.state !== CharacterState.WALK,
    90,
    'back in the Lounge',
  );
  assert.ok(person.ch.tileCol >= 6 && person.ch.tileCol <= 11);
  assert.equal(person.ch.isActive, false);
});

test('a Task with no type, a type that matches nothing, or a near-miss stays stock', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  for (const [tool, status] of [
    ['t1', 'Subtask:'],
    ['t2', 'Subtask: explorer'],
    ['t3', 'Subtask: Code-Reviewer'],
    ['t4', 'Subtask: code-reviewer-2'],
    ['t5', 'Subtask: code'],
    ['t6', 'Using Read'],
    ['t7', 'Subtask: unknown'],
  ]) {
    const id = os.addSubagent(1, tool);
    assert.equal(os.aero.subagentStarted(1, tool, status), false, status);
    assert.equal(os.characters.get(id)!.aeroHidden, undefined, status);
    assert.ok(os.getCharacters().includes(os.characters.get(id)!), status);
  }
  assert.equal(os.aero.people[0].subId, null);
  // An id the office doesn't know is no match either.
  assert.equal(os.aero.subagentStarted(1, 'missing', 'Subtask: code-reviewer'), false);
});

test('a Task with the server\'s "unknown" type matches no one, not even an agent named unknown', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'unknown', slug: 'unknown' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const id = os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: unknown'), false);
  assert.equal(os.characters.get(id)!.aeroHidden, undefined);
});

test('a character that is still spawning is matched; one that is despawning is not', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  run(os, 0.1); // spawning
  assert.equal(os.aero.people[0].ch.matrixEffect, 'spawn');
  os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: code-reviewer'), true);
  os.removeSubagent(1, 'tool-1');

  const gone = build();
  lead(gone);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  run(gone, MATRIX_EFFECT_DURATION + 0.5);
  setAeroUpdate(update({ agents: [] }));
  run(gone, 0.1); // despawning
  assert.equal(gone.aero.people[0].ch.matrixEffect, 'despawn');
  gone.addSubagent(1, 'tool-1');
  assert.equal(gone.aero.subagentStarted(1, 'tool-1', 'Subtask: code-reviewer'), false);
});

test("a configured character walks to its lead's desk, not to where the lead rests", () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true, 60, 'the lead rests in the Lounge');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const person = os.aero.people[0];
  os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: code-reviewer'), true);
  const goal = person.ch.path[person.ch.path.length - 1];
  assert.ok(
    Math.abs(goal.col - DESK_TILE.col) + Math.abs(goal.row - DESK_TILE.row) <= 2,
    `${goal.col},${goal.row} is not beside the desk ${DESK_TILE.col},${DESK_TILE.row}`,
  );
});

test('the snapshot lists the leads with their place, state and room, and not the subagents', () => {
  const os = build();
  os.addAgent(1, 0, 0, DESK, true, '0a1b2c3d4e5f');
  os.addAgent(2, 0, 0, undefined, true);
  os.addSubagent(1, 'tool-1');
  run(os, 1);
  const leads = os.aero.snapshot().leads;
  assert.deepEqual(
    leads.map((l) => [l.id, l.directoryName]),
    [
      [1, '0a1b2c3d4e5f'],
      [2, null],
    ],
  );
  assert.ok(leads.every((l) => Number.isInteger(l.col) && Number.isInteger(l.row)));
  assert.equal(typeof leads[0].active, 'boolean');
  assert.equal(typeof leads[0].state, 'string');
});

test('a project agent matches only a lead whose directoryName is its room; the owner agent matches any lead', () => {
  const roomA = '0a1b2c3d4e5f';
  const roomB = 'ffeeddccbbaa';
  const os = build();
  os.addAgent(1, 0, 0, DESK, true, roomA);
  setAeroUpdate(
    update({
      agents: [
        { name: 'Reviewer', slug: 'reviewer', room: roomB },
        { name: 'Planner', slug: 'planner' },
      ],
    }),
  );
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.deepEqual(
    os.aero.snapshot().people.map((p) => [p.slug, p.room]),
    [
      ['reviewer', roomB],
      ['planner', null],
    ],
  );
  // The lead is in room A: the agent of room B stays stock, the owner's agent walks in.
  const other = os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: reviewer'), false);
  assert.equal(os.characters.get(other)!.aeroHidden, undefined);
  os.addSubagent(1, 'tool-2');
  assert.equal(os.aero.subagentStarted(1, 'tool-2', 'Subtask: planner'), true);

  // A lead in room B gets the project agent; a lead with no directoryName never does.
  os.addAgent(2, 0, 0, undefined, true, roomB);
  os.addAgent(3, 0, 0, undefined, true);
  os.addSubagent(2, 'tool-3');
  assert.equal(os.aero.subagentStarted(2, 'tool-3', 'Subtask: reviewer'), true);
  os.removeSubagent(2, 'tool-3');
  os.addSubagent(3, 'tool-4');
  assert.equal(os.aero.subagentStarted(3, 'tool-4', 'Subtask: reviewer'), false);
});

test('a project agent of the same name in two rooms is two characters, each for its own room', () => {
  const roomA = '0a1b2c3d4e5f';
  const roomB = 'ffeeddccbbaa';
  const os = build();
  os.addAgent(1, 0, 0, DESK, true, roomA);
  setAeroUpdate(
    update({
      agents: [
        { name: 'Reviewer', slug: 'reviewer', room: roomA },
        { name: 'Reviewer', slug: 'reviewer', room: roomB },
      ],
    }),
  );
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.equal(os.aero.people.length, 2);
  os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: reviewer'), true);
  assert.deepEqual(
    os.aero.snapshot().people.map((p) => [p.room, p.away]),
    [
      [roomA, true],
      [roomB, false],
    ],
  );
});

test('a configured character removed from the update while away shows the stock sprite again', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ agents: [{ name: 'Code Reviewer', slug: 'code-reviewer' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const subId = os.addSubagent(1, 'tool-1');
  os.aero.subagentStarted(1, 'tool-1', 'Subtask: code-reviewer');
  setAeroUpdate(update({ agents: [] }));
  run(os, 0.2);
  assert.equal(os.characters.get(subId)!.aeroHidden, false);
});

test("badges count each lead's live subagents", () => {
  const os = build();
  lead(os, 1);
  lead(os, 2);
  os.seats.set('desk-2', seat('desk-2', 3, 2));
  os.characters.get(2)!.seatId = 'desk-2';
  os.addSubagent(1, 'a');
  os.addSubagent(1, 'b');
  os.addSubagent(2, 'c');
  assert.deepEqual([...os.aero.badgeCounts()].sort(), [
    [1, 2],
    [2, 1],
  ]);
  os.removeSubagent(1, 'a');
  assert.deepEqual([...os.aero.badgeCounts()].sort(), [
    [1, 1],
    [2, 1],
  ]);
});

test('the snapshot hook shows the routing state', () => {
  const os = build();
  lead(os);
  setAeroUpdate(update({ inbox: 7, meeting: { time: '14:30', title: 'Review', soon: false } }));
  os.setAgentActive(1, false);
  until(os, () => os.aero.routes.get(1)?.arrived === true);
  const snap = os.aero.snapshot();
  assert.equal(snap.update?.inbox, 7);
  assert.equal(snap.lounge?.seats.length, 2);
  assert.deepEqual(snap.lounge?.whiteboard, { col: 6, row: 0 });
  assert.equal(snap.routes[0].arrived, true);
  assert.equal(snap.routes[0].id, 1);
});

test('wall clicks resolve only with an update and a Lounge', () => {
  const os = build();
  assert.equal(os.aero.wallHitAt(6.5 * 16, 8), null);
  setAeroUpdate(update());
  assert.equal(os.aero.wallHitAt(6.5 * 16, 8), 'openInbox');
  assert.equal(os.aero.wallHitAt(8.5 * 16, 8), 'openCalendar');
  setAeroUpdate(update({ lounge: false }));
  assert.equal(os.aero.wallHitAt(6.5 * 16, 8), null);
});
