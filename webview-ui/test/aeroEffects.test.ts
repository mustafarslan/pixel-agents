/**
 * Aero's effects (pixelfx, vendored in src/aero/fx): when they start, how many run, that none run with reduced motion, and
 * that the three the office uses really draw and end.
 */

import assert from 'node:assert/strict';

import { afterEach, test } from 'vitest';

import { Effects, FX_SPECS, type FxKind, type MakeFx, MAX_ACTIVE_FX } from '../src/aero/effects.js';
import { clearFrame, createFrame } from '../src/aero/fx/core/index.js';
import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { AREA_LABEL_FALLBACK_COLOR } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout, PlacedFurniture, Seat } from '../src/office/types.js';
import { Direction, MATRIX_EFFECT_DURATION, TileType } from '../src/office/types.js';

afterEach(() => resetAeroUpdate());

interface Made {
  options: Record<string, unknown>;
  t: number;
}

/** An effects holder whose effects are stand-ins that last two seconds. */
function fake(reduced = false): { fx: Effects; made: Made[] } {
  const made: Made[] = [];
  const make: MakeFx = (_mod, options) => {
    const item: Made = { options, t: 0 };
    made.push(item);
    return {
      update: (dt: number) => {
        item.t += dt;
      },
      draw: () => {},
      done: () => item.t >= 2,
    };
  };
  return { fx: new Effects(make, () => reduced), made };
}

test('at most four effects run at once; a finished one makes room', () => {
  const { fx } = fake();
  for (let i = 0; i < MAX_ACTIVE_FX; i++) assert.equal(fx.start('poof', 0, 0, i), true);
  assert.equal(fx.start('burst', 0, 0, 9), false);
  assert.equal(fx.active.length, MAX_ACTIVE_FX);
  fx.update(2.1);
  assert.equal(fx.active.length, 0);
  assert.equal(fx.start('burst', 0, 0, 9), true);
});

test('with reduced motion nothing starts and nothing is counted', () => {
  const { fx, made } = fake(true);
  for (const kind of ['burst', 'countdown', 'poof'] as FxKind[]) {
    assert.equal(fx.start(kind, 1, 1, 1), false);
  }
  assert.equal(fx.active.length, 0);
  assert.deepEqual(fx.started, {});
  assert.equal(made.length, 0);
});

test('the seed reaches the effect, with the origin the effect is drawn from', () => {
  const { fx, made } = fake();
  fx.start('burst', 10, 20, 1234);
  assert.equal(made[0].options.seed, 1234);
  assert.deepEqual([made[0].options.x, made[0].options.y], FX_SPECS.burst.mod.meta.origin);
});

test('the three vendored effects draw pixels and end within their time', () => {
  for (const kind of ['burst', 'countdown', 'poof'] as FxKind[]) {
    const fx = new Effects(undefined, () => false);
    assert.equal(fx.start(kind, 0, 0, 7), true, kind);
    const item = fx.active[0];
    const [w, h] = FX_SPECS[kind].mod.meta.size;
    assert.deepEqual([item.frame.w, item.frame.h], [w, h]);
    let lit = 0;
    for (let t = 0; t < 4 && fx.active.length > 0; t += 1 / 30) {
      fx.update(1 / 30);
      if (fx.active.length === 0) break;
      clearFrame(item.frame);
      item.fx.draw(item.frame);
      lit += item.frame.color.reduce((n: number, c: number) => n + (c >>> 24 > 0 ? 1 : 0), 0);
    }
    assert.ok(lit > 50, `${kind} drew ${lit} pixels`);
    assert.equal(fx.active.length, 0, `${kind} ended`);
  }
  assert.ok(createFrame(2, 2).color.length === 4);
});

// ── The triggers, on a real office ─────────────────────────────────

const COLS = 14;
const ROWS = 9;
const DESK = 'desk-seat';
const LOUNGE_SEAT = 'aero-0a1b2c3d-lounge-2';

function seat(uid: string, col: number, row: number): Seat {
  return { uid, seatCol: col, seatRow: row, facingDir: Direction.DOWN, assigned: false };
}

function build(withLounge = true): OfficeState {
  const furniture: PlacedFurniture[] = withLounge
    ? [
        { uid: 'aero-0a1b2c3d-lounge-0', type: 'WHITEBOARD', col: 6, row: 0 },
        { uid: 'aero-0a1b2c3d-lounge-1', type: 'CLOCK', col: 8, row: 0 },
        { uid: LOUNGE_SEAT, type: 'SOFA_FRONT', col: 7, row: 2 },
        { uid: 'aero-0a1b2c3d-lounge-3', type: 'COFFEE_TABLE', col: 8, row: 4 },
      ]
    : [{ uid: 'main-1', type: 'COFFEE_TABLE', col: 8, row: 4 }];
  const areaTiles: Array<string | null> = new Array(COLS * ROWS).fill(null);
  for (let r = 2; r <= 6; r++) for (let c = 6; c <= 11; c++) areaTiles[r * COLS + c] = 'Lounge';
  const tiles = new Array<TileType>(COLS * ROWS).fill(TileType.FLOOR_1);
  for (let c = 5; c < COLS; c++) for (const r of [0, 1]) tiles[r * COLS + c] = TileType.WALL;
  const layout: OfficeLayout = {
    version: 1,
    cols: COLS,
    rows: ROWS,
    tiles,
    furniture,
    areas: [{ label: 'Lounge', color: AREA_LABEL_FALLBACK_COLOR }],
    areaTiles,
    pets: [],
  };
  const os = new OfficeState(layout);
  os.seats = new Map([
    [DESK, seat(DESK, 2, 2)],
    [LOUNGE_SEAT, seat(LOUNGE_SEAT, 7, 2)],
  ]);
  os.blockedTiles = new Set(['7,2', '8,4', '2,2']);
  os.walkableTiles = os.walkableTiles.filter((t) => !os.blockedTiles.has(`${t.col},${t.row}`));
  return os;
}

function update(over: Record<string, unknown> = {}) {
  return { lunch: false, meeting: null, inbox: 0, agents: [], lounge: true, ...over };
}

const meeting = (title: string, soon: boolean) => ({ time: '10:30', title, soon });

function run(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.1) os.update(0.1);
}

function withFake(os: OfficeState): { kinds: () => string[]; made: Made[] } {
  const f = fake();
  os.aero.fx = f.fx;
  return { kinds: () => f.fx.active.map((a) => a.kind), made: f.made };
}

test('a burst on the whiteboard when the inbox rises, and only then', () => {
  const os = build();
  const seen = withFake(os);
  setAeroUpdate(update({ inbox: 3 }));
  run(os, 0.2);
  assert.deepEqual(seen.kinds(), [], 'the first update is no rise');
  setAeroUpdate(update({ inbox: 3 }));
  run(os, 0.2);
  setAeroUpdate(update({ inbox: 1 }));
  run(os, 0.2);
  assert.deepEqual(seen.kinds(), [], 'same or fewer');
  setAeroUpdate(update({ inbox: 4 }));
  run(os, 0.2);
  assert.deepEqual(seen.kinds(), ['burst']);
  // On the whiteboard: its middle (tile 6,0 is 16 px square), the burst's origin a little below.
  assert.deepEqual([os.aero.fx.active[0].x, os.aero.fx.active[0].y], [6 * 16 + 8, 8 + 15]);
  assert.equal(os.aero.snapshot().fxStarted.burst, 1);
});

test('a countdown on the clock when the meeting is near, once per meeting', () => {
  const os = build();
  const seen = withFake(os);
  setAeroUpdate(update({ meeting: meeting('Review', false) }));
  run(os, 0.2);
  assert.deepEqual(seen.kinds(), []);
  setAeroUpdate(update({ meeting: meeting('Review', true) }));
  run(os, 0.2);
  assert.deepEqual(seen.kinds(), ['countdown']);
  // The next minute's push of the same meeting is no second countdown.
  run(os, 2.5);
  setAeroUpdate(update({ meeting: meeting('Review', true), inbox: 0 }));
  run(os, 0.2);
  assert.equal(os.aero.snapshot().fxStarted.countdown, 1);
  // Another meeting has its own.
  setAeroUpdate(update({ meeting: meeting('Planning', true) }));
  run(os, 0.2);
  assert.equal(os.aero.snapshot().fxStarted.countdown, 2);
});

test('a poof where a configured person leaves for a lead, and where it gets back', () => {
  const os = build();
  os.addAgent(1, 0, 0, DESK, true);
  const seen = withFake(os);
  setAeroUpdate(update({ agents: [{ name: 'Reviewer', slug: 'reviewer' }] }));
  run(os, MATRIX_EFFECT_DURATION + 0.5);
  assert.deepEqual(seen.kinds(), []);
  os.addSubagent(1, 'tool-1');
  assert.equal(os.aero.subagentStarted(1, 'tool-1', 'Subtask: reviewer'), true);
  assert.deepEqual(seen.kinds(), ['poof']);
  assert.equal(os.aero.snapshot().fxStarted.poof, 1);
  // It is still away: no second poof.
  run(os, 2.5);
  assert.equal(os.aero.snapshot().fxStarted.poof, 1);
  os.removeSubagent(1, 'tool-1');
  for (let i = 0; i < 900 && (os.aero.snapshot().fxStarted.poof ?? 0) < 2; i++) os.update(0.1);
  assert.equal(os.aero.snapshot().fxStarted.poof, 2, 'a poof at the return');
  assert.equal(os.aero.snapshot().people[0].away, false);
});

test('no effect without an Aero Lounge, and the office rng seeds them', () => {
  const none = build(false);
  const seen = withFake(none);
  setAeroUpdate(update({ inbox: 1 }));
  run(none, 0.2);
  setAeroUpdate(update({ inbox: 5, meeting: meeting('x', true) }));
  run(none, 0.2);
  assert.deepEqual(seen.kinds(), []);

  const os = build();
  const again = withFake(os);
  os.aero.rng = () => 0.5;
  setAeroUpdate(update());
  run(os, 0.2);
  setAeroUpdate(update({ inbox: 2 }));
  run(os, 0.2);
  assert.equal(again.made[0].options.seed, Math.floor(0.5 * 0x7fffffff));
});

test('reduced motion: the triggers fire nothing', () => {
  const os = build();
  const f = fake(true);
  os.aero.fx = f.fx;
  setAeroUpdate(update());
  run(os, 0.2);
  setAeroUpdate(update({ inbox: 9, meeting: meeting('x', true) }));
  run(os, 0.2);
  assert.equal(f.fx.active.length, 0);
  assert.deepEqual(f.fx.started, {});
});
