/**
 * Aero's floors: the update's `floor` shape and every rejection, the off-floor filter (hidden, no seat, not hit, not
 * counted, subagents and teammates with their lead, PR runs on every floor), a floor switch and back, and the floor sign.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { drawFloorSign, type FloorSignContext, floorSignRect } from '../src/aero/floorSign.js';
import { PERSON_ID_BASE, resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { MAX_FLOOR_ROOMS, MAX_FLOORS, parseAeroUpdate } from '../src/aero/update.js';
import { createCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

// ── The update shape ───────────────────────────────────────────────

const A = 'aaaaaaaaaaaa';
const B = 'bbbbbbbbbbbb';
const base = () => ({ lunch: false, meeting: null, inbox: 0, agents: [], lounge: true });
const floor = () => ({ id: A, number: 1, name: 'aero', rooms: [A, 'prruns'] });
const withFloor = (f: unknown) => ({ ...base(), floor: f });

test('an update with a floor is accepted as it is; with null or without, none is kept', () => {
  assert.deepEqual(parseAeroUpdate(withFloor(floor())), { ...base(), floor: floor() });
  const pods = { mappings: { [A]: ['Pod 1'] }, labels: { 'Pod 1': { name: 'x', dim: false } } };
  assert.deepEqual(parseAeroUpdate({ ...base(), pods, floor: floor() }), {
    ...base(),
    pods,
    floor: floor(),
  });
  assert.deepEqual(parseAeroUpdate(withFloor(null)), base());
  assert.equal('floor' in parseAeroUpdate(base())!, false);
  assert.deepEqual(parseAeroUpdate(withFloor({ ...floor(), rooms: [] })), {
    ...base(),
    floor: { ...floor(), rooms: [] },
  });
});

test('a floor that is not exactly the shape rejects the whole update', () => {
  const f = floor();
  const bad: unknown[] = [
    'x',
    [],
    {},
    { ...f, extra: 1 },
    { id: f.id, number: 1, name: 'a' },
    { number: 1, name: 'a', rooms: [] },
    { ...f, id: 'AAAAAAAAAAAA' },
    { ...f, id: 'aaaaaaaaaaa' },
    { ...f, id: 'prruns' },
    { ...f, id: 7 },
    { ...f, number: 0 },
    { ...f, number: MAX_FLOORS + 1 },
    { ...f, number: 1.5 },
    { ...f, number: '1' },
    { ...f, name: '' },
    { ...f, name: '   ' },
    { ...f, name: 'x'.repeat(33) },
    { ...f, name: 'a\nb' },
    { ...f, name: 'a‮b' },
    { ...f, name: 3 },
    { ...f, rooms: 'x' },
    { ...f, rooms: [A, A] },
    { ...f, rooms: ['PRRUNS'] },
    { ...f, rooms: ['abc'] },
    { ...f, rooms: [3] },
    { ...f, rooms: ['../etc/passwd'] },
  ];
  for (const b of bad) assert.equal(parseAeroUpdate(withFloor(b)), null, JSON.stringify(b));
  assert.notEqual(parseAeroUpdate(withFloor({ ...f, name: 'x'.repeat(32) })), null);
  assert.notEqual(parseAeroUpdate(withFloor({ ...f, name: '😀'.repeat(32) })), null);
  assert.notEqual(parseAeroUpdate(withFloor({ ...f, number: MAX_FLOORS })), null);
  const rooms = (n: number) =>
    Array.from({ length: n }, (_, i) => i.toString(16).padStart(12, '0'));
  assert.notEqual(parseAeroUpdate(withFloor({ ...f, rooms: rooms(MAX_FLOOR_ROOMS) })), null);
  assert.equal(parseAeroUpdate(withFloor({ ...f, rooms: rooms(MAX_FLOOR_ROOMS + 1) })), null);
});

test('an update with one floor, pods and agents at their caps stays under 64 KB', () => {
  const area = (i: number) => `Area ${i}`.padEnd(40, 'é');
  const mappings = Object.fromEntries(
    Array.from({ length: 32 }, (_, i) => [
      `d${i}`.padEnd(40, 'é'),
      [0, 1, 2, 3].map((k) => area(i * 4 + k)),
    ]),
  );
  const labels = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => [area(i), { name: 'n'.repeat(40), dim: true }]),
  );
  const update = {
    lunch: true,
    meeting: { time: '12:30', title: 'é'.repeat(60), soon: true },
    inbox: 99_999,
    agents: Array.from({ length: 8 }, (_, i) => ({
      name: 'é'.repeat(40),
      slug: `agent-${i}`,
      room: 'f'.repeat(12),
    })),
    lounge: true,
    pods: { mappings, labels },
    floor: {
      id: A,
      number: MAX_FLOORS,
      name: '😀'.repeat(32),
      rooms: Array.from({ length: MAX_FLOOR_ROOMS }, (_, i) => i.toString(16).padStart(12, '0')),
    },
  };
  assert.notEqual(parseAeroUpdate(update), null, 'the full update is accepted');
  assert.ok(JSON.stringify(update).length < 64 * 1024, `${JSON.stringify(update).length} bytes`);
});

// ── The office ─────────────────────────────────────────────────────

const COLS = 20;
const ROWS = 8;

function seat(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: false };
}

/** Pod 1 (columns 1..3) and Pod 2 (columns 6..8) with three PC seats each, a PR bay and a free chair. */
function build(): OfficeState {
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 5; r++) {
    for (let c = 1; c <= 3; c++) areaTiles[r * COLS + c] = 'Pod 1';
    for (let c = 6; c <= 8; c++) areaTiles[r * COLS + c] = 'Pod 2';
    for (let c = 12; c <= 13; c++) areaTiles[r * COLS + c] = 'PR Runs';
  }
  const seatDefs: Array<[string, number, number, string]> = [
    ['p1-a', 1, 3, 'CUSHIONED_BENCH'],
    ['p1-b', 2, 3, 'WOODEN_BENCH'],
    ['p1-c', 3, 3, 'WOODEN_BENCH'],
    ['p2-a', 6, 3, 'CUSHIONED_BENCH'],
    ['p2-b', 7, 3, 'WOODEN_BENCH'],
    ['p2-c', 8, 3, 'WOODEN_BENCH'],
    ['bay-a', 12, 3, 'WOODEN_BENCH'],
  ];
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
    furniture: seatDefs.map(([uid, col, row, type]) => ({ uid, type, col, row })),
    areas: [
      { label: 'Pod 1', color: '#ff8800' },
      { label: 'Pod 2', color: '#0088ff' },
      { label: 'PR Runs', color: '#00ff88' },
    ],
    areaTiles,
    pets: [],
  };
  const os = new OfficeState(layout);
  os.seats = new Map(seatDefs.map(([uid, col, row]) => [uid, seat(uid, col, row)]));
  (os as unknown as { buildElectronicsTileSet(): Set<string> }).buildElectronicsTileSet = () =>
    new Set(['1,4', '2,4', '3,4', '6,4', '7,4', '8,4']);
  return os;
}

const BAY = 'PR Runs';

/** Floor 1 shows A; floor 2 shows B. Each floor numbers its own pods from 1. */
function onFloor(which: 'A' | 'B'): void {
  const a = which === 'A';
  const id = a ? A : B;
  assert.ok(
    setAeroUpdate({
      ...base(),
      pods: { mappings: { [id]: ['Pod 1'], prruns: [BAY] }, labels: {} },
      floor: { id, number: a ? 1 : 2, name: a ? 'aero' : 'web', rooms: [id, 'prruns'] },
    }),
  );
}

const seated = (os: OfficeState): string[] =>
  [...os.seats.values()].filter((s) => s.assigned).map((s) => s.uid);
const ch = (os: OfficeState, id: number) => os.characters.get(id)!;
const shown = (os: OfficeState, id: number): boolean => os.getCharacters().some((c) => c.id === id);

test('without a floor in the update everyone is shown and seated, as stock', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, A);
  os.addAgent(2, 0, 0, undefined, true, B);
  assert.ok(setAeroUpdate({ ...base(), pods: { mappings: { [A]: ['Pod 1'] }, labels: {} } }));
  os.update(0.1);
  assert.ok(ch(os, 1).seatId && ch(os, 2).seatId);
  assert.deepEqual(
    os
      .getCharacters()
      .map((c) => c.id)
      .sort(),
    [1, 2],
  );
  assert.equal(os.aero.hides(ch(os, 2)), false);
});

test('a lead of another floor is hidden, holds no seat and is not hit; its floor mates are unaffected', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, A);
  os.addAgent(2, 0, 0, undefined, true, B);
  onFloor('A');
  os.update(0.1);
  assert.equal(shown(os, 1), true);
  assert.equal(shown(os, 2), false, 'not drawn');
  assert.equal(ch(os, 2).seatId, null, 'no seat');
  assert.deepEqual(seated(os), [ch(os, 1).seatId], 'the seat is free');
  assert.equal(ch(os, 1).seatId!.startsWith('p1-'), true);
  const hidden = ch(os, 2);
  assert.equal(os.getCharacterAt(hidden.x, hidden.y - 4), null, 'not hit-tested');
  const visible = ch(os, 1);
  assert.equal(os.getCharacterAt(visible.x, visible.y - 4), 1);
  assert.equal(
    os.aero.snapshot().leads.find((l) => l.id === 2)?.shown,
    false,
    'the snapshot says so',
  );
  assert.equal(os.aero.snapshot().leads.find((l) => l.id === 1)?.shown, true);
});

test('a character with no known floor (no directory name) is hidden while a floor is active', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true);
  os.addAgent(2, 0, 0, undefined, true, 'cccccccccccc');
  onFloor('A');
  os.update(0.1);
  assert.equal(shown(os, 1), false);
  assert.equal(shown(os, 2), false);
  assert.deepEqual(seated(os), []);
});

test('PR runs are on every floor', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, 'prruns');
  for (const which of ['A', 'B'] as const) {
    onFloor(which);
    os.update(0.1);
    assert.equal(shown(os, 1), true, which);
    assert.equal(os.seatZone(ch(os, 1).seatId!), BAY);
  }
});

test('an agent added while another floor is active holds no seat at once, even before a tick', () => {
  const os = build();
  onFloor('A');
  os.update(0.1);
  os.addAgent(1, 0, 0, undefined, true, B);
  assert.equal(ch(os, 1).seatId, null);
  assert.deepEqual(seated(os), []);
  assert.equal(shown(os, 1), false);
  // An on-floor agent added after it still finds a seat in its pod.
  os.addAgent(2, 0, 0, undefined, true, A);
  assert.equal(os.seatZone(ch(os, 2).seatId!), 'Pod 1');
});

test('a switch: the other floor appears on its seats at once, the first one vanishes, and back', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, A);
  os.addAgent(2, 0, 0, undefined, true, B);
  onFloor('A');
  os.update(0.1);
  const first = ch(os, 1).seatId!;
  assert.equal(ch(os, 2).seatId, null);

  onFloor('B');
  os.update(0.1);
  assert.equal(shown(os, 1), false);
  assert.equal(ch(os, 1).seatId, null);
  // Floor 2's lead may take the same pod seat; only the one holder is allowed.
  assert.equal(os.seats.get(first)!.assigned, ch(os, 2).seatId === first);
  assert.equal(shown(os, 2), true);
  const two = ch(os, 2);
  assert.equal(os.seatZone(two.seatId!), 'Pod 1', 'floor 2 numbers its own pods from 1');
  const spot = os.seats.get(two.seatId!)!;
  assert.deepEqual([two.tileCol, two.tileRow], [spot.seatCol, spot.seatRow], 'teleported');
  assert.notEqual(two.state, CharacterState.WALK, 'no walking');
  assert.deepEqual(seated(os), [two.seatId], 'no seat shared');

  onFloor('A');
  os.update(0.1);
  assert.equal(shown(os, 1), true);
  assert.equal(shown(os, 2), false);
  assert.equal(ch(os, 2).seatId, null);
  assert.equal(os.seatZone(ch(os, 1).seatId!), 'Pod 1');
  assert.deepEqual(seated(os), [ch(os, 1).seatId], 'one seat, its own');
});

test('several leads on each floor come back to seats in their pods, none shared', () => {
  const os = build();
  for (const id of [1, 2, 3]) os.addAgent(id, 0, 0, undefined, true, A);
  for (const id of [4, 5, 6]) os.addAgent(id, 0, 0, undefined, true, B);
  onFloor('A');
  os.update(0.1);
  assert.equal(seated(os).length, 3);
  for (let i = 0; i < 3; i++) {
    onFloor('B');
    os.update(0.1);
    assert.deepEqual(
      [4, 5, 6].map((id) => os.seatZone(ch(os, id).seatId!)),
      ['Pod 1', 'Pod 1', 'Pod 1'],
    );
    assert.equal(new Set(seated(os)).size, 3);
    onFloor('A');
    os.update(0.1);
    assert.equal(new Set(seated(os)).size, 3);
    assert.equal(new Set([1, 2, 3].map((id) => ch(os, id).seatId)).size, 3);
    for (const id of [4, 5, 6]) assert.equal(ch(os, id).seatId, null);
  }
});

test('a lead with a pod full of other leads is not seated on a taken seat', () => {
  const os = build();
  // Floor B maps its lead to Pod 1, whose three seats the two floor-B mates and a PR run hold.
  for (const id of [4, 5, 6, 7]) os.addAgent(id, 0, 0, undefined, true, B);
  onFloor('B');
  os.update(0.1);
  assert.equal(new Set(seated(os)).size, seated(os).length);
  for (const id of [4, 5, 6, 7])
    if (ch(os, id).seatId) assert.equal(os.seats.get(ch(os, id).seatId!)!.assigned, true);
});

test('subagents and teammates follow their lead off the floor and back', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, A);
  const sub = os.addSubagent(1, 'tool-1');
  os.addAgent(3, 0, 0, undefined, true, A, 1);
  os.setTeamInfo(3, 'team', 'mate', false, 1, false);
  onFloor('A');
  os.update(0.1);
  assert.equal(shown(os, sub), true);
  assert.equal(shown(os, 3), true);
  assert.equal(seated(os).length, 2, 'the lead and its teammate');

  onFloor('B');
  os.update(0.1);
  assert.equal(shown(os, sub), false, 'the subagent goes with its lead');
  assert.equal(shown(os, 3), false, 'so does the teammate');
  assert.deepEqual(seated(os), []);
  assert.equal(os.getCharacterAt(ch(os, sub).x, ch(os, sub).y - 4), null);

  onFloor('A');
  os.update(0.1);
  assert.equal(shown(os, sub), true);
  assert.equal(shown(os, 3), true);
  assert.equal(seated(os).length, 2);
  assert.equal(new Set(seated(os)).size, 2);
});

test('a hidden character does not move, route or count as occupying a tile', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, B);
  os.addAgent(2, 0, 0, undefined, true, A);
  onFloor('A');
  os.update(0.1);
  const hidden = ch(os, 1);
  const where = [hidden.x, hidden.y];
  hidden.isActive = false;
  for (let i = 0; i < 100; i++) os.update(0.1);
  assert.deepEqual([hidden.x, hidden.y], where, 'frozen');
  assert.equal(os.aero.routes.has(1), false);
  const occupied = (os.aero as unknown as { occupied(except: number): Set<string> }).occupied(
    Number.NaN,
  );
  assert.equal(occupied.has(`${hidden.tileCol},${hidden.tileRow}`), false);
});

test('a hidden character is dropped from the selection, the hover and the camera follow', () => {
  const os = build();
  os.addAgent(1, 0, 0, undefined, true, B);
  os.addAgent(2, 0, 0, undefined, true, A);
  onFloor('B');
  os.update(0.1);
  os.selectedAgentId = 2;
  os.cameraFollowId = 2;
  os.hoveredAgentId = 2;
  os.selectAndFollow(1);
  onFloor('A');
  os.update(0.1);
  assert.equal(os.selectedAgentId, null);
  assert.equal(os.cameraFollowId, null);
  os.selectedAgentId = 2;
  os.update(0.1);
  assert.equal(os.selectedAgentId, 2, 'a shown character keeps the selection');
  os.hoveredAgentId = 1;
  os.update(0.1);
  assert.equal(os.hoveredAgentId, null);
});

test('a configured character of a room on another floor is hidden; the owner agents are on every floor', () => {
  const os = build();
  const agents = [
    { name: 'Mine', slug: 'mine' },
    { name: 'Theirs', slug: 'theirs', room: B },
    { name: 'Ours', slug: 'ours', room: A },
  ];
  // The test layout has no Lounge, so nothing is spawned: the people are made by hand, as the office would.
  agents.forEach((agent, i) => {
    const person = createCharacter(PERSON_ID_BASE - i, 0, null, null, 0);
    person.tileCol = 10 + i;
    person.tileRow = 6;
    os.aero.people.push({
      slug: agent.slug,
      room: 'room' in agent ? (agent.room ?? null) : null,
      name: agent.name,
      ch: person,
      subId: null,
      returning: false,
    });
  });
  const ids = () => os.aero.characters([]).map((c) => c.id);
  const idOf = (slug: string) => os.aero.people.find((p) => p.slug === slug)!.ch.id;
  assert.ok(
    setAeroUpdate({
      ...base(),
      agents,
      pods: { mappings: { [A]: ['Pod 1'] }, labels: {} },
      floor: { id: A, number: 1, name: 'aero', rooms: [A] },
    }),
  );
  os.update(0.1);
  assert.deepEqual(ids().sort(), [idOf('mine'), idOf('ours')].sort());
  const occupied = (os.aero as unknown as { occupied(e: number): Set<string> }).occupied(
    Number.NaN,
  );
  assert.equal(occupied.has('11,6'), false, 'the hidden one holds no tile');
  assert.equal(occupied.has('10,6'), true);
  assert.equal(os.aero.roomOnFloor(B), false);
  assert.equal(os.aero.roomOnFloor(A), true);
  assert.equal(os.aero.roomOnFloor(null), true);
  assert.ok(
    setAeroUpdate({ ...base(), agents, floor: { id: B, number: 2, name: 'web', rooms: [B] } }),
  );
  os.update(0.1);
  assert.deepEqual(ids().sort(), [idOf('mine'), idOf('theirs')].sort());
});

// ── The floor sign ─────────────────────────────────────────────────

class Recorder implements FloorSignContext {
  fillStyle: string | object = '';
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  texts: Array<{ text: string; x: number; y: number }> = [];
  rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, x, y });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h });
  }
  measureText(text: string): { width: number } {
    return { width: text.length * 5 };
  }
}

function open(): OfficeState {
  const os = build();
  os.layout.cols = 54;
  os.layout.rows = 36;
  return os;
}

test('the floor sign reads "<n>F · <name>" and sits on the lift wall', () => {
  const os = open();
  assert.ok(
    setAeroUpdate({
      ...base(),
      floor: { id: A, number: 2, name: 'web', rooms: [A] },
    }),
  );
  const ctx = new Recorder();
  drawFloorSign(ctx, os, 0, 0, 2);
  assert.equal(ctx.texts.length, 1);
  assert.equal(ctx.texts[0].text, '2F · web');
  const r = floorSignRect();
  assert.ok(r.x + r.w <= 54 * 16 && r.y + r.h <= 36 * 16, 'inside the 54 by 36 floor');
  assert.ok(ctx.rects.length >= 1);
  // The two lift doors are at tiles 25 and 27, bottom row 34: the sign centres between them.
  assert.equal(r.x + r.w / 2, 27 * 16);
  // A long name is cut, a hostile one is only ever text.
  assert.ok(
    setAeroUpdate({ ...base(), floor: { id: A, number: 12, name: 'x'.repeat(32), rooms: [] } }),
  );
  const long = new Recorder();
  drawFloorSign(long, os, 0, 0, 2);
  assert.ok(Array.from(long.texts[0].text).length <= 24, long.texts[0].text);
  assert.ok(long.texts[0].text.startsWith('12F · x'));
});

test('no floor, no sign; and a layout other than the open office gets none', () => {
  const os = open();
  assert.ok(setAeroUpdate(base()));
  const none = new Recorder();
  drawFloorSign(none, os, 0, 0, 2);
  assert.deepEqual(none.texts, []);
  assert.ok(setAeroUpdate({ ...base(), floor: { id: A, number: 1, name: 'aero', rooms: [] } }));
  const small = build();
  const rooms = new Recorder();
  drawFloorSign(rooms, small, 0, 0, 2);
  assert.deepEqual(rooms.texts, []);
});
