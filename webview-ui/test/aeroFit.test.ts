/**
 * The clock plate's text is cut to fit once per text and zoom, not measured again every frame.
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { fitCached, fitCacheSize, fitText } from '../src/aero/fit.js';

const counting = () => {
  const state = { calls: 0 };
  const measure = (text: string) => {
    state.calls++;
    return Array.from(text).length * 5;
  };
  return { state, measure };
};

test('text that fits is kept; text that does not is cut with an ellipsis until it does', () => {
  const { measure } = counting();
  assert.equal(fitText('12:30 Design', 100, measure), '12:30 Design');
  const cut = fitText('12:30 A very long meeting title indeed', 60, measure);
  assert.ok(cut.endsWith('…'));
  assert.ok(measure(cut) <= 60);
});

test('the fitted text is kept by text and zoom: a second frame measures only the key', () => {
  const { state, measure } = counting();
  const first = fitCached('12:30 A very long meeting title indeed', 60, 3, measure);
  const used = state.calls;
  assert.ok(used > 2);
  const again = fitCached('12:30 A very long meeting title indeed', 60, 3, measure);
  assert.equal(again, first);
  assert.equal(state.calls, used + 1, 'one measure of the key, nothing else');
  // Another zoom or text is worked out afresh.
  fitCached('12:30 A very long meeting title indeed', 120, 6, measure);
  assert.ok(state.calls > used + 1);
  assert.ok(fitCacheSize() <= 16);
});

test('the cache stays small', () => {
  const { measure } = counting();
  for (let i = 0; i < 100; i++) fitCached(`10:00 meeting ${i}`, 60, 3, measure);
  assert.ok(fitCacheSize() <= 16);
});
