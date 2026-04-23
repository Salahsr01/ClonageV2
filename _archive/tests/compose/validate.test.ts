import { test } from 'node:test';
import assert from 'node:assert';
import { fingerprintsOf, validateStructure } from '../../src/compose/validate.js';

test('identical HTML validates ok', () => {
  const html = '<section id="h"><script>alert(1)</script><h1>Hi</h1></section>';
  const fp = fingerprintsOf(html);
  const v = validateStructure(fp, html);
  assert.strictEqual(v.ok, true);
  assert.deepStrictEqual(v.errors, []);
});

test('missing <script> is detected', () => {
  const before = fingerprintsOf('<section><script>gsap.to(".x")</script><p>a</p></section>');
  const v = validateStructure(before, '<section><p>a</p></section>', { minSizeRatio: 0 });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('scripts')));
  assert.strictEqual(v.details.scriptsMatch, false);
  assert.strictEqual(v.details.missingScripts.length, 1);
});

test('missing @keyframes is detected', () => {
  const before = fingerprintsOf(
    '<section><style>@keyframes pulse { 0% {} 100% {} }</style><p>a</p></section>',
  );
  const v = validateStructure(before, '<section><style></style><p>a</p></section>', {
    minSizeRatio: 0,
  });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('@keyframes')));
});

test('missing @font-face is detected', () => {
  const before = fingerprintsOf(
    '<section><style>@font-face { font-family: "X"; src: url(a.woff2); }</style></section>',
  );
  const v = validateStructure(before, '<section><style></style></section>', { minSizeRatio: 0 });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('@font-face')));
});

test('missing data-gsap attribute is detected', () => {
  const before = fingerprintsOf('<section><div data-gsap="fade"><p>a</p></div></section>');
  const v = validateStructure(before, '<section><div><p>a</p></div></section>', {
    minSizeRatio: 0,
  });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('data-attrs')));
  assert.ok(v.details.missingDataAttrs.includes('data-gsap'));
});

test('size ratio below threshold fails', () => {
  const before = fingerprintsOf('<section><p>' + 'x'.repeat(1000) + '</p></section>');
  const v = validateStructure(before, '<section><p>tiny</p></section>', { minSizeRatio: 0.9 });
  assert.strictEqual(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('size ratio')));
});

test('ids missing detected', () => {
  const before = fingerprintsOf('<section id="hero"><div id="cta-btn"></div></section>');
  const v = validateStructure(before, '<section><div></div></section>', { minSizeRatio: 0 });
  assert.strictEqual(v.ok, false);
  assert.ok(v.details.missingIds.includes('hero'));
  assert.ok(v.details.missingIds.includes('cta-btn'));
});

test('extra scripts/keyframes after rewrite are tolerated', () => {
  const before = fingerprintsOf('<section><script>a()</script></section>');
  const after = '<section><script>a()</script><script>b()</script></section>';
  const v = validateStructure(before, after, { minSizeRatio: 0 });
  assert.strictEqual(v.ok, true);
});
