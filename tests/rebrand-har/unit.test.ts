import { test } from 'node:test';
import assert from 'node:assert';
import { briefToPairs, applyPairsToBody } from '../../src/rebrand-har/index.js';

test('briefToPairs expands brand into UPPER/lower/original/© variants', () => {
  const pairs = briefToPairs({
    brand: { source_name: 'NaughtyDuk', name: 'Lumen Studio' },
    copy: [],
  });
  const froms = pairs.map((p) => p[0]);
  assert.ok(froms.includes('NaughtyDuk'));
  assert.ok(froms.includes('NAUGHTYDUK'));
  assert.ok(froms.includes('naughtyduk'));
  assert.ok(froms.includes('NaughtyDuk©'));
  assert.ok(froms.includes('NAUGHTYDUK©'));
});

test('briefToPairs orders by length descending so long patterns win', () => {
  const pairs = briefToPairs({
    brand: { source_name: 'ND', name: 'LS' },
    copy: [
      { from: 'NaughtyDuk Limited', to: 'Lumen Studio Limited' },
      { from: 'NaughtyDuk', to: 'Lumen Studio' },
    ],
  });
  const lengths = pairs.map((p) => p[0].length);
  for (let i = 1; i < lengths.length; i++) {
    assert.ok(lengths[i - 1] >= lengths[i], `sorted desc at index ${i}`);
  }
});

test('briefToPairs dedups repeated froms, preserving first-seen', () => {
  const pairs = briefToPairs({
    brand: { source_name: 'A', name: 'B' },
    copy: [
      { from: 'A', to: 'C' }, // dup of brand's "A" → "B"
    ],
  });
  const aEntries = pairs.filter((p) => p[0] === 'A');
  assert.strictEqual(aEntries.length, 1);
  assert.strictEqual(aEntries[0][1], 'B', 'brand substitution wins first-seen');
});

test('applyPairsToBody applies every pair that matches, counts hits', () => {
  const body = 'NAUGHTYDUK and more NAUGHTYDUK© and lower naughtyduk';
  const pairs: Array<[string, string]> = [
    ['NAUGHTYDUK©', 'LUMEN STUDIO©'],
    ['NAUGHTYDUK', 'LUMEN STUDIO'],
    ['naughtyduk', 'lumen studio'],
  ];
  const { body: out, hits } = applyPairsToBody(body, pairs);
  assert.match(out, /LUMEN STUDIO and more LUMEN STUDIO©/);
  assert.match(out, /lower lumen studio/);
  assert.strictEqual(hits, 3);
});

test('applyPairsToBody preserves body when no pattern matches', () => {
  const body = 'nothing to change here';
  const { body: out, hits } = applyPairsToBody(body, [
    ['FOO', 'BAR'],
  ]);
  assert.strictEqual(out, body);
  assert.strictEqual(hits, 0);
});

test('applyPairsToBody handles color hex codes and rgb strings', () => {
  const body = 'body { background: #f0f0f0; color: rgb(240 240 240 / 1); }';
  const { body: out } = applyPairsToBody(body, [
    ['#f0f0f0', '#0d2e5c'],
    ['rgb(240 240 240', 'rgb(13 46 92'],
  ]);
  assert.match(out, /background: #0d2e5c/);
  assert.match(out, /color: rgb\(13 46 92 \/ 1\)/);
});
