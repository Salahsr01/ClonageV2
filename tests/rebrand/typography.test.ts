import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyTypography } from '../../src/rebrand/transformers/typography.js';

test('applyTypography replaces the most-frequent font-family (primary role)', () => {
  const html = `
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <h1 style="font-family: Georgia; font-size: 48px">title</h1>
  `;
  const $ = load(html);
  const report = applyTypography($, {
    primary: { family: 'Inter', google: false },
  });
  assert.match($('p').first().attr('style')!, /font-family:\s*Inter/);
  assert.strictEqual(report.applied >= 3, true);
});

test('applyTypography replaces display-role fonts on large headings', () => {
  const html = `
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <h1 style="font-family: Georgia; font-size: 48px">title</h1>
    <h2 style="font-family: Georgia; font-size: 40px">sub</h2>
  `;
  const $ = load(html);
  applyTypography($, {
    display: { family: 'Playfair Display', google: false },
  });
  assert.match($('h1').attr('style')!, /font-family:\s*Playfair Display/);
  assert.match($('h2').attr('style')!, /font-family:\s*Playfair Display/);
  assert.match($('p').attr('style')!, /font-family:\s*Helvetica/); // untouched
});

test('applyTypography adds Google Fonts link to <head> when google:true', () => {
  const $ = load('<html><head></head><body><p style="font-family: Helvetica">hi</p></body></html>');
  applyTypography($, {
    primary: { family: 'Inter', google: true },
    display: { family: 'Playfair Display', google: true },
  });
  const links = $('head link[href*="fonts.googleapis.com"]');
  assert.strictEqual(links.length, 1, 'one combined Google Fonts link');
  const href = links.attr('href')!;
  assert.match(href, /family=Inter/);
  assert.match(href, /family=Playfair\+Display/);
});
