import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { reproduceExact } from '../../src/reproducer-exact/index.js';

test('reproduceExact runs end-to-end on the hero fixture', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'tests/reproducer-exact/fixtures');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-e2e-'));

  const result = await reproduceExact({
    clonePath: fixtureDir,
    entryFile: 'sample-hero.html',
    section: 'section.hero',
    outputDir,
    viewport: { width: 1280, height: 800 },
    diffThreshold: 0.05,
  });

  assert.ok(fs.existsSync(result.outputHtml), `output HTML missing: ${result.outputHtml}`);
  assert.ok(fs.existsSync(result.metadataPath), `metadata missing: ${result.metadataPath}`);

  const meta = JSON.parse(fs.readFileSync(result.metadataPath, 'utf-8'));
  assert.strictEqual(meta.detectionMethod, 'selector');
  assert.ok(typeof meta.diffScore === 'number');

  const html = fs.readFileSync(result.outputHtml, 'utf-8');
  assert.match(html, /Fixture Hero Title/, 'hero title text preserved');
  assert.match(html, /font-size:\s*72px/, 'computed font-size inlined');

  // 5% threshold for fixture (should typically be much lower than 1%)
  assert.ok(result.diffScore < 0.05, `diff score too high: ${(result.diffScore * 100).toFixed(2)}%`);
});
