import { test } from 'node:test';
import assert from 'node:assert';
import * as cheerio from 'cheerio';
import { assemble } from '../../../src/agents/generation/assembler.js';

test('assemble concatenates section bodies in order', () => {
  const out = assemble({
    sections: [
      { role: 'navbar', site: 'a', html: '<html><body><nav>Nav</nav></body></html>' },
      { role: 'hero', site: 'b', html: '<html><body><section>Hero</section></body></html>' },
      { role: 'footer', site: 'a', html: '<html><body><footer>Footer</footer></body></html>' },
    ],
  });
  const navIdx = out.html.indexOf('<nav>');
  const heroIdx = out.html.indexOf('Hero');
  const footerIdx = out.html.indexOf('<footer>');
  assert.ok(navIdx < heroIdx && heroIdx < footerIdx, 'sections in order');
});

test('assemble preserves all scripts from all sections', () => {
  const out = assemble({
    sections: [
      {
        role: 'hero',
        site: 'a',
        html:
          '<html><head><script>var a=1;</script></head><body><script>var b=2;</script></body></html>',
      },
      {
        role: 'footer',
        site: 'b',
        html: '<html><body><script>var c=3;</script></body></html>',
      },
    ],
  });
  const $ = cheerio.load(out.html);
  const scripts = $('script').toArray();
  // At least 3 scripts total (a,b,c).
  assert.ok(scripts.length >= 3, `expected ≥3 scripts, got ${scripts.length}`);
  assert.match(out.html, /var a=1/);
  assert.match(out.html, /var b=2/);
  assert.match(out.html, /var c=3/);
});

test('assemble preserves all @keyframes across sections', () => {
  const out = assemble({
    sections: [
      {
        role: 'hero',
        site: 'a',
        html: '<html><head><style>@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }</style></head><body></body></html>',
      },
      {
        role: 'footer',
        site: 'b',
        html: '<html><head><style>@keyframes slide { to { transform: translateX(0) } }</style></head><body></body></html>',
      },
    ],
  });
  assert.match(out.html, /@keyframes fadeIn/);
  assert.match(out.html, /@keyframes slide/);
});

test('assemble dedupes identical <head> children by content hash', () => {
  const link = '<link rel="stylesheet" href="/x.css">';
  const out = assemble({
    sections: [
      { role: 'a', site: 'a', html: `<html><head>${link}</head><body>A</body></html>` },
      { role: 'b', site: 'b', html: `<html><head>${link}</head><body>B</body></html>` },
    ],
  });
  const count = (out.html.match(/x\.css/g) || []).length;
  assert.strictEqual(count, 1, 'link appears once after dedup');
});

test('assemble prefixes colliding class names across sections', () => {
  const cssA = '<style>.btn{color:red}</style>';
  const cssB = '<style>.btn{color:blue}</style>';
  const out = assemble({
    sections: [
      {
        role: 'hero',
        site: 'alpha',
        html: `<html><head>${cssA}</head><body><a class="btn">A</a></body></html>`,
      },
      {
        role: 'footer',
        site: 'beta',
        html: `<html><head>${cssB}</head><body><a class="btn">B</a></body></html>`,
      },
    ],
  });
  // The shared class `.btn` must be prefixed — neither .btn should remain
  // without a collision-prefix.
  assert.match(out.html, /s-[a-f0-9]+-btn/);
  // Color rules must be preserved (no loss of CSS)
  assert.match(out.html, /color:red/);
  assert.match(out.html, /color:blue/);
});

test('assemble does not prefix unique classes', () => {
  const out = assemble({
    sections: [
      {
        role: 'hero',
        site: 'a',
        html:
          '<html><head><style>.hero-only{color:red}</style></head><body><div class="hero-only"></div></body></html>',
      },
      {
        role: 'footer',
        site: 'b',
        html: '<html><body><footer>f</footer></body></html>',
      },
    ],
  });
  assert.match(out.html, /\.hero-only\{color:red\}/);
  assert.doesNotMatch(out.html, /s-[a-f0-9]+-hero-only/);
});

test('assemble reports fingerprints per section', () => {
  const out = assemble({
    sections: [
      {
        role: 'hero',
        site: 'a',
        html:
          '<html><head><script></script><script></script><style>@keyframes k1{}</style></head><body><div></div></body></html>',
      },
    ],
  });
  const fp = out.fingerprints[0];
  assert.strictEqual(fp.role, 'hero');
  assert.strictEqual(fp.site, 'a');
  assert.strictEqual(fp.scripts, 2);
  assert.strictEqual(fp.keyframes, 1);
  assert.ok(fp.nodes > 0);
});

test('assemble includes design_constraints JSON when provided', () => {
  const out = assemble({
    sections: [{ role: 'a', site: 's', html: '<html><body></body></html>' }],
    designConstraintsJson: '{"palette_reference":"x"}',
  });
  assert.match(out.html, /__clonage_design_constraints/);
  assert.match(out.html, /"palette_reference":"x"/);
});
