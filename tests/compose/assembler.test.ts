import { test } from 'node:test';
import assert from 'node:assert';
import { assembleHtml } from '../../src/compose/assembler.js';

test('assembleHtml produces a DOCTYPE-prefixed document', () => {
  const out = assembleHtml({
    title: 'Test',
    lang: 'fr',
    bodySections: [{ role: 'hero', bodyHtml: '<h1>Hi</h1>' }],
    styles: ['body { color: red; }'],
  });
  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.ok(out.includes('<html lang="fr"'));
  assert.ok(out.includes('</html>'));
});

test('assembleHtml concatenates body sections in order', () => {
  const out = assembleHtml({
    title: 'T',
    lang: 'en',
    bodySections: [
      { role: 'nav', bodyHtml: '<nav>NAV</nav>' },
      { role: 'hero', bodyHtml: '<section>HERO</section>' },
      { role: 'footer', bodyHtml: '<footer>F</footer>' },
    ],
    styles: [],
  });
  const navIdx = out.indexOf('NAV');
  const heroIdx = out.indexOf('HERO');
  const footerIdx = out.indexOf('F</footer>');
  assert.ok(navIdx < heroIdx);
  assert.ok(heroIdx < footerIdx);
});

test('assembleHtml merges multiple <style> chunks into the head', () => {
  const out = assembleHtml({
    title: 'T',
    lang: 'fr',
    bodySections: [{ role: 'hero', bodyHtml: '<h1></h1>' }],
    styles: ['body{}', '.hero{}'],
  });
  assert.ok(out.includes('body{}'));
  assert.ok(out.includes('.hero{}'));
  assert.match(out, /<\/style>[\s\S]*<\/head>/);
});

test('assembleHtml wraps each section in a marker comment for debugging', () => {
  const out = assembleHtml({
    title: 'T',
    lang: 'fr',
    bodySections: [{ role: 'hero', bodyHtml: '<h1>X</h1>' }],
    styles: [],
  });
  assert.ok(out.includes('compose:hero'));
});
