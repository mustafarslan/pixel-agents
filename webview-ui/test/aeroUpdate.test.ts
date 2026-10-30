/**
 * Aero's update channel: `window.aeroOffice.update(data)` is validated strictly. Names and a meeting title are
 * untrusted text, so anything that is not exactly the shape is rejected whole.
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { agentTypeFromStatus, badgeText, clip, parseAeroUpdate } from '../src/aero/update.js';

const good = () => ({
  lunch: false,
  meeting: { time: '14:30', title: 'Design review' },
  inbox: 3,
  agents: [
    { name: 'Code Reviewer', slug: 'code-reviewer' },
    { name: 'Explorer', slug: 'explorer' },
  ],
  lounge: true,
});

test('a well-formed update is accepted as it is', () => {
  assert.deepEqual(parseAeroUpdate(good()), good());
});

test('no meeting and no agents are fine', () => {
  const update = { ...good(), meeting: null, agents: [] };
  assert.deepEqual(parseAeroUpdate(update), update);
});

test('anything but a plain object is rejected', () => {
  for (const bad of [null, undefined, 3, 'x', [], [good()], new Map(), new (class A {})()]) {
    assert.equal(parseAeroUpdate(bad), null);
  }
});

test('a missing key or an extra key rejects it', () => {
  for (const key of Object.keys(good())) {
    const missing: Record<string, unknown> = good();
    delete missing[key];
    assert.equal(parseAeroUpdate(missing), null, `without ${key}`);
  }
  assert.equal(parseAeroUpdate({ ...good(), extra: 1 }), null);
  assert.equal(parseAeroUpdate({ ...good(), __proto__x: 1 }), null);
});

test('wrong types reject it', () => {
  assert.equal(parseAeroUpdate({ ...good(), lunch: 1 }), null);
  assert.equal(parseAeroUpdate({ ...good(), lounge: 'yes' }), null);
  assert.equal(parseAeroUpdate({ ...good(), inbox: '3' }), null);
  assert.equal(parseAeroUpdate({ ...good(), inbox: 1.5 }), null);
  assert.equal(parseAeroUpdate({ ...good(), inbox: -1 }), null);
  assert.equal(parseAeroUpdate({ ...good(), inbox: 100_000 }), null);
  assert.equal(parseAeroUpdate({ ...good(), inbox: Number.NaN }), null);
  assert.equal(parseAeroUpdate({ ...good(), agents: 'x' }), null);
  assert.equal(parseAeroUpdate({ ...good(), meeting: 'x' }), null);
});

test('the meeting time is HH:MM and the title is capped and clean', () => {
  const withMeeting = (time: string, title: string) => ({ ...good(), meeting: { time, title } });
  assert.notEqual(parseAeroUpdate(withMeeting('00:00', '')), null);
  assert.notEqual(parseAeroUpdate(withMeeting('23:59', 'x'.repeat(60))), null);
  for (const time of ['24:00', '9:30', '12:60', '12:5', '1230', '12:30:00', ' 12:30']) {
    assert.equal(parseAeroUpdate(withMeeting(time, 'a')), null, time);
  }
  assert.equal(parseAeroUpdate(withMeeting('12:00', 'x'.repeat(61))), null);
  assert.equal(parseAeroUpdate(withMeeting('12:00', 'a\nb')), null);
  assert.equal(parseAeroUpdate(withMeeting('12:00', 'a‮b')), null);
  assert.equal(parseAeroUpdate(withMeeting('12:00', 'a b')), null);
  assert.equal(parseAeroUpdate({ ...good(), meeting: { time: '12:00' } }), null);
  assert.equal(parseAeroUpdate({ ...good(), meeting: { time: '12:00', title: 'a', x: 1 } }), null);
  // 60 code points that take two UTF-16 units each still fit.
  assert.notEqual(parseAeroUpdate(withMeeting('12:00', '\u{1F600}'.repeat(60))), null);
});

test('at most eight agents; names capped at 40 and clean; slugs exact; no repeats', () => {
  const agent = (n: number) => ({ name: `Agent ${n}`, slug: `agent-${n}` });
  const eight = Array.from({ length: 8 }, (_, i) => agent(i));
  assert.notEqual(parseAeroUpdate({ ...good(), agents: eight }), null);
  assert.equal(parseAeroUpdate({ ...good(), agents: [...eight, agent(9)] }), null);

  const one = (name: unknown, slug: unknown) => ({ ...good(), agents: [{ name, slug }] });
  assert.notEqual(parseAeroUpdate(one('x'.repeat(40), 'a')), null);
  assert.equal(parseAeroUpdate(one('x'.repeat(41), 'a')), null);
  assert.equal(parseAeroUpdate(one('', 'a')), null);
  assert.equal(parseAeroUpdate(one('   ', 'a')), null);
  assert.equal(parseAeroUpdate(one('a\tb', 'a')), null);
  assert.equal(parseAeroUpdate(one('a​b', 'a')), null);
  assert.equal(
    parseAeroUpdate(one('<img src=x onerror=1>', 'a'))?.agents[0].name,
    '<img src=x onerror=1>',
  );
  assert.equal(parseAeroUpdate(one(5, 'a')), null);
  for (const slug of ['', 'A', '-a', 'a b', 'a/b', 'a.b', 'a_b', 'x'.repeat(41), 5]) {
    assert.equal(parseAeroUpdate(one('n', slug)), null, String(slug));
  }
  assert.notEqual(parseAeroUpdate(one('n', 'x'.repeat(40))), null);
  assert.notEqual(parseAeroUpdate(one('n', '9-lives')), null);
  assert.equal(
    parseAeroUpdate({
      ...good(),
      agents: [
        { name: 'a', slug: 'x' },
        { name: 'b', slug: 'x' },
      ],
    }),
    null,
  );
  assert.equal(parseAeroUpdate({ ...good(), agents: [{ name: 'a', slug: 'x', extra: 1 }] }), null);
});

test('a project agent carries its room: 12 lowercase hex, exact keys; the same slug may be in several rooms', () => {
  const room = '0a1b2c3d4e5f';
  const one = (agent: Record<string, unknown>) => ({ ...good(), agents: [agent] });
  const withRoom = one({ name: 'Reviewer', slug: 'reviewer', room });
  assert.deepEqual(parseAeroUpdate(withRoom), withRoom);
  // Agents with and without a room can sit side by side.
  const mixed = {
    ...good(),
    agents: [
      { name: 'Reviewer', slug: 'reviewer', room },
      { name: 'Reviewer', slug: 'reviewer', room: 'ffffffffffff' },
      { name: 'Reviewer', slug: 'reviewer' },
    ],
  };
  assert.deepEqual(parseAeroUpdate(mixed), mixed);
  for (const bad of [
    '',
    '0A1B2C3D4E5F',
    '0a1b2c3d4e5',
    '0a1b2c3d4e5f0',
    '0a1b2c3d4e5g',
    '../0a1b2c3d4e',
    'prruns',
    5,
    null,
  ]) {
    assert.equal(parseAeroUpdate(one({ name: 'n', slug: 'a', room: bad })), null, String(bad));
  }
  // The same slug in the same room twice, a room with no slug, and extra keys are rejected.
  assert.equal(
    parseAeroUpdate({
      ...good(),
      agents: [
        { name: 'a', slug: 'x', room },
        { name: 'b', slug: 'x', room },
      ],
    }),
    null,
  );
  assert.equal(parseAeroUpdate(one({ name: 'n', room })), null);
  assert.equal(parseAeroUpdate(one({ name: 'n', slug: 'a', room, extra: 1 })), null);
});

test('the agent type comes from "Subtask: <type>" only', () => {
  assert.equal(agentTypeFromStatus('Subtask: code-reviewer'), 'code-reviewer');
  assert.equal(agentTypeFromStatus('Subtask:   spaced  '), 'spaced');
  assert.equal(agentTypeFromStatus('Subtask:'), null);
  assert.equal(agentTypeFromStatus('Subtask: '), null);
  assert.equal(agentTypeFromStatus('Using Read'), null);
  assert.equal(agentTypeFromStatus(undefined), null);
  assert.equal(agentTypeFromStatus(4), null);
});

test('badge text and clipping', () => {
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(clip('abc', 5), 'abc');
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('abcdef', 0), '…');
});
