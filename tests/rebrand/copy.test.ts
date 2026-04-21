import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyCopy } from '../../src/rebrand/transformers/copy.js';

test('applyCopy from/to replaces literal text in text nodes', () => {
  const $ = load('<p>Digital evolution happens here.</p>');
  const report = applyCopy($, [{ from: 'Digital evolution', to: 'Artisanat du bois' }]);
  assert.strictEqual($('p').text(), 'Artisanat du bois happens here.');
  assert.strictEqual(report.applied, 1);
});

test('applyCopy selector/to replaces text content of matching elements', () => {
  const $ = load('<h1>Old heading</h1><h2>Keep this</h2>');
  applyCopy($, [{ selector: 'h1', to: 'New heading' }]);
  assert.strictEqual($('h1').text(), 'New heading');
  assert.strictEqual($('h2').text(), 'Keep this');
});

test('applyCopy warns when new text is >1.5x original length', () => {
  const $ = load('<p>Short</p>');
  const report = applyCopy($, [{ from: 'Short', to: 'Much much longer replacement text' }]);
  assert.strictEqual(report.warnings.length, 1);
  assert.match(report.warnings[0], /1\.5/);
});

test('applyCopy warns when from string has no match', () => {
  const $ = load('<p>Hello</p>');
  const report = applyCopy($, [{ from: 'Not present', to: 'New' }]);
  assert.match(report.warnings[0], /no match/i);
  assert.strictEqual(report.applied, 0);
});
