/**
 * Aero's subagents at work (docs/work/phase6-subagent-work/plan.md, task 4a, rounds 1 and 2): a stock subagent, a roster person or a
 * contractor borrows a real station, never facing a wall: the lead's pod PC benches, then the focus seats, the hot desks, the library
 * and the meeting seats; what it does is told by its type (a fixed table); borrowed seats never flip `assigned`; a waiting one holds
 * its station, an idle one goes to the pod's water cooler.
 *
 * `buildWorld` is a small open office with Aero's zone labels: Pod 1 (a lead bench, two PC benches, a whiteboard, a cooler, bottom
 * benches), Focus, Hot desks (with a bookshelf), Library (a double bookshelf and one with its front blocked), Meeting and the Lounge.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { ACTIVITY_BUBBLE, activityOf, chainOf } from '../src/aero/activity.js';
import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { drawAeroOverlay, spriteTop } from '../src/aero/overlay.js';
import { AREA_LABEL_FALLBACK_COLOR, CHARACTER_SITTING_OFFSET_PX } from '../src/constants.js';
import { getCharacterSprite, sittingOffsetPx } from '../src/office/engine/characters.js';
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
const LEAD = 'p1-lead';
const WOOD_A = 'p1-wood-a';
const WOOD_B = 'p1-wood-b';
const BOTTOM_A = 'p1-bottom-a';
const FOCUS = ['focus-a', 'focus-b'];
const HOT = ['hot-a', 'hot-b'];
const LIBRARY = ['lib-a', 'lib-b'];
const MEETING = ['meet-a', 'meet-b'];
const GUARD = 'aero-0a1b2c3d-security-2';
const RECEPTION = 'aero-0a1b2c3d-reception-0';
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';
const PR_LEAD = 'pr-lead';
const FB = 'bbbbbbbbbbbb';
/** The whiteboard's front tile, the cooler's front tile, the hot-desk shelf's fronts and the library shelf's fronts. */
const BOARD_FRONT = { col: 1, row: 6 };
const COOLER_FRONT = { col: 7, row: 4 };

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
    entry('WOODEN_CHAIR_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('WOODEN_CHAIR_BACK', 'chairs', 1, 1, { orientation: 'back' }),
    entry('SOFA_FRONT', 'chairs', 1, 1, { orientation: 'front' }),
    entry('BOOKSHELF', 'storage', 2, 1),
    entry('DOUBLE_BOOKSHELF', 'storage', 2, 2),
    entry('AERO_POD_WHITEBOARD', 'decor', 1, 2, { backgroundTiles: 1 }),
    entry('AERO_ELEVATOR', 'misc', 2, 2, { backgroundTiles: 1 }),
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
    // Pod 1 (columns 1-7, rows 2-6): three PCs on desks, the lead's bench in the middle, a wooden bench either side.
    ...[2, 4, 6].map((c) => f(`pc-${c}`, 'PC_OFF', c, 2)),
    ...[2, 4, 6].map((c) => f(`desk-${c}`, 'DESK', c, 3)),
    f(WOOD_A, 'WOODEN_BENCH', 2, 4),
    f(LEAD, 'CUSHIONED_BENCH', 4, 4),
    f(WOOD_B, 'WOODEN_BENCH', 6, 4),
    f(BOTTOM_A, 'WOODEN_BENCH', 2, 6),
    f('pod-board', 'AERO_POD_WHITEBOARD', 1, 4),
    f('pod-cooler', 'AERO_WATERCOOLER', 7, 2),
    // Focus (columns 10-12, rows 2-6): two chairs facing up, and the front desk's two chairs.
    f(FOCUS[0], 'WOODEN_CHAIR_BACK', 10, 4),
    f(FOCUS[1], 'WOODEN_CHAIR_BACK', 11, 4),
    f(GUARD, 'CUSHIONED_CHAIR_FRONT', 12, 3),
    f(RECEPTION, 'CUSHIONED_CHAIR_FRONT', 12, 5),
    // Hot desks (columns 10-19, rows 8-13): two benches and a shelf whose front (row 14) is the hall.
    f(HOT[0], 'WOODEN_BENCH', 10, 11),
    f(HOT[1], 'WOODEN_BENCH', 11, 11),
    f('hot-shelf', 'BOOKSHELF', 14, 13),
    // Library (columns 22-33, rows 8-13): two chairs, a shelf with a free front, and one whose front the first one blocks.
    f(LIBRARY[0], 'WOODEN_CHAIR_FRONT', 24, 10),
    f(LIBRARY[1], 'WOODEN_CHAIR_BACK', 24, 12),
    f('lib-shelf', 'DOUBLE_BOOKSHELF', 28, 11),
    f('lib-shelf-back', 'DOUBLE_BOOKSHELF', 28, 9),
    // Meeting (columns 22-28, rows 17-21).
    f(MEETING[0], 'WOODEN_CHAIR_FRONT', 24, 18),
    f(MEETING[1], 'WOODEN_CHAIR_FRONT', 26, 18),
    // The Lounge (columns 31-38, rows 17-21).
    f('aero-0a1b2c3d-lounge-0', 'WHITEBOARD', 32, 17),
    f('aero-0a1b2c3d-lounge-1', 'CLOCK', 34, 17),
    f(LOUNGE_SEAT, 'SOFA_FRONT', 33, 19),
    // The PR bay (columns 15-19, rows 2-6): a lead bench at a PC, and a side bench facing down with no PC.
    f('pc-pr', 'PC_OFF', 16, 2),
    f('desk-pr', 'DESK', 16, 3),
    f(PR_LEAD, 'CUSHIONED_BENCH', 16, 4),
    f('pr-side', 'WOODEN_BENCH', 18, 6),
    // The lifts, for contractors.
    f('lift-0', 'AERO_ELEVATOR', 20, 22),
    f('lift-1', 'AERO_ELEVATOR', 22, 22),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
  zone('PR Runs', 15, 19, 2, 6);
  zone('Focus', 10, 12, 2, 6);
  zone('Hot desks', 10, 19, 8, 13);
  zone('Library', 22, 33, 8, 13);
  zone('Hall', 1, 38, 14, 15);
  zone('Meeting', 22, 28, 17, 21);
  zone('Lounge', 31, 38, 17, 21);
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture,
    areas: ['Pod 1', 'PR Runs', 'Focus', 'Hot desks', 'Library', 'Hall', 'Meeting', 'Lounge'].map(
      (label) => ({
        label,
        color: AREA_LABEL_FALLBACK_COLOR,
      }),
    ),
    areaTiles,
    pets: [],
  };
  return new OfficeState(layout);
}

const upd = (agents: unknown[] = []): Record<string, unknown> => ({
  lunch: false,
  meeting: null,
  inbox: 0,
  lounge: true,
  agents,
  pods: { mappings: { [FA]: ['Pod 1'], [FB]: ['Hot desks'], prruns: ['PR Runs'] }, labels: {} },
  floor: { id: FA, number: 1, name: 'f', rooms: [FA] },
});
const staff = (...slugs: string[]) =>
  slugs.map((s) => ({ name: s[0].toUpperCase() + s.slice(1), slug: s, floor: FA }));

const run = (os: OfficeState, seconds: number, dt = 0.1) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) os.update(dt);
};

/** A world with a working lead on Pod 1's cushioned bench, spawned. */
function floor(agents: unknown[] = []): OfficeState {
  const os = buildWorld();
  os.addAgent(1, 0, 0, undefined, true, FA);
  os.setAgentActive(1, true);
  assert.ok(setAeroUpdate(upd(agents)));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.equal(os.characters.get(1)!.seatId, LEAD, 'the lead sits on the cushioned bench');
  return os;
}

let toolCount = 0;
/** A subagent of the lead as production makes it: the Task tool, then `Subtask: <type>`; active. */
function spawn(os: OfficeState, type: string, parent = 1): { id: number; tool: string } {
  const tool = `tool-${++toolCount}`;
  const id = os.addSubagent(parent, tool);
  os.aero.subagentStarted(parent, tool, `Subtask: ${type}`);
  os.setAgentTool(id, 'Subtask');
  os.setAgentActive(id, true);
  return { id, tool };
}
/** Spawns one and lets it spawn-effect, walk and sit. */
function work(os: OfficeState, type: string): { id: number; tool: string } {
  const sub = spawn(os, type);
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const ch = os.characters.get(sub.id)!;
  until(os, () => ch.state !== CharacterState.WALK, 90);
  run(os, 0.5);
  return sub;
}
function until(os: OfficeState, done: () => boolean, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.1) {
    if (done()) return;
    os.update(0.1);
  }
  assert.ok(done(), `condition within ${seconds}s`);
}
const sub = (os: OfficeState, id: number) => os.aero.snapshot().subagents.find((s) => s.id === id)!;

// ── R1: the router ─────────────────────────────────────────────────

test('a general-purpose subagent types at a PC bench of its lead’s pod, facing its PC, with the PC on, and takes no seat', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  const s = sub(os, id);
  assert.ok(s.seat === WOOD_A || s.seat === WOOD_B, `a PC bench, got ${s.seat}`);
  const ch = os.characters.get(id)!;
  assert.equal(ch.state, CharacterState.TYPE);
  assert.equal(ch.dir, Direction.UP);
  assert.equal(s.dir, Direction.UP);
  assert.equal(ch.seatId, s.seat);
  assert.equal(os.seats.get(s.seat!)!.assigned, false, 'borrowed, never assigned');
  assert.ok(os.aero.snapshot().benches.includes(s.seat!));
  const pc = s.seat === WOOD_A ? 'pc-2' : 'pc-6';
  assert.ok(os.aero.snapshot().pcsOn.includes(pc), 'the PC it faces is on');
});

test('a new subagent does not copy its lead’s direction', () => {
  const os = floor();
  os.characters.get(1)!.dir = Direction.LEFT;
  const id = os.addSubagent(1, 'fresh');
  assert.equal(os.characters.get(id)!.dir, Direction.DOWN);
});

test('the chain: the pod’s PC benches, then the focus seats, the hot desks, the library, the meeting seats; nearest first', () => {
  const os = floor();
  const order: string[] = [];
  const subs: number[] = [];
  for (let i = 0; i < 10; i++) {
    const { id } = work(os, 'general-purpose');
    subs.push(id);
    order.push(sub(os, id).seat ?? 'none');
  }
  const tiers = [[WOOD_A, WOOD_B], FOCUS, HOT, LIBRARY, MEETING];
  let at = 0;
  for (const tier of tiers) {
    const got = order.slice(at, at + tier.length);
    assert.deepEqual([...got].sort(), [...tier].sort(), `tier ${tier.join()} got ${got.join()}`);
    at += tier.length;
  }
  // The pod’s benches are taken by distance from the lead: both are two tiles away, so by uid; the lead’s bench and the front desk’s
  // chairs and the pod’s bottom bench are never taken.
  for (const seat of order) {
    assert.notEqual(seat, LEAD);
    assert.notEqual(seat, GUARD);
    assert.notEqual(seat, RECEPTION);
    assert.notEqual(seat, BOTTOM_A);
  }
  for (const [uid, seat] of os.seats) {
    const held = uid === LEAD || uid === GUARD || uid === RECEPTION;
    assert.equal(seat.assigned, held, `${uid} assigned only when it is the lead’s or the desk’s`);
  }
  // Every one sits facing its seat, none faces away from it.
  for (const id of subs) {
    const s = sub(os, id);
    const seat = os.seats.get(s.seat!)!;
    assert.equal(os.characters.get(id)!.dir, seat.facingDir);
  }
});

test('the next in line when a tier is empty: a pod with no free PC bench starts at the focus seats', () => {
  const os = floor();
  work(os, 'general-purpose');
  work(os, 'general-purpose');
  const { id } = work(os, 'general-purpose');
  assert.ok(FOCUS.includes(sub(os, id).seat!));
  assert.equal(os.characters.get(id)!.dir, Direction.UP);
});

test('borrowed seats never flip assigned: removing, releasing and rebuilding leave a seat somebody else holds alone', () => {
  const os = floor();
  const a = work(os, 'general-purpose');
  const seat = sub(os, a.id).seat!;
  // Somebody sits on it (a lead taking the seat for real): a stock removal must not free it.
  os.seats.get(seat)!.assigned = true;
  os.removeSubagent(1, a.tool);
  assert.equal(os.seats.get(seat)!.assigned, true, 'removeSubagent');

  const b = work(os, 'general-purpose');
  const seatB = sub(os, b.id).seat!;
  os.seats.get(seatB)!.assigned = true;
  os.removeAllSubagents(1);
  assert.equal(os.seats.get(seatB)!.assigned, true, 'removeAllSubagents');

  const os2 = floor();
  const c = work(os2, 'general-purpose');
  const seatC = sub(os2, c.id).seat!;
  os2.seats.get(seatC)!.assigned = true;
  os2.releaseSeat(os2.characters.get(c.id)!);
  assert.equal(os2.seats.get(seatC)!.assigned, true, 'releaseSeat');

  // A layout rebuild does not give the seat to the borrower.
  const os3 = floor();
  const d = work(os3, 'general-purpose');
  const seatD = sub(os3, d.id).seat!;
  os3.rebuildFromLayout(os3.getLayout());
  assert.equal(os3.seats.get(seatD)!.assigned, false, 'rebuildFromLayout');
  assert.equal(os3.seats.get(LEAD)!.assigned, true);
});

test('a borrower stands up when somebody is seated on its seat for real', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  const seat = sub(os, id).seat!;
  os.seats.get(seat)!.assigned = true;
  run(os, 3);
  const after = sub(os, id);
  assert.notEqual(after.seat, seat);
  assert.equal(os.aero.snapshot().benches.includes(seat), false);
});

test('a layout rebuild lets a borrower go and it takes a station again; no seat is left assigned to it', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  os.rebuildFromLayout(os.getLayout());
  run(os, 8);
  const s = sub(os, id);
  assert.ok(s.seat !== null, 'seated again');
  for (const [uid, seat] of os.seats) {
    assert.equal(seat.assigned, uid === LEAD || uid === GUARD || uid === RECEPTION, uid);
  }
});

test('a borrower in a seat outside the lead’s zone is not evicted for it; only a pod PC bench is zone-checked', () => {
  const os = floor();
  work(os, 'general-purpose');
  work(os, 'general-purpose');
  const { id } = work(os, 'general-purpose');
  const seat = sub(os, id).seat;
  assert.ok(FOCUS.includes(seat!));
  run(os, 30);
  assert.equal(sub(os, id).seat, seat, 'it stays in the focus seat');
});

test('a stock subagent with no station (a layout with no benches and no zones) stays where it is, facing down', () => {
  loadCatalog();
  const layout = buildWorld().getLayout();
  const bare: OfficeLayout = {
    ...layout,
    furniture: layout.furniture.filter(
      (x) => x.uid.startsWith('aero-0a1b2c3d-lounge') || x.uid === LEAD,
    ),
    areaTiles: layout.areaTiles!.map(() => null),
  };
  const os = new OfficeState(bare);
  os.addAgent(1, 0, 0, undefined, true);
  os.setAgentActive(1, true);
  const noPods = upd();
  delete noPods.pods;
  delete noPods.floor;
  assert.ok(setAeroUpdate(noPods));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const { id } = work(os, 'general-purpose');
  const s = sub(os, id);
  assert.equal(s.seat, null);
  assert.equal(s.stand, null);
  assert.equal(os.characters.get(id)!.dir, Direction.DOWN);
});

test('a subagent that is removed frees what it held, once its character is gone from the office', () => {
  const os = floor();
  const a = work(os, 'general-purpose');
  const seat = sub(os, a.id).seat!;
  assert.ok(os.aero.snapshot().benches.includes(seat));
  os.removeSubagent(1, a.tool);
  run(os, 0.5);
  assert.equal(os.aero.snapshot().benches.includes(seat), false);
  const b = work(os, 'general-purpose');
  assert.equal(sub(os, b.id).seat, seat, 'the next one takes it');
});

test('a subagent whose lead’s floor is left and shown again is put at its station at once, not walked there', () => {
  const os = floor();
  work(os, 'Plan');
  const b = work(os, 'general-purpose');
  const seat = sub(os, b.id).seat!;
  const other = upd();
  other.floor = { id: 'bbbbbbbbbbbb', number: 2, name: 'g', rooms: ['bbbbbbbbbbbb'] };
  assert.ok(setAeroUpdate(other));
  run(os, 1);
  assert.equal(os.aero.snapshot().benches.includes(seat), false, 'let go while off the floor');
  assert.ok(setAeroUpdate(upd()));
  os.update(0.1);
  const ch = os.characters.get(b.id)!;
  const st = os.seats.get(sub(os, b.id).seat!)!;
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, { col: st.seatCol, row: st.seatRow });
  assert.equal(ch.state, CharacterState.TYPE);
  assert.equal(ch.dir, st.facingDir);
});

test('a contractor works like a person: its subagent’s activity, reading sprite and permission dots', () => {
  const os = floor(staff('reviewer'));
  spawn(os, 'reviewer');
  const second = spawn(os, 'reviewer');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const contractor = os.aero.people.find((p) => p.contractor)!;
  assert.ok(contractor, 'hired');
  assert.equal(contractor.subId, second.id);
  until(os, () => contractor.ch.state === CharacterState.TYPE, 90);
  assert.equal(contractor.activity, 'review');
  assert.equal(contractor.ch.aeroReading, true);
  assert.ok(contractor.bench !== null || contractor.prop !== null, 'at a station');
  os.showPermissionBubble(second.id);
  run(os, 0.2);
  assert.equal(contractor.ch.bubbleType, 'permission');
  assert.ok(os.aero.workBubbles().some((b) => b.ch === contractor.ch && b.text === '...'));
});

// ── R1: standing ──────────────────────────────────────────────────

test('standing at a prop has no sitting offset: the hit test, the name plate and the sprite anchor', () => {
  const os = floor();
  const { id } = work(os, 'Plan');
  const ch = os.characters.get(id)!;
  assert.equal(ch.state, CharacterState.TYPE);
  assert.equal(ch.aeroStanding, true);
  // Hit test: the sprite stands on its tile, not 6 px lower.
  assert.equal(os.getCharacterAt(ch.x, ch.y - 10), id);
  assert.equal(os.getCharacterAt(ch.x, ch.y + CHARACTER_SITTING_OFFSET_PX - 1), null);
  assert.equal(spriteTop(ch).y, ch.y - 24);
  // A sitting one keeps the offset.
  const sitter = work(os, 'general-purpose');
  const sat = os.characters.get(sitter.id)!;
  assert.equal(sat.aeroStanding, false);
  assert.equal(spriteTop(sat).y, sat.y + CHARACTER_SITTING_OFFSET_PX - 24);
});

// ── R2: activity by type ───────────────────────────────────────────

test('the activity table: by the type’s name, the first match of read, plan, review, else type', () => {
  for (const t of ['Explore', 'explorer', 'deep-research', 'web-searcher', 'EXPLORE'])
    assert.equal(activityOf(t), 'read', t);
  for (const t of ['Plan', 'planner', 'software-architect', 'ui-designer', 'plan'])
    assert.equal(activityOf(t), 'plan', t);
  for (const t of ['code-reviewer', 'security-review', 'reviewer'])
    assert.equal(activityOf(t), 'review', t);
  for (const t of ['general-purpose', 'statusline-setup', 'unknown-thing', '', 'x'.repeat(500)])
    assert.equal(activityOf(t), 'type', t);
  assert.deepEqual(chainOf('plan').slice(0, 2), ['whiteboard', 'pc']);
  assert.deepEqual(chainOf('read').slice(0, 2), ['library', 'shelf']);
  assert.deepEqual(chainOf('type'), ['pc', 'focus', 'hot', 'library', 'meeting']);
});

test('an Explore subagent reads at a library seat or a shelf front, facing it, with the reading sprite', () => {
  const os = floor();
  const { id } = work(os, 'Explore');
  const ch = os.characters.get(id)!;
  const s = sub(os, id);
  assert.equal(s.activity, 'read');
  assert.ok(
    (s.seat !== null && LIBRARY.includes(s.seat)) || s.stand !== null,
    `a library seat or a shelf, got ${s.seat}`,
  );
  assert.equal(ch.aeroReading, true);
  assert.equal(ch.state, CharacterState.TYPE);
  const sprites = { reading: dirs('r'), typing: dirs('t'), walk: dirs('w') };
  assert.equal(getCharacterSprite(ch, sprites as never), sprites.reading[ch.dir][0]);
});

test('a second Explore reads at the next library place; the shelf fronts are the hall’s and the library’s free ones', () => {
  const os = floor();
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const { id } = work(os, 'Explore');
    const s = sub(os, id);
    seen.add(s.seat ?? `${s.stand!.col},${s.stand!.row}`);
    if (s.stand) assert.equal(os.characters.get(id)!.dir, Direction.UP);
  }
  assert.equal(seen.size, 5, 'five different places');
  // The shelf at (28,9) has its front blocked by the one below; its front (28,11) is never a station.
  assert.equal(seen.has('28,11'), false);
  assert.equal(seen.has('29,11'), false);
});

test('a Plan subagent stands at the pod whiteboard facing up; another takes the PC chain', () => {
  const os = floor();
  const a = work(os, 'Plan');
  const sa = sub(os, a.id);
  assert.deepEqual(sa.stand, BOARD_FRONT);
  assert.equal(sa.seat, null);
  assert.equal(os.characters.get(a.id)!.dir, Direction.UP);
  assert.equal(os.characters.get(a.id)!.tileCol, BOARD_FRONT.col);
  assert.equal(os.characters.get(a.id)!.tileRow, BOARD_FRONT.row);
  const b = work(os, 'Plan');
  const sb = sub(os, b.id);
  assert.notDeepEqual(sb.stand, BOARD_FRONT);
  assert.ok(sb.seat === WOOD_A || sb.seat === WOOD_B);
});

test('a reviewer reads at a PC bench: the PC is on and the sprite is the reading one', () => {
  const os = floor();
  const { id } = work(os, 'code-reviewer');
  const s = sub(os, id);
  assert.equal(s.activity, 'review');
  assert.ok(s.seat === WOOD_A || s.seat === WOOD_B);
  assert.equal(os.characters.get(id)!.aeroReading, true);
  assert.equal(os.characters.get(id)!.aeroStanding, false);
  const pc = s.seat === WOOD_A ? 'pc-2' : 'pc-6';
  assert.ok(os.aero.snapshot().pcsOn.includes(pc), 'the PC it reads at is on');
});

test('bubbles come from the fixed table only: a type’s own text is never shown', () => {
  const os = floor();
  const { id } = work(os, 'Explore<b>boom</b>');
  const texts = drawnTexts(os);
  assert.ok(texts.includes(ACTIVITY_BUBBLE.read));
  for (const t of texts) assert.equal(t.includes('boom'), false, t);
  const bubbles = os.aero.workBubbles().filter((b) => b.ch.id === id);
  assert.deepEqual(
    bubbles.map((b) => b.text),
    [ACTIVITY_BUBBLE.read],
  );
  // A walking or inactive subagent shows none.
  os.setAgentActive(id, false);
  assert.deepEqual(
    os.aero.workBubbles().filter((b) => b.ch.id === id),
    [],
  );
});

test('a subagent waiting for permission stays at its station and shows no activity bubble', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  const seat = sub(os, id).seat;
  os.setAgentActive(id, false);
  os.showPermissionBubble(id);
  run(os, 120);
  assert.equal(sub(os, id).seat, seat, 'still there after two minutes');
  assert.equal(os.characters.get(id)!.state, CharacterState.TYPE);
  assert.equal(os.characters.get(id)!.frame, 0);
  assert.deepEqual(
    os.aero.workBubbles().filter((b) => b.ch.id === id),
    [],
  );
});

test('idle for a while: it lets go of its bench and stands at the pod’s water cooler facing up; working again it sits again', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  const seat = sub(os, id).seat!;
  os.setAgentActive(id, false);
  run(os, 10);
  assert.equal(sub(os, id).seat, seat, 'still seated after 10 s');
  run(os, 30);
  const s = sub(os, id);
  assert.equal(s.seat, null);
  assert.equal(os.aero.snapshot().benches.includes(seat), false, 'the bench is free');
  const ch = os.characters.get(id)!;
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, COOLER_FRONT);
  assert.equal(ch.dir, Direction.UP);
  assert.notEqual(ch.state, CharacterState.WALK);
  run(os, 60);
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, COOLER_FRONT, 'it stays');
  // Back to work.
  os.setAgentActive(id, true);
  run(os, 10);
  assert.ok(sub(os, id).seat !== null);
  assert.equal(os.characters.get(id)!.state, CharacterState.TYPE);
});

test('the hold is on the tick clock: a borrower at a worse tier moves up only after 8 s, once a better station is free', () => {
  const os = floor();
  work(os, 'general-purpose');
  const b = work(os, 'general-purpose');
  const c = spawn(os, 'general-purpose');
  until(os, () => sub(os, c.id).seat !== null, 20);
  assert.ok(FOCUS.includes(sub(os, c.id).seat!), 'the third sits in focus');
  // A pod bench frees now; the third took its seat just now.
  os.removeSubagent(1, b.tool);
  run(os, 5);
  assert.ok(FOCUS.includes(sub(os, c.id).seat!), 'held for 8 s');
  run(os, 5);
  assert.ok([WOOD_A, WOOD_B].includes(sub(os, c.id).seat!), 'then it moves up to the PC bench');
  assert.equal(os.seats.get(sub(os, c.id).seat!)!.assigned, false);
});

// ── R2: people and contractors ─────────────────────────────────────

test('a person mirrors its subagent: active, permission and the activity bubble; a permission shows dots over the person', () => {
  const os = floor(staff('reviewer'));
  const { id } = spawn(os, 'reviewer');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const person = os.aero.people.find((p) => p.slug === 'reviewer')!;
  until(os, () => person.ch.state === CharacterState.TYPE, 90);
  assert.equal(person.subId, id);
  assert.equal(os.characters.get(id)!.aeroHidden, true);
  assert.equal(person.ch.isActive, true);
  assert.ok([WOOD_A, WOOD_B].includes(person.bench!), 'at a PC bench');
  assert.equal(person.ch.aeroReading, true, 'a reviewer reads');
  assert.ok(drawnTexts(os).includes(ACTIVITY_BUBBLE.review));
  os.showPermissionBubble(id);
  run(os, 0.2);
  assert.equal(person.ch.bubbleType, 'permission');
  assert.ok(drawnTexts(os).includes('...'), 'permission dots over the person');
  assert.equal(drawnTexts(os).includes(ACTIVITY_BUBBLE.review), false);
  os.clearPermissionBubble(id);
  os.setAgentActive(id, false);
  run(os, 0.2);
  assert.equal(person.ch.isActive, false);
  assert.equal(person.ch.bubbleType, null);
});

test('a person with its seat taken by the pod goes on to the chain like a stock subagent', () => {
  const os = floor(staff('reviewer', 'planner'));
  spawn(os, 'general-purpose');
  spawn(os, 'general-purpose');
  const { id } = spawn(os, 'planner');
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  const person = os.aero.people.find((p) => p.slug === 'planner')!;
  until(os, () => person.ch.state !== CharacterState.WALK, 90);
  assert.equal(person.subId, id);
  const snap = os.aero.snapshot().people.find((p) => p.slug === 'planner')!;
  assert.equal(snap.activity, 'plan');
  assert.deepEqual({ col: person.ch.tileCol, row: person.ch.tileRow }, BOARD_FRONT);
  assert.equal(person.ch.dir, Direction.UP);
  assert.equal(person.ch.aeroStanding, true);
});

// ── Fix round ──────────────────────────────────────────────────────

const seatsHeld = (os: OfficeState) =>
  [...os.seats]
    .filter(([, seat]) => seat.assigned)
    .map(([uid]) => uid)
    .sort();
const DESK_HELD = [GUARD, LEAD, RECEPTION].sort();

test('fix 1: a rebuild gives no stock seat to a subagent behind a person, at a prop or at the cooler', () => {
  const os = floor(staff('reviewer'));
  spawn(os, 'reviewer');
  work(os, 'Plan');
  const idle = work(os, 'general-purpose');
  os.setAgentActive(idle.id, false);
  run(os, 40);
  assert.ok(os.aero.snapshot().subagents.find((s) => s.id === idle.id)!.cooler, 'at the cooler');
  os.rebuildFromLayout(os.getLayout());
  assert.deepEqual(seatsHeld(os), DESK_HELD, 'right after the rebuild');
  run(os, 5);
  assert.deepEqual(seatsHeld(os), DESK_HELD, 'and after a few ticks');
  for (const ch of os.characters.values()) {
    if (ch.isSubagent) assert.equal(ch.seatId === null || !os.seats.get(ch.seatId)?.assigned, true);
  }
});

test('fix 2: the snapshot’s activity is the subagent’s own, from its type, whether or not it holds a station', () => {
  const os = floor();
  const a = work(os, 'Explore');
  assert.equal(sub(os, a.id).activity, 'read');
  assert.equal(sub(os, a.id).station, true);
  os.setAgentActive(a.id, false);
  run(os, 40);
  const s = sub(os, a.id);
  assert.equal(s.station, false, 'let go of its station');
  assert.equal(s.activity, 'read', 'still an Explore');
  const b = spawn(os, 'Plan');
  assert.equal(sub(os, b.id).activity, 'plan', 'before it has a station');
});

test('fix 3: switching floors lets the old floor’s stations go before the new floor’s subagents are placed; an idle one is not seated on return', () => {
  const os = floor();
  os.addAgent(2, 0, 0, undefined, true, FB);
  os.setAgentActive(2, true);
  const other = (id: string) => ({ id, number: 2, name: 'g', rooms: [id] });
  // Floor A's four subagents fill the two PC benches and both focus chairs.
  const aSubs = [1, 2, 3, 4].map(() => work(os, 'general-purpose'));
  assert.deepEqual(
    aSubs.map((x) => sub(os, x.id).seat).filter((u) => FOCUS.includes(u!)).length,
    2,
  );
  // Floor B's subagent starts off the floor on show.
  const b = spawn(os, 'general-purpose', 2);
  run(os, MATRIX_EFFECT_DURATION + 1);
  assert.equal(sub(os, b.id).seat, null, 'hidden away on floor B: no station');
  const toB = upd();
  toB.floor = other(FB);
  assert.ok(setAeroUpdate(toB));
  os.update(0.1);
  const onB = sub(os, b.id);
  assert.ok(
    FOCUS.includes(onB.seat!),
    `placed at the first free tier (a focus chair), got ${onB.seat}`,
  );
  for (const x of aSubs) assert.equal(sub(os, x.id).seat, null, 'floor A’s let go');
  // An idle subagent of floor A is not seated at a work station when its floor comes back.
  os.setAgentActive(aSubs[0].id, false);
  run(os, 1);
  assert.ok(setAeroUpdate(upd()));
  os.update(0.1);
  const idleAgain = sub(os, aSubs[0].id);
  assert.equal(idleAgain.seat, null);
  assert.equal(idleAgain.stand, null);
  assert.notEqual(os.characters.get(aSubs[0].id)!.state, CharacterState.TYPE);
  const busy = sub(os, aSubs[1].id);
  assert.ok(busy.seat !== null, 'a working one is seated');
});

test('fix 4: a type that arrives ticks after the spawn moves the subagent at once, inside the hold', () => {
  const os = floor();
  const tool = `tool-late-${++toolCount}`;
  const id = os.addSubagent(1, tool);
  os.setAgentTool(id, 'Subtask');
  os.setAgentActive(id, true);
  run(os, MATRIX_EFFECT_DURATION + 2);
  const first = sub(os, id);
  assert.ok(first.seat === WOOD_A || first.seat === WOOD_B, 'a PC bench by default');
  os.aero.subagentStarted(1, tool, 'Subtask: Plan');
  run(os, 0.5);
  const moving = sub(os, id);
  assert.equal(moving.seat, null, 'the bench is let go within half a second');
  assert.deepEqual(moving.stand, BOARD_FRONT);
  run(os, 30);
  assert.deepEqual(sub(os, id).stand, BOARD_FRONT);
  assert.equal(os.characters.get(id)!.state, CharacterState.TYPE);
});

test('fix 5: two subagents of one pod going idle at once do not share the cooler tile', () => {
  const os = floor();
  const a = work(os, 'general-purpose');
  const b = work(os, 'general-purpose');
  os.setAgentActive(a.id, false);
  os.setAgentActive(b.id, false);
  run(os, 60);
  const at = (id: number) => {
    const c = os.characters.get(id)!;
    return `${c.tileCol},${c.tileRow}`;
  };
  assert.notEqual(at(a.id), at(b.id));
  const atCooler = [a, b].filter((x) => at(x.id) === `${COOLER_FRONT.col},${COOLER_FRONT.row}`);
  assert.equal(atCooler.length, 1, 'one at the cooler');
  const stayed = [a, b].find((x) => !atCooler.includes(x))!;
  assert.ok(sub(os, stayed.id).seat !== null, 'the other stays on its bench');
});

test('fix 6: a working subagent with no free station stands facing down, without the sitting offset', () => {
  const os = floor();
  for (let i = 0; i < 10; i++) work(os, 'general-purpose');
  const { id } = work(os, 'general-purpose');
  const s = sub(os, id);
  assert.equal(s.seat, null);
  assert.equal(s.station, false);
  const ch = os.characters.get(id)!;
  assert.equal(ch.aeroStanding, true);
  assert.equal(sittingOffsetPx(ch), 0);
  assert.equal(ch.dir, Direction.DOWN);
});

test('fix 7: a PR lead’s subagents start at the hot desks, before the focus seats', () => {
  const os = floor();
  os.addAgent(2, 0, 0, undefined, true, 'prruns');
  os.setAgentActive(2, true);
  run(os, MATRIX_EFFECT_DURATION + 1);
  assert.equal(os.characters.get(2)!.seatId, PR_LEAD);
  const a = spawn(os, 'general-purpose', 2);
  run(os, MATRIX_EFFECT_DURATION + 1);
  until(os, () => sub(os, a.id).seat !== null, 60);
  assert.ok(HOT.includes(sub(os, a.id).seat!), `a hot desk, got ${sub(os, a.id).seat}`);
  assert.equal(os.seats.get('pr-side')!.assigned, false);
});

test('fix 8: nearest first within a tier; a person overflows from a full pod to the next tier', () => {
  const os = floor(staff('reviewer'));
  work(os, 'general-purpose');
  work(os, 'general-purpose');
  const f1 = work(os, 'general-purpose');
  const f2 = work(os, 'general-purpose');
  assert.equal(sub(os, f1.id).seat, FOCUS[0], 'focus-a is 6 tiles from the lead, focus-b 7');
  assert.equal(sub(os, f2.id).seat, FOCUS[1]);
  const os2 = floor();
  const e1 = work(os2, 'Explore');
  const e2 = work(os2, 'Explore');
  assert.equal(sub(os2, e1.id).seat, LIBRARY[0]);
  assert.equal(sub(os2, e2.id).seat, LIBRARY[1]);
  // A person: the pod’s benches taken, the reviewer goes on to the focus chairs.
  const os3 = floor(staff('reviewer'));
  work(os3, 'general-purpose');
  work(os3, 'general-purpose');
  const { id } = spawn(os3, 'reviewer');
  run(os3, MATRIX_EFFECT_DURATION + 0.5);
  const person = os3.aero.people.find((p) => p.slug === 'reviewer')!;
  assert.equal(person.subId, id);
  until(os3, () => person.ch.state === CharacterState.TYPE, 90);
  assert.ok(FOCUS.includes(person.bench!), `a focus chair, got ${person.bench}`);
  assert.equal(os3.seats.get(person.bench!)!.assigned, false);
});

test('fix 10: a layout rebuild takes a subagent off the cooler', () => {
  const os = floor();
  const { id } = work(os, 'general-purpose');
  os.setAgentActive(id, false);
  run(os, 40);
  assert.equal(sub(os, id).cooler, true);
  os.rebuildFromLayout(os.getLayout());
  run(os, 0.5);
  assert.equal(sub(os, id).cooler, false);
});

// ── helpers ────────────────────────────────────────────────────────

const dirs = (tag: string) => ({
  [Direction.DOWN]: [[tag + 'd0'], [tag + 'd1'], [tag + 'd2'], [tag + 'd3']],
  [Direction.UP]: [[tag + 'u0'], [tag + 'u1'], [tag + 'u2'], [tag + 'u3']],
  [Direction.LEFT]: [[tag + 'l0'], [tag + 'l1'], [tag + 'l2'], [tag + 'l3']],
  [Direction.RIGHT]: [[tag + 'r0'], [tag + 'r1'], [tag + 'r2'], [tag + 'r3']],
});

/** What `drawAeroOverlay` writes with `fillText` on a stub context. */
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
