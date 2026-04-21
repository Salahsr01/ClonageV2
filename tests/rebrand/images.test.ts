import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { load } from 'cheerio';
import { applyImages } from '../../src/rebrand/transformers/images.js';

const FIXTURE_IMG = path.resolve(process.cwd(), 'tests/rebrand/fixtures/new-hero.jpg');

test('applyImages from/to matches suffix and rewrites <img src>', () => {
  const $ = load('<img src="./assets/old-hero.webp"><img src="./assets/logo.svg">');
  applyImages($, [{ from: 'old-hero.webp', to: 'https://cdn.example.com/new.jpg' }]);
  assert.strictEqual($('img').eq(0).attr('src'), 'https://cdn.example.com/new.jpg');
  assert.strictEqual($('img').eq(1).attr('src'), './assets/logo.svg');
});

test('applyImages selector/to rewrites matching <img>', () => {
  const $ = load('<img class="hero-img" src="a.jpg"><img class="other" src="b.jpg">');
  applyImages($, [{ selector: '.hero-img', to: 'https://cdn.example.com/new.jpg' }]);
  assert.strictEqual($('img.hero-img').attr('src'), 'https://cdn.example.com/new.jpg');
  assert.strictEqual($('img.other').attr('src'), 'b.jpg');
});

test('applyImages inlines local files as data: URLs', () => {
  const $ = load('<img class="hero-img" src="old.jpg">');
  applyImages($, [{ selector: '.hero-img', to: FIXTURE_IMG }]);
  const src = $('img.hero-img').attr('src')!;
  assert.match(src, /^data:image\/jpeg;base64,/);
});

test('applyImages warns on missing local file', () => {
  const $ = load('<img class="hero-img" src="old.jpg">');
  const report = applyImages($, [{ selector: '.hero-img', to: './nonexistent.jpg' }]);
  assert.match(report.warnings[0], /not found/);
});
