import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyPalette } from '../../src/rebrand/transformers/palette.js';

test('applyPalette replaces a rgb() color in a style attribute', () => {
  const $ = load('<div style="color: rgb(17, 17, 17); padding: 8px"></div>');
  const report = applyPalette($, { map: { 'rgb(17, 17, 17)': '#0F1A2B' } });
  assert.match($('div').attr('style')!, /color:\s*#0F1A2B/);
  assert.match($('div').attr('style')!, /padding:\s*8px/);
  assert.strictEqual(report.applied, 1);
});

test('applyPalette matches hex source keys against rgb inline styles (normalization)', () => {
  const $ = load('<div style="background-color: rgb(255, 255, 255)"></div>');
  applyPalette($, { map: { '#ffffff': '#F5E6C8' } });
  assert.match($('div').attr('style')!, /background-color:\s*#F5E6C8/);
});

test('applyPalette replaces in gradient stops', () => {
  const $ = load('<div style="background-image: linear-gradient(0deg, rgb(17, 17, 17), rgba(255, 0, 0, 0.5))"></div>');
  const report = applyPalette($, { map: { 'rgb(17, 17, 17)': '#000000' } });
  assert.match($('div').attr('style')!, /linear-gradient\(0deg,\s*#000000,\s*rgba\(255,\s*0,\s*0,\s*0\.5\)\)/);
  assert.strictEqual(report.applied, 1);
});

test('applyPalette reports top-5 unmapped source colors', () => {
  const html = `
    <div style="color: rgb(1, 1, 1)"></div>
    <div style="color: rgb(1, 1, 1)"></div>
    <div style="color: rgb(2, 2, 2)"></div>
    <div style="color: rgb(3, 3, 3); background-color: rgb(4, 4, 4)"></div>
  `;
  const $ = load(html);
  const report = applyPalette($, { map: {} });
  const unmapped = report.info?.topUnmapped as Array<[string, number]>;
  assert.ok(unmapped.length > 0);
  assert.deepStrictEqual(unmapped[0], ['rgb(1, 1, 1)', 2]);
});
