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
import { getCharacterSprite } from '../src/office/engine/characters.js';
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
    // The lifts, for contractors.
    f('lift-0', 'AERO_ELEVATOR', 20, 22),
    f('lift-1', 'AERO_ELEVATOR', 22, 22),
  ];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  const zone = (label: string, c0: number, c1: number, r0: number, r1: number) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) areaTiles[r * COLS + c] = label;
  };
  zone('Pod 1', 1, 7, 2, 6);
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
    areas: ['Pod 1', 'Focus', 'Hot desks', 'Library', 'Hall', 'Meeting', 'Lounge'].map((label) => ({
      label,
      color: AREA_LABEL_FALLBACK_COLOR,
    })),
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
  pods: { mappings: { [FA]: ['Pod 1'] }, labels: {} },
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
