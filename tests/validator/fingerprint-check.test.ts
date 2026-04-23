import { test } from 'node:test';
import assert from 'node:assert';
import { fingerprintHtml, compareFingerprints } from '../../src/validator/fingerprint-check.js';

test('fingerprintHtml counts nodes, scripts, keyframes', () => {
  const html = `
    <html><head>
      <script>a</script>
      <style>@keyframes k1{} @keyframes k2{}</style>
      <link rel="stylesheet" href="/x.css">
    </head><body>
      <div><p>hi</p><script>b</script></div>
    </body></html>`;
  const fp = fingerprintHtml(html);
  assert.strictEqual(fp.scripts, 2);
  assert.strictEqual(fp.keyframes, 2);
  assert.strictEqual(fp.linkStylesheets, 1);
  assert.ok(fp.nodes > 0);
});

test('compareFingerprints ok when actual is equal to expected', () => {
  const fp = { nodes: 10, scripts: 2, keyframes: 1, linkStylesheets: 1, fonts: 0 };
  const c = compareFingerprints(fp, fp);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.report.length, 0);
});

test('compareFingerprints fails when scripts are missing', () => {
  const exp = { nodes: 10, scripts: 3, keyframes: 1, linkStylesheets: 0, fonts: 0 };
  const act = { nodes: 10, scripts: 2, keyframes: 1, linkStylesheets: 0, fonts: 0 };
  const c = compareFingerprints(exp, act);
  assert.strictEqual(c.ok, false);
  assert.match(c.report.join('\n'), /scripts: missing 1/);
});

test('compareFingerprints fails when keyframes are missing', () => {
  const exp = { nodes: 10, scripts: 0, keyframes: 2, linkStylesheets: 0, fonts: 0 };
  const act = { nodes: 10, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 };
  const c = compareFingerprints(exp, act);
  assert.strictEqual(c.ok, false);
  assert.match(c.report.join('\n'), /keyframes: missing 2/);
});

test('compareFingerprints respects nodeTolerance', () => {
  const exp = { nodes: 100, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 };
  const tolerant = compareFingerprints(
    exp,
    { nodes: 103, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 },
    { nodeTolerance: 0.05 },
  );
  assert.strictEqual(tolerant.ok, true);

  const strict = compareFingerprints(
    exp,
    { nodes: 103, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 },
    { nodeTolerance: 0.01 },
  );
  assert.strictEqual(strict.ok, false);
});

test('compareFingerprints passes when expected is 0 for a metric', () => {
  const exp = { nodes: 10, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 };
  const act = { nodes: 10, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 };
  const c = compareFingerprints(exp, act);
  assert.strictEqual(c.ok, true);
});
