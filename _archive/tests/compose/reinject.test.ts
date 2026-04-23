import { test } from 'node:test';
import assert from 'node:assert';
import { buildInventory } from '../../src/compose/inventory.js';
import { applyPatches } from '../../src/compose/reinject.js';

test('patch on inline=false block replaces textContent', () => {
  const html = '<section><h1>Old title</h1><p>body</p></section>';
  const inv = buildInventory(html);
  const h1Id = inv.copyBlocks.find((b) => b.tag === 'h1')!.id;
  const { html: out, report } = applyPatches(html, inv, { copy: { [h1Id]: 'NEW TITLE' } });
  assert.ok(out.includes('<h1>NEW TITLE</h1>'));
  assert.ok(out.includes('<p>body</p>'));
  assert.strictEqual(report.copyApplied, 1);
});

test('patch on inline=true block mutates first text-node only, keeps inline tags', () => {
  const html = '<section><h1>Ready <span class="accent">now</span></h1></section>';
  const inv = buildInventory(html);
  const id = inv.copyBlocks[0].id;
  const { html: out } = applyPatches(html, inv, { copy: { [id]: 'Bonjour monde' } });
  assert.ok(out.includes('<span class="accent">'), 'inline span preserved');
  assert.ok(out.includes('Bonjour monde'));
});

test('unknown id in patches is reported as warning, not applied', () => {
  const html = '<section><p>a</p></section>';
  const inv = buildInventory(html);
  const { html: out, report } = applyPatches(html, inv, { copy: { 'c999': 'ignored' } });
  assert.ok(out.includes('<p>a</p>'));
  assert.strictEqual(report.copyApplied, 0);
  assert.ok(report.warnings.some((w) => w.includes('c999')));
});

test('missing patches leave blocks unchanged (no-op)', () => {
  const html = '<section><h1>Keep</h1><p>Also keep</p></section>';
  const inv = buildInventory(html);
  const { html: out, report } = applyPatches(html, inv, {});
  assert.ok(out.includes('<h1>Keep</h1>'));
  assert.ok(out.includes('<p>Also keep</p>'));
  assert.strictEqual(report.copyApplied, 0);
  assert.strictEqual(report.copySkipped, 2);
});

test('scripts are preserved byte-for-byte', () => {
  const scriptBody = 'gsap.to(".x", {opacity: 1, duration: 2});';
  const html = `<section><script>${scriptBody}</script><p>old</p></section>`;
  const inv = buildInventory(html);
  const pId = inv.copyBlocks[0].id;
  const { html: out } = applyPatches(html, inv, { copy: { [pId]: 'new' } });
  assert.ok(out.includes(`<script>${scriptBody}</script>`));
  assert.ok(out.includes('<p>new</p>'));
});

test('@keyframes and @font-face preserved in <style>', () => {
  const css = '@keyframes pulse { 0% { opacity: 0 } 100% { opacity: 1 } } @font-face { font-family: "X"; src: url(a.woff2); }';
  const html = `<section><style>${css}</style><h1>t</h1></section>`;
  const inv = buildInventory(html);
  const id = inv.copyBlocks[0].id;
  const { html: out } = applyPatches(html, inv, { copy: { [id]: 'new' } });
  assert.ok(out.includes('@keyframes pulse'));
  assert.ok(out.includes('@font-face'));
});

test('data-attributes preserved on all elements', () => {
  const html = '<section id="hero" data-scroll><div data-gsap="fade"><h1>t</h1></div></section>';
  const inv = buildInventory(html);
  const id = inv.copyBlocks[0].id;
  const { html: out } = applyPatches(html, inv, { copy: { [id]: 'NEW' } });
  assert.ok(out.includes('id="hero"'));
  assert.ok(out.includes('data-scroll'));
  assert.ok(out.includes('data-gsap="fade"'));
});

test('attrs patch updates alt / aria-label', () => {
  const html = '<section><img src="a.jpg" alt="Panel photo"/><a aria-label="open menu">x</a></section>';
  const inv = buildInventory(html);
  const altId = inv.attrs.find((a) => a.attr === 'alt')!.id;
  const ariaId = inv.attrs.find((a) => a.attr === 'aria-label')!.id;
  const { html: out, report } = applyPatches(html, inv, {
    attrs: { [altId]: 'New alt', [ariaId]: 'open menu FR' },
  });
  assert.ok(out.includes('alt="New alt"'));
  assert.ok(out.includes('aria-label="open menu FR"'));
  assert.strictEqual(report.attrsApplied, 2);
});

test('meta patch updates title and meta[name=description]', () => {
  const html =
    '<html><head><title>Old</title><meta name="description" content="old desc"/></head><body><p>x</p></body></html>';
  const inv = buildInventory(html);
  const titleId = inv.metaText.find((m) => m.kind === 'title')!.id;
  const descId = inv.metaText.find((m) => m.kind === 'description')!.id;
  const { html: out, report } = applyPatches(html, inv, {
    meta: { [titleId]: 'New', [descId]: 'new desc' },
  });
  assert.ok(out.includes('<title>New</title>'));
  assert.ok(out.includes('content="new desc"'));
  assert.strictEqual(report.metaApplied, 2);
});
