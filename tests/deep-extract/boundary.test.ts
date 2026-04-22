import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { findSectionCandidates } from '../../src/deep-extract/boundary.js';

const FIXTURE = path.resolve(process.cwd(), 'tests/deep-extract/fixtures/minimal-clone/index.html');

test('minimal fixture produces 5 candidates in document order', () => {
  const html = fs.readFileSync(FIXTURE, 'utf-8');
  const $ = load(html);
  const candidates = findSectionCandidates($);
  assert.strictEqual(candidates.length, 5, 'expected 5 top-level structural sections');
  const tags = candidates.map(c => c.tag);
  assert.deepStrictEqual(tags, ['section', 'section', 'section', 'section', 'footer']);
  const classes = candidates.map(c => c.classList.join(' '));
  assert.deepStrictEqual(classes, ['hero-wrap', 'services-grid', 'portfolio-grid', 'contact-block', 'site-footer']);
});

test('candidate metadata is populated', () => {
  const html = fs.readFileSync(FIXTURE, 'utf-8');
  const $ = load(html);
  const hero = findSectionCandidates($)[0];
  assert.ok(hero.textLength > 0, 'textLength > 0');
  assert.ok(hero.childCount > 0, 'childCount > 0');
  assert.ok(hero.depth >= 2, 'depth at least 2 (body > main > section)');
  assert.strictEqual(hero.tag, 'section');
});

test('nested sections are not re-listed (top-level only)', () => {
  const $ = load('<body><main><section><section>nested</section><p>outer</p></section></main></body>');
  const candidates = findSectionCandidates($);
  assert.strictEqual(candidates.length, 1, 'nested section must not appear as its own top-level');
});

test('no structural tags -> fallback to main children with h1/h2 or section-like class', () => {
  const $ = load(`
    <body><main>
      <div class="hero-wrap"><h1>Title</h1></div>
      <div><p>no h1, no class - skipped</p></div>
      <div class="section-services"><h2>Services</h2></div>
    </main></body>
  `);
  const candidates = findSectionCandidates($);
  assert.strictEqual(candidates.length, 2);
  assert.deepStrictEqual(candidates.map(c => c.classList.join(' ')), ['hero-wrap', 'section-services']);
});

test('no main, no structural tags -> fallback to body children with h1/h2', () => {
  const $ = load(`
    <body>
      <div class="page-hero"><h1>Hello</h1></div>
      <div><p>skipped</p></div>
    </body>
  `);
  const candidates = findSectionCandidates($);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].classList[0], 'page-hero');
});
