import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rebrand } from '../../src/rebrand/index.js';
import { loadBrief } from '../../src/rebrand/brief.js';

test('rebrand E2E: passthrough when brief is empty ({})', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebrand-e2e-'));
  const inputPath = path.join(outDir, 'hero.html');
  fs.writeFileSync(inputPath, '<!DOCTYPE html><html><body><h1 style="color: rgb(42,24,16); font-family: Arial; font-size: 72px">Fixture Hero</h1></body></html>');

  const result = await rebrand({
    inputHtml: inputPath,
    brief: {},
  });

  const out = fs.readFileSync(result.outputHtml, 'utf-8');
  assert.match(out, /Fixture Hero/);
  assert.match(out, /rgb\(42,24,16\)|rgb\(42, 24, 16\)/);
  assert.strictEqual(result.reports.every(r => r.skipped === 1), true);
});

test('rebrand E2E: full brief applies all 5 transformers', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebrand-e2e-'));
  const inputPath = path.join(outDir, 'hero.html');
  fs.writeFileSync(inputPath, `
    <!DOCTYPE html><html><head></head><body>
    <h1 style="color: rgb(42, 24, 16); font-family: Arial; font-size: 72px">Fixture Hero</h1>
    <p style="color: rgb(100, 100, 100); font-family: Arial; font-size: 14px">Some body copy</p>
    <img class="hero-img" src="./old-hero.jpg">
    </body></html>
  `);

  const briefPath = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-full.json');
  const brief = loadBrief(briefPath);

  const result = await rebrand({ inputHtml: inputPath, brief });

  const out = fs.readFileSync(result.outputHtml, 'utf-8');

  // brand.name replaced source_name
  assert.match(out, /Atelier Noma/, 'brand name replaced');
  // palette map applied
  assert.match(out, /color:\s*#0F1A2B/, 'palette color mapped');
  // typography applied (display for h1, primary for body)
  assert.match(out, /font-family:\s*Playfair Display/, 'display font applied to h1');
  assert.match(out, /font-family:\s*Inter/, 'primary font applied to body');
  // Google Fonts link injected
  assert.match(out, /fonts\.googleapis\.com/, 'google fonts link');
  // images transformer ran (either applied or warned about missing ./assets/new-hero.jpg)
  const imgReport = result.reports.find(r => r.name === 'images')!;
  assert.ok(imgReport.warnings.length > 0 || imgReport.applied > 0, 'image transformer ran');

  // metadata sidecar
  const meta = JSON.parse(fs.readFileSync(result.metadataPath, 'utf-8'));
  assert.strictEqual(meta.brandName, 'Atelier Noma');
  assert.strictEqual(meta.reports.length, 5);
});
