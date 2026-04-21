import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyBrand } from '../../src/rebrand/transformers/brand.js';

test('applyBrand replaces source_name in text nodes', () => {
  const $ = load('<h1>Made in Evolve</h1><p>We are Made in Evolve, great.</p>');
  const report = applyBrand($, { name: 'Atelier Noma', source_name: 'Made in Evolve' });
  assert.strictEqual($('h1').text(), 'Atelier Noma');
  assert.strictEqual($('p').text(), 'We are Atelier Noma, great.');
  assert.strictEqual(report.applied, 2);
});

test('applyBrand does NOT touch attribute values', () => {
  const $ = load('<div class="Evolve-section" title="Made in Evolve logo"><span>Made in Evolve</span></div>');
  applyBrand($, { name: 'Atelier Noma', source_name: 'Made in Evolve' });
  assert.strictEqual($('div').attr('class'), 'Evolve-section', 'class attribute untouched');
  assert.strictEqual($('div').attr('title'), 'Made in Evolve logo', 'title attribute untouched');
  assert.strictEqual($('span').text(), 'Atelier Noma', 'text node replaced');
});

test('applyBrand reports 0 applied when source_name not present', () => {
  const $ = load('<h1>Hello world</h1>');
  const report = applyBrand($, { name: 'X', source_name: 'Y' });
  assert.strictEqual(report.applied, 0);
});
