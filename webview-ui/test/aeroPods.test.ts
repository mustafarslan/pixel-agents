/**
 * Aero's live pods: the update's `pods` shape and every rejection, the page using the mappings (and the server's not
 * overwriting them), a lead walking to a newly mapped pod, the dim and named pod labels, and the three seat rules (the lead
 * bench, teammates inside the lead's zone, a seat outside the mapped area dropped only when the area has a free seat).
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { resetAeroUpdate, serverMappingsAllowed, setAeroUpdate } from '../src/aero/office.js';
import { drawPods, type PodContext } from '../src/aero/pods.js';
import { MAX_POD_LABELS, MAX_POD_MAPPINGS, parseAeroUpdate } from '../src/aero/update.js';
import { AERO_POD_DIM_ALPHA, AERO_POD_DIM_LABEL_ALPHA } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, Seat } from '../src/office/types.js';
import { CharacterState, Direction, TileType } from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

// ── The update shape ───────────────────────────────────────────────

const pods = () => ({
  mappings: { 'feat-auth': ['Pod 1'], 'fix-bug': ['Pod 2'], other: ['Hot desks', 'Pod 3'] },
  labels: {
    'Pod 1': { name: 'feat-auth', dim: false },
    'Pod 2': { name: 'fix-bug', dim: true },
    'Pod 3': { name: '', dim: true },
  },
});
const base = () => ({ lunch: false, meeting: null, inbox: 0, agents: [], lounge: true });
const withPods = (p: unknown) => ({ ...base(), pods: p });

test('an update with pods is accepted as it is; without pods, or with null, none is kept', () => {
  assert.deepEqual(parseAeroUpdate(withPods(pods())), { ...base(), pods: pods() });
  assert.deepEqual(parseAeroUpdate(withPods({ mappings: {}, labels: {} })), {
    ...base(),
    pods: { mappings: {}, labels: {} },
  });
  assert.deepEqual(parseAeroUpdate(base()), base());
  assert.equal('pods' in parseAeroUpdate(base())!, false);
  assert.deepEqual(parseAeroUpdate(withPods(null)), base());
});

test('pods that are not exactly the shape reject the whole update', () => {
  const bad: unknown[] = [
    'x',
    [],
    {},
    { mappings: {} },
    { labels: {} },
    { ...pods(), extra: 1 },
    { ...pods(), mappings: [] },
    { ...pods(), labels: 'x' },
  ];
  for (const b of bad) assert.equal(parseAeroUpdate(withPods(b)), null, JSON.stringify(b));
});

test('mappings: 1..4 distinct clean area labels per directory, capped keys', () => {
  const m = (mappings: unknown) => withPods({ ...pods(), mappings });
  assert.notEqual(parseAeroUpdate(m({ a: ['Pod 1', 'Pod 2', 'Pod 3', 'Pod 4'] })), null);
  for (const bad of [
    { a: [] },
    { a: ['1', '2', '3', '4', '5'] },
    { a: ['Pod 1', 'Pod 1'] },
    { a: 'Pod 1' },
    { a: [1] },
    { a: [''] },
    { a: ['  '] },
    { a: ['x'.repeat(41)] },
    { a: ['Pod\n1'] },
    { a: ['Pod ‮1'] },
    { '': ['Pod 1'] },
    { ['x'.repeat(41)]: ['Pod 1'] },
    { 'a\u0000b': ['Pod 1'] },
  ]) {
    assert.equal(parseAeroUpdate(m(bad)), null, JSON.stringify(bad));
  }
  assert.notEqual(parseAeroUpdate(m({ a: ['x'.repeat(40)] })), null);
  const many = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`d${i}`, ['Pod 1']]));
  assert.notEqual(parseAeroUpdate(m(many(MAX_POD_MAPPINGS))), null);
  assert.equal(parseAeroUpdate(m(many(MAX_POD_MAPPINGS + 1))), null);
  // A prototype key is never accepted.
  const proto = JSON.parse('{"__proto__": ["Pod 1"]}') as unknown;
  assert.equal(parseAeroUpdate(m(proto)), null);
});

test('labels: a clean name of 0..40 characters and a boolean dim, nothing else, capped keys', () => {
  const l = (labels: unknown) => withPods({ ...pods(), labels });
  assert.notEqual(parseAeroUpdate(l({ 'Pod 1': { name: 'x'.repeat(40), dim: false } })), null);
  assert.notEqual(parseAeroUpdate(l({ 'Pod 1': { name: '😀'.repeat(40), dim: true } })), null);
  for (const bad of [
    { 'Pod 1': { name: 'x'.repeat(41), dim: false } },
    { 'Pod 1': { name: 'a\nb', dim: false } },
    { 'Pod 1': { name: 'a‮b', dim: false } },
    { 'Pod 1': { name: 3, dim: false } },
    { 'Pod 1': { name: 'a', dim: 1 } },
    { 'Pod 1': { name: 'a' } },
    { 'Pod 1': { dim: false } },
    { 'Pod 1': { name: 'a', dim: false, extra: 1 } },
    { 'Pod 1': 'a' },
    { 'Pod 1': null },
    { '': { name: 'a', dim: false } },
    { ['x'.repeat(41)]: { name: 'a', dim: false } },
  ]) {
    assert.equal(parseAeroUpdate(l(bad)), null, JSON.stringify(bad));
  }
  const many = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`Pod ${i}`, { name: 'a', dim: false }]),
    );
  assert.notEqual(parseAeroUpdate(l(many(MAX_POD_LABELS))), null);
  assert.equal(parseAeroUpdate(l(many(MAX_POD_LABELS + 1))), null);
  assert.equal(
    parseAeroUpdate(l(JSON.parse('{"__proto__": {"name": "a", "dim": false}}') as unknown)),
    null,
  );
});

// ── The office ─────────────────────────────────────────────────────

const COLS = 16;
const ROWS = 8;
/** Pod 1: columns 1..4, Pod 2: columns 7..10, rows 2..5; the rest unzoned. */
const POD1 = ['p1-bench', 'p1-wood-a', 'p1-wood-b'];

function seat(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: false };
}

function build(): OfficeState {
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 5; r++) {
    for (let c = 1; c <= 4; c++) areaTiles[r * COLS + c] = 'Pod 1';
    for (let c = 7; c <= 10; c++) areaTiles[r * COLS + c] = 'Pod 2';
  }
  const seatDefs: Array<[string, number, number, string]> = [
    ['p1-bench', 1, 3, 'CUSHIONED_BENCH'],
    ['p1-wood-a', 2, 3, 'WOODEN_BENCH'],
    ['p1-wood-b', 3, 3, 'WOODEN_BENCH'],
    ['p2-bench', 7, 3, 'CUSHIONED_BENCH'],
    ['p2-wood-a', 8, 3, 'WOODEN_BENCH'],
    ['free-chair', 13, 3, 'WOODEN_BENCH'],
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
    ],
    areaTiles,
    pets: [],
  };
  const os = new OfficeState(layout);
  os.seats = new Map(seatDefs.map(([uid, col, row]) => [uid, seat(uid, col, row)]));
  // The PCs: every pod seat faces one (the catalog is not loaded in a unit test).
  (os as unknown as { buildElectronicsTileSet(): Set<string> }).buildElectronicsTileSet = () =>
    new Set(['1,4', '2,4', '3,4', '7,4', '8,4']);
  return os;
}

const zone = (os: OfficeState, id: number) => os.seatZone(os.characters.get(id)!.seatId!);

function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.1) os.update(0.1);
}

test('an accepted update with pods sets the mappings on the next tick; one without leaves them', () => {
  const os = build();
  os.setAreaMappings({ stock: ['Pod 2'] });
  assert.equal(serverMappingsAllowed(), true);
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  os.update(0.1);
  assert.deepEqual(os.areaMappings, pods().mappings);
  assert.equal(serverMappingsAllowed(), false, "the server's mappings may not overwrite them");
  // An update with no pods does not clear them, and the page keeps the last accepted pods until it is replaced.
  assert.ok(setAeroUpdate(base()));
  assert.equal(serverMappingsAllowed(), true);
  os.update(0.1);
  assert.deepEqual(os.areaMappings, pods().mappings);
  // A rejected update changes nothing.
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  assert.equal(setAeroUpdate({ ...base(), pods: { mappings: 1, labels: {} } }), false);
  assert.equal(serverMappingsAllowed(), false);
});

test('new mappings reseat a lead live: it walks into its pod without a reload', () => {
  const os = build();
  os.addAgent(1, 0, 0, 'p2-wood-a', true, 'feat-auth');
  assert.equal(zone(os, 1), 'Pod 2');
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  os.update(0.1);
  const ch = os.characters.get(1)!;
  assert.equal(zone(os, 1), 'Pod 1');
  assert.equal(os.seats.get('p2-wood-a')!.assigned, false, 'the old seat is free');
  assert.equal(os.seats.get(ch.seatId!)!.assigned, true);
  assert.equal(ch.state, CharacterState.WALK);
  // The bench, being the lead's seat in its pod.
  assert.equal(ch.seatId, 'p1-bench');
  run(os, 20);
  assert.equal(`${ch.tileCol},${ch.tileRow}`, '1,3');
  // The same mappings again move nothing.
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  run(os, 1);
  assert.equal(ch.seatId, 'p1-bench');
});

test('a lead whose pod has no free seat stays where it is, however often the mappings arrive', () => {
  const os = build();
  for (const [i, uid] of POD1.entries()) os.addAgent(10 + i, 0, 0, uid, true, 'someone');
  os.addAgent(1, 0, 0, 'p2-wood-a', true, 'feat-auth');
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  os.update(0.1);
  assert.equal(os.characters.get(1)!.seatId, 'p2-wood-a');
  for (let i = 0; i < 3; i++) {
    assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
    os.update(0.1);
  }
  assert.equal(os.characters.get(1)!.seatId, 'p2-wood-a');
  assert.equal(os.seats.get('p2-wood-a')!.assigned, true);
});

// ── The seat rules ─────────────────────────────────────────────────

test('seat rule 1: a lead takes its pod bench among the PC seats, every time', () => {
  for (let i = 0; i < 20; i++) {
    const os = build();
    os.setAreaMappings({ lead: ['Pod 1'] });
    os.addAgent(1, 0, 0, undefined, true, 'lead');
    assert.equal(os.characters.get(1)!.seatId, 'p1-bench');
  }
});

test('seat rule 1: with the bench taken, the next lead of that pod takes a PC bench, not another pod', () => {
  const os = build();
  os.setAreaMappings({ a: ['Pod 1'], b: ['Pod 1'] });
  os.addAgent(1, 0, 0, undefined, true, 'a');
  os.addAgent(2, 0, 0, undefined, true, 'b');
  assert.equal(os.characters.get(1)!.seatId, 'p1-bench');
  assert.ok(POD1.includes(os.characters.get(2)!.seatId!));
  assert.notEqual(os.characters.get(2)!.seatId, 'p1-bench');
});

test("seat rule 2: a teammate sits in its lead's zone while it has a free seat, else as before", () => {
  const os = build();
  os.addAgent(1, 0, 0, 'p1-wood-b', true);
  os.addAgent(2, 0, 0, undefined, true, undefined, 1);
  assert.equal(zone(os, 2), 'Pod 1');
  os.addAgent(3, 0, 0, undefined, true, undefined, 1);
  assert.equal(zone(os, 3), 'Pod 1');
  // Pod 1 is full: the old behaviour, the closest free seat anywhere (Pod 2's bench, 4 columns away).
  os.addAgent(4, 0, 0, undefined, true, undefined, 1);
  assert.equal(os.characters.get(4)!.seatId, 'p2-bench');
});

test('seat rule 2: the limit to the zone beats a nearer seat of another zone', () => {
  const os = build();
  // The lead sits at the east end of Pod 1; a free seat of Pod 2 is nearer than Pod 1's far bench.
  os.seats.set('p1-far', seat('p1-far', 1, 5));
  os.layout.areaTiles![5 * COLS + 1] = 'Pod 1';
  os.seats.set('p2-near', seat('p2-near', 5, 3));
  os.layout.areaTiles![3 * COLS + 5] = 'Pod 2';
  for (const uid of ['p1-bench', 'p1-wood-a']) os.seats.get(uid)!.assigned = true;
  os.addAgent(1, 0, 0, 'p1-wood-b', true);
  os.addAgent(2, 0, 0, undefined, true, undefined, 1);
  assert.equal(os.characters.get(2)!.seatId, 'p1-far');
  assert.equal(zone(os, 2), 'Pod 1');
});

test('seat rule 2: a linked teammate in another zone moves into its lead zone, even at an equal distance', () => {
  const os = build();
  // The lead at (3,3), Pod 1's bench free at (1,3), two columns away; the teammate at (5,3) in Pod 2, also two away.
  os.seats.set('p2-near', seat('p2-near', 5, 3));
  os.layout.areaTiles![3 * COLS + 5] = 'Pod 2';
  os.addAgent(1, 0, 0, 'p1-wood-b', true);
  os.addAgent(3, 0, 0, 'p1-wood-a', true);
  os.addAgent(2, 0, 0, 'p2-near', true);
  (os as unknown as { reseatNextToLead(t: number, l: number): void }).reseatNextToLead(2, 1);
  assert.equal(os.characters.get(2)!.seatId, 'p1-bench');
  assert.equal(os.seats.get('p2-near')!.assigned, false);
});

test('seat rule 3: a restored seat outside the mapped area is dropped only when the area has a free seat', () => {
  const os = build();
  os.setAreaMappings({ feat: ['Pod 1'] });
  os.addAgent(1, 0, 0, 'p2-wood-a', true, 'feat');
  assert.equal(zone(os, 1), 'Pod 1', 'dropped, and seated in its area');
  assert.equal(os.characters.get(1)!.seatId, 'p1-bench');

  // Pod 1 full: the restored seat is kept.
  const full = build();
  full.setAreaMappings({ feat: ['Pod 1'] });
  for (const [i, uid] of POD1.entries()) full.addAgent(10 + i, 0, 0, uid, true);
  full.addAgent(1, 0, 0, 'p2-wood-a', true, 'feat');
  assert.equal(full.characters.get(1)!.seatId, 'p2-wood-a');

  // A seat inside the area, or no mapping at all, is kept.
  const kept = build();
  kept.setAreaMappings({ feat: ['Pod 1'] });
  kept.addAgent(1, 0, 0, 'p1-wood-b', true, 'feat');
  kept.addAgent(2, 0, 0, 'p2-wood-a', true, 'unmapped');
  assert.equal(kept.characters.get(1)!.seatId, 'p1-wood-b');
  assert.equal(kept.characters.get(2)!.seatId, 'p2-wood-a');
});

test('seat rule 3: a kept seat outside the mapped area is dropped on a layout rebuild, only with a free seat inside', () => {
  const sprite = Array.from({ length: 16 }, () => new Array<string>(16).fill('#808080'));
  assert.ok(
    buildDynamicCatalog({
      catalog: [
        {
          id: 'CHAIR',
          label: 'Chair',
          category: 'chairs',
          width: 16,
          height: 16,
          footprintW: 1,
          footprintH: 1,
          isDesk: false,
          canPlaceOnWalls: false,
          orientation: 'front',
        },
      ],
      sprites: { CHAIR: sprite },
    }),
  );
  const makeLayout = (uids: string[]): OfficeLayout => {
    const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
    // Chairs 0 and 1 in Pod 1 (columns 1, 2), chair 2 in Pod 2 (column 7).
    const cols = [1, 2, 7];
    cols.forEach((c, i) => {
      areaTiles[3 * COLS + c] = i < 2 ? 'Pod 1' : 'Pod 2';
    });
    return {
      version: 1,
      cols: COLS,
      rows: ROWS,
      tiles: new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1),
      furniture: uids.map((uid, i) => ({ uid, type: 'CHAIR', col: cols[i]!, row: 3 })),
      areas: [
        { label: 'Pod 1', color: '#ff8800' },
        { label: 'Pod 2', color: '#0088ff' },
      ],
      areaTiles,
      pets: [],
    };
  };
  const uids = ['c0', 'c1', 'c2'];
  const os = new OfficeState(makeLayout(uids));
  assert.equal(os.seats.size, 3);
  os.setAreaMappings({ feat: ['Pod 1'] });
  os.addAgent(1, 0, 0, 'c2', true, 'feat');
  // Restored seat c2 is in Pod 2, outside the mapped Pod 1 which has free seats: dropped at addAgent already.
  assert.equal(zone(os, 1), 'Pod 1');
  // Put it back out of the area to exercise the rebuild.
  os.reassignSeat(1, 'c2');
  assert.equal(zone(os, 1), 'Pod 2');
  os.rebuildFromLayout(makeLayout(uids));
  assert.equal(zone(os, 1), 'Pod 1', 'dropped and seated again inside the area');
  // With Pod 1 full the kept seat stays.
  const full = new OfficeState(makeLayout(uids));
  full.setAreaMappings({ feat: ['Pod 1'] });
  full.addAgent(10, 0, 0, 'c0', true);
  full.addAgent(11, 0, 0, 'c1', true);
  full.addAgent(1, 0, 0, 'c2', true, 'feat');
  full.rebuildFromLayout(makeLayout(uids));
  assert.equal(full.characters.get(1)!.seatId, 'c2');
});

// ── The labels ─────────────────────────────────────────────────────

interface Call {
  op: 'text' | 'rect';
  text?: string;
  alpha: number;
  fill: string;
}

function recorder() {
  const calls: Call[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText(text: string) {
      calls.push({ op: 'text', text, alpha: ctx.globalAlpha, fill: String(ctx.fillStyle) });
    },
    fillRect() {
      calls.push({ op: 'rect', alpha: ctx.globalAlpha, fill: String(ctx.fillStyle) });
    },
    save() {},
    restore() {},
  };
  return { ctx: ctx as unknown as PodContext, calls };
}

test('a pod is drawn with its worktree name; a dim pod gets a wash and a fainter name; an empty pod has no text', () => {
  const os = build();
  assert.ok(
    setAeroUpdate({
      ...base(),
      pods: {
        mappings: {},
        labels: {
          'Pod 1': { name: 'feat-auth', dim: false },
          'Pod 2': { name: 'fix-bug', dim: true },
        },
      },
    }),
  );
  const a = recorder();
  drawPods(a.ctx, os, 0, 0, 2);
  const texts = a.calls.filter((c) => c.op === 'text');
  const rects = a.calls.filter((c) => c.op === 'rect');
  // Pod 2 has 16 tiles (4x4... columns 7..10, rows 2..5), all washed; Pod 1 none.
  assert.equal(rects.length, 16);
  assert.ok(rects.every((r) => r.alpha === AERO_POD_DIM_ALPHA));
  // Name and shadow each.
  assert.deepEqual(
    texts.map((t) => t.text),
    ['feat-auth', 'feat-auth', 'fix-bug', 'fix-bug'],
  );
  const main = (name: string) => texts.filter((t) => t.text === name).at(-1)!;
  assert.equal(main('feat-auth').alpha, 1);
  assert.equal(main('fix-bug').alpha, AERO_POD_DIM_LABEL_ALPHA);
  assert.equal(main('feat-auth').fill, '#ff8800', "the area's own colour");

  // A pod with no worktree: dimmed and no text.
  assert.ok(
    setAeroUpdate({
      ...base(),
      pods: { mappings: {}, labels: { 'Pod 1': { name: '', dim: true } } },
    }),
  );
  const b = recorder();
  drawPods(b.ctx, os, 0, 0, 2);
  assert.equal(b.calls.filter((c) => c.op === 'text').length, 0);
  assert.equal(b.calls.filter((c) => c.op === 'rect').length, 16);

  // No pods in the update, or labels the layout lacks: nothing is drawn.
  assert.ok(setAeroUpdate(base()));
  const c = recorder();
  drawPods(c.ctx, os, 0, 0, 2);
  assert.equal(c.calls.length, 0);
  assert.ok(
    setAeroUpdate({
      ...base(),
      pods: { mappings: {}, labels: { Nowhere: { name: 'x', dim: false } } },
    }),
  );
  drawPods(c.ctx, os, 0, 0, 2);
  assert.equal(c.calls.length, 0);
});

test('the labels the pods draw are known to the renderer, which leaves them out of its own', () => {
  const os = build();
  assert.deepEqual(os.aero.podLabelKeys(), undefined);
  assert.ok(setAeroUpdate({ ...base(), pods: pods() }));
  assert.deepEqual([...os.aero.podLabelKeys()!].sort(), ['Pod 1', 'Pod 2', 'Pod 3']);
  assert.ok(setAeroUpdate(base()));
  assert.deepEqual(os.aero.podLabelKeys(), undefined);
});
