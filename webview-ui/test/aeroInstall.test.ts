/**
 * The page's bridge with Aero: `window.aeroOffice.update` accepts a valid update and refuses the rest, and a wall click
 * posts only `openInbox` or `openCalendar`, and only when Aero's `webkit.messageHandlers.aero` exists.
 */

import assert from 'node:assert/strict';

import { afterEach, beforeEach, test } from 'vitest';

import { handleWallTap, installAeroOffice, postToAero } from '../src/aero/install.js';
import { getAeroUpdate, resetAeroUpdate } from '../src/aero/office.js';

const g = globalThis as unknown as { window?: Record<string, unknown> };

beforeEach(() => {
  g.window = {};
  resetAeroUpdate();
});
afterEach(() => {
  delete g.window;
  resetAeroUpdate();
});

const valid = { lunch: true, meeting: null, inbox: 2, agents: [], lounge: true };

test('window.aeroOffice.update keeps a valid update and refuses an invalid one, keeping the last', () => {
  installAeroOffice();
  const api = g.window!.aeroOffice as { update: (d: unknown) => boolean };
  assert.equal(api.update(valid), true);
  assert.equal(getAeroUpdate()?.inbox, 2);
  assert.equal(api.update({ ...valid, inbox: 'x' }), false);
  assert.equal(api.update('<script>'), false);
  assert.equal(getAeroUpdate()?.inbox, 2);
});

test('the API cannot be replaced, and installing twice is harmless', () => {
  installAeroOffice();
  const first = g.window!.aeroOffice;
  installAeroOffice();
  assert.equal(g.window!.aeroOffice, first);
  assert.throws(() => {
    'use strict';
    (g.window as { aeroOffice: unknown }).aeroOffice = {};
  });
  assert.ok(Object.isFrozen(first));
});

test("a click is posted only to Aero's handler, and only the two known types", () => {
  assert.equal(postToAero('openInbox'), false, 'no webkit at all');
  g.window!.webkit = { messageHandlers: {} };
  assert.equal(postToAero('openInbox'), false, 'no aero handler');
  const posted: unknown[] = [];
  g.window!.webkit = { messageHandlers: { aero: { postMessage: (m: unknown) => posted.push(m) } } };
  assert.equal(postToAero('openInbox'), true);
  assert.equal(postToAero('openCalendar'), true);
  assert.equal(postToAero('focusAgent' as never), false);
  assert.equal(postToAero('' as never), false);
  assert.deepEqual(posted, [{ type: 'openInbox' }, { type: 'openCalendar' }]);
  g.window!.webkit = { messageHandlers: { aero: {} } };
  assert.equal(postToAero('openInbox'), false, 'a handler without postMessage');
});

test("a wall tap tells Aero only when the click is trusted; a script's dispatched click does nothing", () => {
  const posted: unknown[] = [];
  g.window!.webkit = { messageHandlers: { aero: { postMessage: (m: unknown) => posted.push(m) } } };
  const office = {
    aero: { wallHitAt: (x: number) => (x < 10 ? ('openInbox' as const) : null) },
  };
  // A synthetic click (isTrusted false, as dispatchEvent makes) on the whiteboard is taken by the wall and posts nothing.
  assert.equal(handleWallTap(office, 5, 5, false), true);
  assert.deepEqual(posted, []);
  assert.equal(handleWallTap(office, 5, 5, true), true);
  assert.deepEqual(posted, [{ type: 'openInbox' }]);
  // Off the wall nothing is taken, trusted or not.
  assert.equal(handleWallTap(office, 50, 5, true), false);
  assert.equal(posted.length, 1);
});
