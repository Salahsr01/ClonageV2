import { test } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'crypto';
import { buildInventory } from '../../src/compose/inventory.js';

test('inline-formatting preserved as single copy-block', () => {
  const inv = buildInventory('<section><h1>Ready <span class="x">now</span></h1></section>');
  assert.strictEqual(inv.copyBlocks.length, 1);
  const b = inv.copyBlocks[0];
  assert.strictEqual(b.tag, 'h1');
  assert.strictEqual(b.hint, 'heading');
  assert.strictEqual(b.inline, true);
  assert.strictEqual(b.text, 'Ready now');
});

test('block with only text (no inline child) has inline=false', () => {
  const inv = buildInventory('<section><h2>Plain title</h2></section>');
  assert.strictEqual(inv.copyBlocks.length, 1);
  assert.strictEqual(inv.copyBlocks[0].inline, false);
});

test('nested containers descend until copy-block', () => {
  const html = '<div><section><h1>Hi</h1><p>body text</p></section></div>';
  const inv = buildInventory(html);
  assert.strictEqual(inv.copyBlocks.length, 2);
  assert.strictEqual(inv.copyBlocks[0].tag, 'h1');
  assert.strictEqual(inv.copyBlocks[1].tag, 'p');
});

test('scripts and styles do NOT produce copy-blocks', () => {
  const html = `<section>
    <script>var x = "heading";</script>
    <style>.x { color: red; }</style>
    <p>real text</p>
  </section>`;
  const inv = buildInventory(html);
  assert.strictEqual(inv.copyBlocks.length, 1);
  assert.strictEqual(inv.copyBlocks[0].text, 'real text');
});

test('whitespace-only elements are not copy-blocks', () => {
  const inv = buildInventory('<section><p>   </p><p>hello</p></section>');
  assert.strictEqual(inv.copyBlocks.length, 1);
  assert.strictEqual(inv.copyBlocks[0].text, 'hello');
});

test('ids are sequential c1, c2, c3 in document order', () => {
  const inv = buildInventory('<section><h1>A</h1><p>B</p><h2>C</h2></section>');
  assert.deepStrictEqual(
    inv.copyBlocks.map((b) => b.id),
    ['c1', 'c2', 'c3'],
  );
  assert.deepStrictEqual(
    inv.copyBlocks.map((b) => b.text),
    ['A', 'B', 'C'],
  );
});

test('attrs extracts alt/aria-label/title/placeholder', () => {
  const html = `<section>
    <img src="a.jpg" alt="Panel photo"/>
    <a href="/x" aria-label="open menu">X</a>
    <input placeholder="Your email"/>
    <button title="submit form">Go</button>
  </section>`;
  const inv = buildInventory(html);
  const byAttr = Object.fromEntries(inv.attrs.map((a) => [a.attr, a.text]));
  assert.strictEqual(byAttr.alt, 'Panel photo');
  assert.strictEqual(byAttr['aria-label'], 'open menu');
  assert.strictEqual(byAttr.placeholder, 'Your email');
  assert.strictEqual(byAttr.title, 'submit form');
});

test('metaText captures title, description, og tags', () => {
  const html = `<html><head>
    <title>Hello World</title>
    <meta name="description" content="a page"/>
    <meta property="og:title" content="OG Title"/>
    <meta property="og:description" content="OG desc"/>
  </head><body><p>x</p></body></html>`;
  const inv = buildInventory(html);
  const kinds = inv.metaText.map((m) => m.kind);
  assert.ok(kinds.includes('title'));
  assert.ok(kinds.includes('description'));
  assert.ok(kinds.includes('og:title'));
  assert.ok(kinds.includes('og:description'));
});

test('fingerprints.scripts contains SHA-1 of each script body', () => {
  const html = '<section><script>alert(1)</script><script>foo()</script></section>';
  const inv = buildInventory(html);
  assert.strictEqual(inv.fingerprints.scripts.length, 2);
  const h0 = crypto.createHash('sha1').update('alert(1)').digest('hex');
  const h1 = crypto.createHash('sha1').update('foo()').digest('hex');
  assert.strictEqual(inv.fingerprints.scripts[0], h0);
  assert.strictEqual(inv.fingerprints.scripts[1], h1);
});

test('fingerprints counts @keyframes and @font-face', () => {
  const html = `<section><style>
    @keyframes pulse { from { opacity: 0 } to { opacity: 1 } }
    @-webkit-keyframes fade { 0% { opacity: 1 } 100% { opacity: 0 } }
    @font-face { font-family: "X"; src: url(a.woff2); }
  </style></section>`;
  const inv = buildInventory(html);
  assert.strictEqual(inv.fingerprints.keyframesCount, 2);
  assert.strictEqual(inv.fingerprints.fontFaceCount, 1);
});

test('fingerprints captures ids and data-attrs', () => {
  const html = `<section id="hero" data-scroll>
    <div id="inner" data-gsap="fade" data-speed="2"></div>
  </section>`;
  const inv = buildInventory(html);
  assert.deepStrictEqual(inv.fingerprints.ids, ['hero', 'inner']);
  assert.ok(inv.fingerprints.dataAttrs.includes('data-scroll'));
  assert.ok(inv.fingerprints.dataAttrs.includes('data-gsap'));
  assert.ok(inv.fingerprints.dataAttrs.includes('data-speed'));
});

test('button/anchor classified as cta', () => {
  const inv = buildInventory('<section><a href="/x">Read more</a><button>Send</button></section>');
  assert.strictEqual(inv.copyBlocks[0].hint, 'cta');
  assert.strictEqual(inv.copyBlocks[1].hint, 'cta');
});

test('mixed div (container with h2+p siblings) is descended, not recorded', () => {
  const inv = buildInventory('<div><h2>Title</h2><p>body</p></div>');
  assert.strictEqual(inv.copyBlocks.length, 2);
  assert.deepStrictEqual(
    inv.copyBlocks.map((b) => b.tag),
    ['h2', 'p'],
  );
});

test('path uses nth-of-type for repeated siblings', () => {
  const html = '<section><p>a</p><p>b</p><p>c</p></section>';
  const inv = buildInventory(html);
  const paths = inv.copyBlocks.map((b) => b.path);
  assert.ok(paths[0].endsWith('p:nth-of-type(1)'));
  assert.ok(paths[2].endsWith('p:nth-of-type(3)'));
});
