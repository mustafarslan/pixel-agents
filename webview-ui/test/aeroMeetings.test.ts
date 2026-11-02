/**
 * Aero's subagent meetings (docs/work/phase6-meetings/plan.md, round 1): two subagents of one lead that both hold a station and work
 * there for 3 s walk to two meeting-room chairs that face each other, sit for 8 s with a bubble and a burst, and go back to a station;
 * once per subagent, one meeting at a time, ended early by a despawn, idle, a permission bubble, a floor switch or a stuck walk;
 * off with the switch, and off in the Rooms style.
 *
 * `buildWorld` is the subagent-work world with a meeting room of two rows of side chairs that face each other (the stock one's chairs
 * all face down).
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import {
  facingPairs,
  HUDDLE_AFTER_SEC,
  HUDDLE_BUBBLES,
  HUDDLE_SEC,
  pickPair,
  trackWorking,
  type Working,
} from '../src/aero/meetings.js';
import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
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

const COLS = 40;
const ROWS = 24;
const FA = 'aaaaaaaaaaaa';
const FB = 'bbbbbbbbbbbb';
const LEAD = 'p1-lead';
const WOOD_A = 'p1-wood-a';
const WOOD_B = 'p1-wood-b';
const FOCUS = ['focus-a', 'focus-b'];
/** The meeting room: two rows, the left chair faces right and the right chair faces left. */
const ROW1 = ['meet-1l', 'meet-1r'];
const ROW2 = ['meet-2l', 'meet-2r'];
const MEETING = [...ROW1, ...ROW2];
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';
const DT = 0.1;

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
    entry('CUSHIONED_CHAIR_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('WOODEN_CHAIR_BACK', 'chairs', 1, 1, { orientation: 'back' }),
    entry('SIDE_CHAIR_R', 'chairs', 1, 1, { orientation: 'right' }),
    entry('SIDE_CHAIR_L', 'chairs', 1, 1, { orientation: 'left' }),
    entry('SOFA_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('AERO_POD_WHITEBOARD', 'decor', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_WATERCOOLER', 'misc', 1, 2, { backgroundTiles: 1 }),
  ];
  const sprites = Object.fromEntries(catalog.map((c) => [c.id, sprite('#445566')]));
  assert.ok(buildDynamicCatalog({ catalog, sprites }));
  catalogReady = true;
}

function buildWorld(): OfficeState {
  loadCatalog();
  const f = (uid: string, type: string, col: number, row: number): PlacedFurniture => ({
    uid,
    type,
    col,
    row,
  });
  const furniture: PlacedFurniture[] = [
    ...[2, 4, 6].map((c) => f(`pc-${c}`, 'PC_OFF', c, 2)),
    ...[2, 4, 6].map((c) => f(`desk-${c}`, 'DESK', c, 3)),
    f(WOOD_A, 'WOODEN_BENCH', 2, 4),
    f(LEAD, 'CUSHIONED_BENCH', 4, 4),
    f(WOOD_B, 'WOODEN_BENCH', 6, 4),
    f('pod-board', 'AERO_POD_WHITEBOARD', 1, 4),
    f('pod-cooler', 'AERO_WATERCOOLER', 7, 2),
    f(FOCUS[0], 'WOODEN_CHAIR_BACK', 10, 4),
    f(FOCUS[1], 'WOODEN_CHAIR_BACK', 11, 4),
    f(ROW1[0], 'SIDE_CHAIR_R', 23, 18),
    f(ROW1[1], 'SIDE_CHAIR_L', 27, 18),
    f(ROW2[0], 'SIDE_CHAIR_R', 23, 20),
    f(ROW2[1], 'SIDE_CHAIR_L', 27, 20),
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 17),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 17),
    f(LOUNGE_SEAT, 'SOFA_FRONT', 33, 19),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
  zone('Focus', 10, 12, 2, 6);
  zone('Hall', 1, 38, 14, 15);
  zone('Meeting', 22, 28, 17, 21);
  zone('Lounge', 31, 38, 17, 21);
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areas: ['Pod 1', 'Focus', 'Hall', 'Meeting', 'Lounge'].map((label) => ({
      label,
      color: AREA_LABEL_FALLBACK_COLOR,
    })),
    areaTiles,
    pets: [],
  };
  return new OfficeState(layout);
}

const upd = (agents: unknown[] = [], floorId = FA): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents,
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Focus'] }, labels: {} },
  floor: { id: floorId, number: floorId === FA ? 1 : 2, name: 'f', rooms: [floorId] },
});
const staff = (...slugs: string[]) =>
  slugs.map((s) => ({ name: s[0].toUpperCase() + s.slice(1), slug: s, floor: FA }));

const fixed = (v: number) => () => v;
const run = (os: OfficeState, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += DT) os.update(DT);
};
function until(os: OfficeState, done: () => boolean, seconds: number, what = 'condition'): void {
  for (let t = 0; t < seconds; t += DT) {
    if (done()) return;
    os.update(DT);
  }
  assert.ok(done(), `${what} within ${seconds}s`);
}

function floor(agents: unknown[] = []): OfficeState {
  const os = buildWorld();
  os.aero.rng = fixed(0.2);
  os.addAgent(1, 0, 0, undefined, true, FA);
  os.setAgentActive(1, true);
  assert.ok(setAeroUpdate(upd(agents)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.equal(os.characters.get(1)!.seatId, LEAD, 'the lead sits on the cushioned bench');
  return os;
}

let toolCount = 0;
function spawn(os: OfficeState, type: string, parent = 1): { id: number; tool: string } {
  const tool = `tool-${++toolCount}`;
  const id = os.addSubagent(parent, tool);
  os.aero.subagentStarted(parent, tool, `Subtask: ${type}`);
  os.setAgentTool(id, 'Subtask');
  os.setAgentActive(id, true);
  return { id, tool };
}
const snap = (os: OfficeState) => os.aero.snapshot();
const sub = (os: OfficeState, id: number) => snap(os).subagents.find((s) => s.id === id)!;
const person = (os: OfficeState, subId: number) => os.aero.people.find((p) => p.subId === subId)!;
const huddle = (os: OfficeState) => snap(os).huddle;
const held = (os: OfficeState) => snap(os).huddlesHeld;
const bursts = (os: OfficeState) => snap(os).fxStarted['burst'] ?? 0;

/** Two subagents of the lead, spawned and at their stations (the PC benches), with the meetings off while they settle. */
function pair(os: OfficeState): [{ id: number; tool: string }, { id: number; tool: string }] {
  const a = spawn(os, 'general-purpose');
  const b = spawn(os, 'general-purpose');
  return [a, b];
}
const bothAtStations = (os: OfficeState, ids: number[]) => () =>
  ids.every((id) => {
    const c = os.characters.get(id)!;
    const s = sub(os, id);
    return s.station && c.state === CharacterState.TYPE && !c.matrixEffect;
  });
const bothSeated = (os: OfficeState) => () => huddle(os)?.seated === 2;

// ── The rules (pure) ───────────────────────────────────────────────

test('pickPair: the longest together first, ties by id, one lead at a time, never a subagent that met', () => {
  const w = (id: number, lead: number, since: number): Working => ({ id, lead, since });
  const none = new Set<number>();
  assert.equal(
    pickPair([w(1, 9, 0), w(2, 9, 0)], none, HUDDLE_AFTER_SEC - 0.1),
    null,
    'not yet 3 s',
  );
  assert.deepEqual(pickPair([w(1, 9, 0), w(2, 9, 0)], none, HUDDLE_AFTER_SEC), [1, 2]);
  // The 3 s count from when the later one started.
  assert.equal(pickPair([w(1, 9, 0), w(2, 9, 5)], none, 7), null);
  assert.deepEqual(pickPair([w(1, 9, 0), w(2, 9, 5)], none, 8), [1, 2]);
  // Two leads: the pair together longest, then the lower ids.
  assert.deepEqual(pickPair([w(5, 8, 2), w(6, 8, 2), w(1, 9, 3), w(2, 9, 3)], none, 10), [5, 6]);
  assert.deepEqual(pickPair([w(5, 8, 3), w(6, 8, 3), w(1, 9, 3), w(2, 9, 3)], none, 10), [1, 2]);
  // Different leads never pair.
  assert.equal(pickPair([w(1, 8, 0), w(2, 9, 0)], none, 10), null);
  // A subagent that met is not paired again, and five siblings make two meetings.
  assert.equal(pickPair([w(1, 9, 0), w(2, 9, 0)], new Set([1]), 10), null);
  const met = new Set<number>();
  const five = [1, 2, 3, 4, 5].map((id) => w(id, 9, 0));
  const first = pickPair(five, met, 10)!;
  first.forEach((id) => met.add(id));
  const second = pickPair(five, met, 10)!;
  second.forEach((id) => met.add(id));
  assert.deepEqual(
    [first, second],
    [
      [1, 2],
      [3, 4],
    ],
  );
  assert.equal(pickPair(five, met, 10), null);
});

test('trackWorking: a break resets the time, a newcomer starts now', () => {
  const since = new Map<number, number>();
  trackWorking(since, new Set([1, 2]), 5);
  trackWorking(since, new Set([1, 2, 3]), 8);
  assert.deepEqual(
    [...since],
    [
      [1, 5],
      [2, 5],
      [3, 8],
    ],
  );
  trackWorking(since, new Set([1, 3]), 9);
  trackWorking(since, new Set([1, 2, 3]), 12);
  assert.equal(since.get(2), 12, 'it was out for a moment, so its time starts again');
  assert.equal(since.get(1), 5);
});

test('facingPairs: side chairs on one row facing each other; two head chairs facing down never pair', () => {
  const s = (uid: string, col: number, row: number, dir: number) => ({ uid, col, row, dir });
  const pairs = facingPairs([
    s('r', 6, 3, Direction.LEFT),
    s('l', 2, 3, Direction.RIGHT),
    s('head-a', 4, 1, Direction.DOWN),
    s('head-b', 4, 5, Direction.DOWN),
    s('l2', 2, 7, Direction.RIGHT),
    s('r2', 4, 7, Direction.LEFT),
    s('lone', 2, 9, Direction.RIGHT),
    s('wrong-row', 6, 8, Direction.LEFT),
  ]);
  assert.deepEqual(
    pairs.map(([a, b]) => `${a.uid}-${b.uid}`),
    ['l2-r2', 'l-r'],
    'the nearest chairs first',
  );
});

// ── The fork: the meeting ──────────────────────────────────────────

test('the pair waits until both hold a station, then 3 s; both sit on chairs that face each other with a bubble and one burst', () => {
  const os = floor();
  const [a, b] = pair(os);
  assert.equal(huddle(os), null, 'nothing at the spawn');
  // While either is still walking to its bench (not both at stations) there is no meeting.
  until(
    os,
    () => {
      if (bothAtStations(os, [a.id, b.id])()) return true;
      assert.equal(huddle(os), null, 'no meeting before both hold a station');
      return false;
    },
    90,
    'both at stations',
  );
  // Then 3 s of working together (the office counts from the tick both held a station and typed).
  let together = 0;
  until(
    os,
    () => {
      if (huddle(os) === null) together += DT;
      return huddle(os) !== null;
    },
    10,
    'a meeting',
  );
  assert.ok(together >= HUDDLE_AFTER_SEC - DT * 2, `3 s together first, got ${together}`);
  const h = huddle(os)!;
  assert.deepEqual(
    [...h.subs].sort((x, y) => x - y),
    [a.id, b.id].sort((x, y) => x - y),
  );
  assert.equal(h.seated, 0);
  assert.equal(held(os), 0);
  assert.equal(bursts(os), 0);
  // Two chairs of one row, the left facing right.
  const seats = h.seats.map((u) => os.seats.get(u)!);
  assert.equal(seats[0].seatRow, seats[1].seatRow);
  assert.deepEqual(
    new Set(seats.map((s) => s.facingDir)),
    new Set([Direction.LEFT, Direction.RIGHT]),
  );
  assert.ok(h.seats.every((u) => MEETING.includes(u)));
  until(os, bothSeated(os), 60, 'both seated');
  assert.equal(held(os), 1, 'counted when both sat');
  assert.equal(bursts(os), 1, 'one burst when the second sat');
  const bubbles = os.aero.workBubbles().filter((x) => [a.id, b.id].includes(x.ch.id));
  assert.equal(bubbles.length, 2);
  for (const x of bubbles) assert.ok((HUDDLE_BUBBLES as readonly string[]).includes(x.text));
  assert.equal(bubbles[0].text, bubbles[1].text);
  for (const uid of h.seats) {
    assert.equal(os.seats.get(uid)!.assigned, false, 'borrowed, never assigned');
    assert.ok(snap(os).benches.includes(uid));
  }
  // The burst sits between the two chairs.
  const fx = os.aero.fx.active.find((x) => x.kind === 'burst')!;
  assert.ok(fx);
  const [s0, s1] = h.seats.map((u) => os.seats.get(u)!);
  assert.equal(fx.x, ((s0.seatCol + s1.seatCol) / 2) * 16 + 8, 'between the two chairs');
});

test('the bubble is one of 💬 🤝 🗣️, picked by the office’s rng, and shown only while seated', () => {
  const texts: string[] = [];
  for (const v of [0.0, 0.5, 0.99]) {
    const os = floor();
    os.aero.rng = fixed(v);
    const [a, b] = pair(os);
    until(os, () => huddle(os) !== null, 90, 'a meeting');
    const walking = os.aero.workBubbles().filter((x) => [a.id, b.id].includes(x.ch.id));
    for (const x of walking)
      assert.ok(!HUDDLE_BUBBLES.includes(x.text as never), 'not while walking');
    until(os, bothSeated(os), 60, 'seated');
    texts.push(os.aero.workBubbles().find((x) => x.ch.id === a.id)!.text);
  }
  assert.deepEqual(texts, ['\u{1F4AC}', '\u{1F91D}', '\u{1F5E3}\u{FE0F}']);
});

test('the meeting lasts 8 s from the second one sitting; then both seats are free and each is back at a station that is not a meeting seat', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, bothSeated(os), 120, 'seated');
  const seats = [...huddle(os)!.seats];
  let sat = 0;
  until(os, () => (sat += DT) > 0 && huddle(os) === null, 20, 'the end');
  assert.ok(sat >= HUDDLE_SEC - 1.5 && sat <= HUDDLE_SEC + 1, `about 8 s, got ${sat}`);
  assert.equal(held(os), 1);
  assert.equal(bursts(os), 1, 'no second burst at the end');
  for (const uid of seats) assert.equal(snap(os).benches.includes(uid), false, 'seat let go');
  until(
    os,
    () =>
      [a.id, b.id].every((id) => {
        const s = sub(os, id);
        return s.station && s.seat !== null && !MEETING.includes(s.seat);
      }),
    30,
    'back at a station',
  );
  for (const id of [a.id, b.id]) assert.ok(!MEETING.includes(sub(os, id).seat!));
});

test('no move-up during the meeting: the two stay on their chairs though better stations are free', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, bothSeated(os), 120, 'seated');
  const seats = [...huddle(os)!.seats];
  run(os, HUDDLE_SEC - 2);
  assert.ok(huddle(os), 'still in the meeting');
  assert.deepEqual([sub(os, a.id).seat, sub(os, b.id).seat].sort(), [...seats].sort());
});

test('once per subagent: a third sibling never meets one that has met; a replacement for a gone one does not meet the one that met', () => {
  const os = floor();
  const [a] = pair(os);
  const c = spawn(os, 'general-purpose');
  until(os, () => held(os) === 1 && huddle(os) === null, 150, 'the first meeting is over');
  run(os, 60);
  assert.equal(held(os), 1, 'the third has nobody to meet');
  assert.equal(huddle(os), null);
  // One of the met pair goes and a new one comes: it can meet the third but the other met one cannot join.
  os.removeSubagent(1, a.tool);
  const d = spawn(os, 'general-purpose');
  until(os, () => huddle(os) !== null, 150, 'the second meeting');
  assert.deepEqual([...huddle(os)!.subs].sort(), [c.id, d.id].sort(), 'the two that had not met');
  until(os, () => held(os) === 2, 60, 'held');
  run(os, 30);
  assert.equal(held(os), 2);
});

test('four siblings make two meetings, one at a time', () => {
  const os = floor();
  const ids = [1, 2, 3, 4].map(() => spawn(os, 'general-purpose').id);
  let maxSeated = 0;
  for (let t = 0; t < 400 && held(os) < 2 + 0; t += DT) {
    os.update(DT);
    const onChairs = ids.filter((id) => MEETING.includes(sub(os, id).seat ?? ''));
    maxSeated = Math.max(maxSeated, onChairs.length);
    assert.ok(onChairs.length <= 2, 'never more than two at the table');
  }
  until(os, () => held(os) === 2, 200, 'two meetings');
  until(os, () => huddle(os) === null, 30, 'the second ends');
  run(os, 40);
  assert.equal(held(os), 2);
  assert.equal(bursts(os), 2);
  assert.ok(maxSeated <= 2);
});

test('no meeting with fewer than two free meeting seats; a lead’s assigned seat is never taken', () => {
  const os = floor();
  // A lead sits on one chair of each row for real.
  os.seats.get(ROW1[0])!.assigned = true;
  os.seats.get(ROW2[1])!.assigned = true;
  pair(os);
  run(os, 60);
  assert.equal(huddle(os), null, 'no pair of chairs facing each other is free');
  assert.equal(held(os), 0);
  assert.equal(os.seats.get(ROW1[0])!.assigned, true);
  assert.equal(
    snap(os).benches.some((u) => MEETING.includes(u)),
    false,
  );
  // One row frees: they meet there, and never on the chair a lead holds.
  os.seats.get(ROW1[0])!.assigned = false;
  until(os, () => huddle(os) !== null, 20, 'a meeting once a pair is free');
  assert.deepEqual([...huddle(os)!.seats].sort(), [...ROW1].sort());
  assert.equal(os.seats.get(ROW2[1])!.assigned, true);
});

test('the walk timeout: one stuck walk ends the meeting with no burst, and the pair goes back to work', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, () => huddle(os) !== null, 90, 'a meeting');
  assert.equal(huddle(os)!.seated, 0);
  // The walk has taken too long (the meeting began 31 s ago, on the office's clock).
  (os.aero as unknown as { huddle: { startedAt: number } }).huddle.startedAt -= 31;
  run(os, 0.3);
  assert.equal(huddle(os), null);
  assert.equal(bursts(os), 0);
  assert.equal(held(os), 0);
  until(
    os,
    () =>
      [a.id, b.id].every((id) => sub(os, id).seat !== null && !MEETING.includes(sub(os, id).seat!)),
    40,
    'back at a station',
  );
  run(os, 30);
  assert.equal(huddle(os), null, 'they have met (counted when it was assigned): no retry loop');
});

// ── The early ends ─────────────────────────────────────────────────

test('despawn: a subagent that ends mid-meeting ends it with no burst when still walking; the other goes back to a station', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, () => huddle(os) !== null, 90, 'a meeting');
  assert.equal(huddle(os)!.seated, 0);
  os.removeSubagent(1, a.tool);
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(bursts(os), 0, 'no burst on an early end');
  until(
    os,
    () => sub(os, b.id).seat !== null && !MEETING.includes(sub(os, b.id).seat!),
    40,
    'back',
  );
});

test('despawn while seated: the meeting ends, the burst already went once', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, bothSeated(os), 120, 'seated');
  os.removeSubagent(1, b.tool);
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(bursts(os), 1);
  until(
    os,
    () => sub(os, a.id).seat !== null && !MEETING.includes(sub(os, a.id).seat!),
    40,
    'back',
  );
});

test('idle: a subagent that stops working ends the meeting; it stands up and the other goes back to work', () => {
  const os = floor();
  const [a, b] = pair(os);
  until(os, bothSeated(os), 120, 'seated');
  os.setAgentActive(a.id, false);
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(
    snap(os).benches.some((u) => MEETING.includes(u)) && sub(os, a.id).seat !== null,
    false,
  );
  until(
    os,
    () => sub(os, b.id).seat !== null && !MEETING.includes(sub(os, b.id).seat!),
    40,
    'back',
  );
  assert.equal(sub(os, a.id).seat === null || !MEETING.includes(sub(os, a.id).seat!), true);
});

test('permission: a permission bubble ends the meeting', () => {
  const os = floor();
  const [a] = pair(os);
  until(os, bothSeated(os), 120, 'seated');
  os.showPermissionBubble(a.id);
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(held(os), 1);
});

test('a floor switch: the floor leaving ends the meeting with the seats let go', () => {
  const os = floor();
  pair(os);
  until(os, () => huddle(os) !== null, 90, 'a meeting');
  assert.ok(setAeroUpdate(upd([], FB)));
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(
    snap(os).benches.some((u) => MEETING.includes(u)),
    false,
    'the seats are free',
  );
  assert.equal(bursts(os), 0);
});

test('a lead seated on a meeting chair for real ends the meeting that holds it', () => {
  const os = floor();
  pair(os);
  until(os, () => huddle(os) !== null, 90, 'a meeting');
  const seat = huddle(os)!.seats[0];
  os.seats.get(seat)!.assigned = true;
  run(os, 0.5);
  assert.equal(huddle(os), null);
  assert.equal(os.seats.get(seat)!.assigned, true, 'the lead’s seat is left alone');
});

// ── The switch, the Rooms style, and who meets ─────────────────────

test('the switch: off, nobody meets; turned off mid-meeting it ends with no burst; on again, they meet', () => {
  const os = floor();
  assert.equal(snap(os).meetingsOn, true, 'on by default');
  os.aero.setMeetings(false);
  assert.equal(snap(os).meetingsOn, false);
  pair(os);
  run(os, 60);
  assert.equal(huddle(os), null);
  assert.equal(held(os), 0);
  os.aero.setMeetings(true);
  until(os, () => huddle(os) !== null, 20, 'they meet once it is on');
  os.aero.setMeetings(false);
  assert.equal(huddle(os), null);
  assert.equal(bursts(os), 0);
});

test('the Rooms style (no pods in force) has no meetings', () => {
  const os = buildWorld();
  os.aero.rng = fixed(0.2);
  os.addAgent(1, 0, 0, undefined, true, FA);
  os.setAgentActive(1, true);
  const rooms = upd();
  delete rooms['pods'];
  assert.ok(setAeroUpdate(rooms));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  pair(os);
  run(os, 90);
  assert.equal(huddle(os), null);
  assert.equal(held(os), 0);
});

test('a person standing in for a subagent and a stock subagent meet', () => {
  const os = floor(staff('reviewer'));
  const stock = spawn(os, 'general-purpose');
  const other = spawn(os, 'reviewer');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.ok(person(os, other.id), 'a person stands in for the reviewer');
  assert.ok(sub(os, stock.id), 'the other is a stock subagent');
  until(os, () => huddle(os) !== null, 120, 'a meeting');
  assert.deepEqual([...huddle(os)!.subs].sort(), [stock.id, other.id].sort());
  until(os, bothSeated(os), 60, 'seated');
  assert.equal(held(os), 1);
  assert.equal(os.seats.get(huddle(os)!.seats[0])!.assigned, false);
});

test('an overflow worker on a meeting chair still moves up to a better station when one frees', () => {
  const os = floor();
  os.aero.setMeetings(false);
  const subs = [1, 2, 3, 4, 5, 6].map(() => spawn(os, 'general-purpose'));
  until(os, () => subs.every((s) => sub(os, s.id).station), 120, 'all placed');
  until(os, () => subs.every((s) => os.characters.get(s.id)!.state !== CharacterState.WALK), 120);
  const onChair = subs.find((s) => MEETING.includes(sub(os, s.id).seat ?? ''));
  assert.ok(onChair, 'an overflow worker is on a meeting chair');
  os.aero.setMeetings(true);
  // A pod bench frees: the one on the meeting chair (the worst tier) moves up, meeting or not.
  const pod = subs.find((s) => [WOOD_A, WOOD_B].includes(sub(os, s.id).seat ?? ''))!;
  os.removeSubagent(1, pod.tool);
  until(os, () => !MEETING.includes(sub(os, onChair.id).seat ?? 'x'), 60, 'it moved up');
});
