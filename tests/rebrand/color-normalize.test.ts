import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeColor } from '../../src/rebrand/color-normalize.js';

test('normalizeColor: hex3 → rgb', () => {
  assert.strictEqual(normalizeColor('#fff'), 'rgb(255, 255, 255)');
});

test('normalizeColor: hex6 → rgb', () => {
  assert.strictEqual(normalizeColor('#0F1A2B'), 'rgb(15, 26, 43)');
});

test('normalizeColor: hex8 (with alpha) → rgba', () => {
  assert.strictEqual(normalizeColor('#0F1A2BCC'), 'rgba(15, 26, 43, 0.8)');
});

test('normalizeColor: rgb(...) → rgb(...)', () => {
  assert.strictEqual(normalizeColor('rgb(17,17,17)'), 'rgb(17, 17, 17)');
  assert.strictEqual(normalizeColor('rgb(17, 17, 17)'), 'rgb(17, 17, 17)');
});

test('normalizeColor: rgba with alpha=1 → rgb', () => {
  assert.strictEqual(normalizeColor('rgba(255, 0, 0, 1)'), 'rgb(255, 0, 0)');
});

test('normalizeColor: rgba with non-1 alpha → rgba', () => {
  assert.strictEqual(normalizeColor('rgba(255, 0, 0, 0.5)'), 'rgba(255, 0, 0, 0.5)');
});

test('normalizeColor: named color → rgb', () => {
  assert.strictEqual(normalizeColor('white'), 'rgb(255, 255, 255)');
  assert.strictEqual(normalizeColor('black'), 'rgb(0, 0, 0)');
});

test('normalizeColor: returns null for non-color strings', () => {
  assert.strictEqual(normalizeColor('linear-gradient(...)'), null);
  assert.strictEqual(normalizeColor(''), null);
});
