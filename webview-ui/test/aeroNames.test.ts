/**
 * The names over the characters (docs/work/phase6-office-look/plan.md, task A): first names from a key by hash, men's names
 * for even palettes and women's for odd, unique among the characters on show, and a role from the kind and the slug.
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  assignFirstNames,
  hashKey,
  MEN_NAMES,
  roleFromSlug,
  WOMEN_NAMES,
} from '../src/aero/names.js';

test('both lists have at least 64 distinct names, none shared, none long or odd', () => {
  assert.ok(MEN_NAMES.length >= 64);
  assert.ok(WOMEN_NAMES.length >= 64);
  assert.equal(new Set(MEN_NAMES).size, MEN_NAMES.length);
  assert.equal(new Set(WOMEN_NAMES).size, WOMEN_NAMES.length);
  const shared = MEN_NAMES.filter((n) => WOMEN_NAMES.includes(n));
  assert.deepEqual(shared, []);
  for (const n of [...MEN_NAMES, ...WOMEN_NAMES]) assert.match(n, /^[A-Z][a-z]{1,8}$/, n);
  assert.ok(!MEN_NAMES.includes('Proton') && !WOMEN_NAMES.includes('Proton'));
});

test('the hash is a fixed function of the key', () => {
  assert.equal(hashKey('a'), hashKey('a'));
  assert.notEqual(hashKey('a'), hashKey('b'));
  assert.ok(Number.isInteger(hashKey('é')) && hashKey('é') >= 0);
});

test('even palettes get men’s names and odd palettes women’s, whatever the key', () => {
  const entries = Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, palette: i % 6 }));
  const names = assignFirstNames(entries);
  for (const e of entries) {
    const list = e.palette % 2 === 0 ? MEN_NAMES : WOMEN_NAMES;
    assert.ok(list.includes(names.get(e.key)!), `${e.key} palette ${e.palette}`);
  }
});

test('names are unique among those on show, and the same for the same set whatever the order', () => {
  const entries = Array.from({ length: 60 }, (_, i) => ({ key: `floor/${i}/slug`, palette: 2 }));
  const first = assignFirstNames(entries);
  assert.equal(new Set(first.values()).size, 60, 'sixty men, sixty names');
  const reversed = assignFirstNames([...entries].reverse());
  assert.deepEqual([...reversed].sort(), [...first].sort());
  // One alone gets the name its key hashes to.
  const alone = assignFirstNames([{ key: 'floor/3/slug', palette: 2 }]);
  assert.equal(alone.get('floor/3/slug'), MEN_NAMES[hashKey('floor/3/slug') % MEN_NAMES.length]);
});

test('more characters than names still gets everyone a name (the repeats come last)', () => {
  const entries = Array.from({ length: MEN_NAMES.length + 3 }, (_, i) => ({
    key: `k${i}`,
    palette: 0,
  }));
  const names = assignFirstNames(entries);
  assert.equal(names.size, entries.length);
  assert.equal(new Set(names.values()).size, MEN_NAMES.length);
});

test('a role from a slug: the code- and aero- prefixes go, words are title-cased, long ones are cut', () => {
  assert.equal(roleFromSlug('code-reviewer'), 'Reviewer');
  assert.equal(roleFromSlug('aero-architect'), 'Architect');
  assert.equal(roleFromSlug('architect'), 'Architect');
  assert.equal(roleFromSlug('security_auditor'), 'Security Auditor');
  assert.equal(roleFromSlug('code-'), 'Code');
  assert.equal(roleFromSlug(''), 'Agent');
  assert.ok(roleFromSlug('x'.repeat(80)).length <= 20);
});
