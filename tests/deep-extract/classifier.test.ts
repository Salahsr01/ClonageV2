import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { classify } from '../../src/deep-extract/classifier.js';
import { findSectionCandidates } from '../../src/deep-extract/boundary.js';

function classifyFirst(html: string, index = 0, isFirst = true) {
  const $ = load(html);
  const candidates = findSectionCandidates($);
  if (candidates.length === 0) throw new Error('no candidates');
  return classify(candidates[index] || candidates[0], index, isFirst);
}

test('first section with h1 -> hero', () => {
  assert.strictEqual(
    classifyFirst('<body><main><section class="banner"><h1>Title</h1></section></main></body>'),
    'hero'
  );
});

test('section with class "hero" -> hero even if not first (but first keeps priority)', () => {
  const $ = load('<body><main><nav></nav><section class="hero-wrap"><h1>X</h1></section></main></body>');
  const cs = findSectionCandidates($);
  const navRole = classify(cs[0], 0, true);
  const heroRole = classify(cs[1], 1, false);
  assert.strictEqual(navRole, 'nav');
  assert.strictEqual(heroRole, 'hero');
});

test('section with form -> contact', () => {
  assert.strictEqual(
    classifyFirst('<body><main><section><form><input name="email"><button>Send</button></form></section></main></body>', 0, false),
    'contact'
  );
});

test('section with 3+ similar children + h2 -> services', () => {
  assert.strictEqual(
    classifyFirst(`<body><main><section>
      <h2>What we do</h2>
      <div class="item"><h3>A</h3><p>p</p></div>
      <div class="item"><h3>B</h3><p>p</p></div>
      <div class="item"><h3>C</h3><p>p</p></div>
    </section></main></body>`, 0, false),
    'services'
  );
});

test('section with class "portfolio" -> portfolio', () => {
  assert.strictEqual(
    classifyFirst('<body><main><section class="portfolio-grid"><h2>Work</h2></section></main></body>', 0, false),
    'portfolio'
  );
});

test('section with long paragraph + image -> about', () => {
  const longP = 'A'.repeat(500);
  assert.strictEqual(
    classifyFirst(`<body><main><section class="about-wrap"><p>${longP}</p><img src="x.jpg"></section></main></body>`, 0, false),
    'about'
  );
});

test('section with blockquote -> testimonials', () => {
  assert.strictEqual(
    classifyFirst('<body><main><section><h2>Reviews</h2><blockquote>Great</blockquote></section></main></body>', 0, false),
    'testimonials'
  );
});

test('footer tag -> footer', () => {
  assert.strictEqual(
    classifyFirst('<body><main></main><footer><p>&copy;</p></footer></body>', 0, false),
    'footer'
  );
});

test('nav tag -> nav', () => {
  assert.strictEqual(
    classifyFirst('<body><nav><a href="#">A</a></nav><main></main></body>', 0, true),
    'nav'
  );
});

test('no matching heuristic -> section-N fallback', () => {
  assert.strictEqual(
    classifyFirst('<body><main><section><p>plain text only</p></section></main></body>', 2, false),
    'section-2'
  );
});
