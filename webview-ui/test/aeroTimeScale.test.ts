/**
 * The self-test time scale (docs/work/phase6-timescale/plan.md, the fork): an update's `timeScale` makes each frame run that many
 * normal-`dt` sub-steps, never one scaled `dt`, so a walk can't overshoot and every schedule keeps counting on the one clock
 * (`AeroOffice.clock`, `+= dt`). Without it a frame is one step.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, test, vi } from 'vitest';

import { resetAeroUpdate, setAeroUpdate } from '../src/aero/office.js';
import { OfficeState } from '../src/office/engine/officeState.js';

afterEach(() => {
  resetAeroUpdate();
});

const DT = 0.05;
const base = {
  lunch: false,
  meeting: null,
  inbox: 0,
  agents: [],
  lounge: false,
};

function send(timeScale?: number | null): void {
  assert.ok(setAeroUpdate(timeScale === undefined ? base : { ...base, timeScale }));
}

test('a frame is one step without a timeScale, and timeScale steps with one', () => {
  for (const [scale, steps] of [
    [undefined, 1],
    [null, 1],
    [1, 1],
    [2, 2],
    [8, 8],
  ] as const) {
    const os = new OfficeState();
    send(scale);
    const before = os.aero.snapshot().clock;
    for (let i = 0; i < 10; i++) os.update(DT);
    const elapsed = os.aero.snapshot().clock - before;
    assert.ok(Math.abs(elapsed - 10 * steps * DT) < 1e-9, `scale ${scale}: ${elapsed}`);
  }
});

test('no update at all is one step a frame', () => {
  const os = new OfficeState();
  for (let i = 0; i < 4; i++) os.update(DT);
  assert.ok(Math.abs(os.aero.snapshot().clock - 4 * DT) < 1e-9);
});

test('a scaled frame is N normal-dt steps: a walker stands where N plain frames leave it, with no overshoot', () => {
  const walk = (scale: number, frames: number): { x: number; y: number; state: string } => {
    let seed = 12345;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    });
    try {
      const os = new OfficeState();
      send(1);
      os.addAgent(1);
      const ch = os.characters.get(1)!;
      // Past the spawn effect, then a walk across the floor to its far corner.
      for (let i = 0; i < 20; i++) os.update(DT);
      const far = os.walkableTiles[os.walkableTiles.length - 1];
      assert.ok(os.walkToTile(1, far.col, far.row), 'a path to the far tile');
      send(scale);
      let longest = 0;
      let px = ch.x;
      let py = ch.y;
      let moved = 0;
      for (let i = 0; i < frames; i++) {
        os.update(DT);
        longest = Math.max(longest, Math.hypot(ch.x - px, ch.y - py));
        moved += Math.hypot(ch.x - px, ch.y - py);
        px = ch.x;
        py = ch.y;
      }
      // A walk steps at most speed * dt a sub-step, so a frame of `scale` sub-steps moves at most `scale` of them.
      assert.ok(longest <= scale * 48 * DT + 1e-6, `moved ${longest} in one frame at ${scale}x`);
      assert.ok(moved > 0, 'it walked');
      return { x: ch.x, y: ch.y, state: String(ch.state) };
    } finally {
      random.mockRestore();
    }
  };
  // 40 frames at 8x is 320 steps: the same time as 320 plain frames, and the same place.
  const fast = walk(8, 40);
  const plain = walk(1, 320);
  assert.deepEqual(fast, plain);
});

test('the page has one clock: no schedule in src/aero reads the wall clock', () => {
  const dir = join(import.meta.dirname, '..', 'src', 'aero');
  const bad: string[] = [];
  const walkDir = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walkDir(p);
      else if (/\.tsx?$/.test(e.name)) {
        const text = readFileSync(p, 'utf8');
        if (/Date\.now\(|performance\.now\(|setTimeout\(|setInterval\(/.test(text)) bad.push(p);
      }
    }
  };
  walkDir(dir);
  assert.deepEqual(bad, []);
});
