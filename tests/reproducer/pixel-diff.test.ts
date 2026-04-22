import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { diffPng } from './pixel-diff.js';

const TMP = '/tmp/pixel-diff-test';

test('diffPng retourne 0% pour images identiques', () => {
  fs.mkdirSync(TMP, { recursive: true });
  const png = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 255; png.data[i+1] = 0; png.data[i+2] = 0; png.data[i+3] = 255;
  }
  const p = path.join(TMP, 'a.png');
  fs.writeFileSync(p, PNG.sync.write(png));
  const result = diffPng(p, p);
  assert.strictEqual(result.diffPixels, 0);
  assert.strictEqual(result.diffRatio, 0);
});

test('diffPng retourne ~100% pour images totalement différentes', () => {
  fs.mkdirSync(TMP, { recursive: true });
  const red = new PNG({ width: 10, height: 10 });
  const blue = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < red.data.length; i += 4) {
    red.data[i] = 255; red.data[i+1] = 0; red.data[i+2] = 0; red.data[i+3] = 255;
    blue.data[i] = 0; blue.data[i+1] = 0; blue.data[i+2] = 255; blue.data[i+3] = 255;
  }
  const pA = path.join(TMP, 'red.png');
  const pB = path.join(TMP, 'blue.png');
  fs.writeFileSync(pA, PNG.sync.write(red));
  fs.writeFileSync(pB, PNG.sync.write(blue));
  const result = diffPng(pA, pB);
  assert.ok(result.diffRatio > 0.9, `expected >90% diff, got ${result.diffRatio}`);
});

test('diffPng expose les dimensions originales quand sizes diffèrent', () => {
  fs.mkdirSync(TMP, { recursive: true });
  const small = new PNG({ width: 10, height: 10 });
  const large = new PNG({ width: 12, height: 12 });
  // Fill both with same red pattern
  for (let i = 0; i < small.data.length; i += 4) {
    small.data[i] = 255; small.data[i+1] = 0; small.data[i+2] = 0; small.data[i+3] = 255;
  }
  for (let i = 0; i < large.data.length; i += 4) {
    large.data[i] = 255; large.data[i+1] = 0; large.data[i+2] = 0; large.data[i+3] = 255;
  }
  const pS = path.join(TMP, 'small.png');
  const pL = path.join(TMP, 'large.png');
  fs.writeFileSync(pS, PNG.sync.write(small));
  fs.writeFileSync(pL, PNG.sync.write(large));

  const result = diffPng(pS, pL);

  // Compared region = min size (10x10)
  assert.strictEqual(result.width, 10);
  assert.strictEqual(result.height, 10);
  assert.strictEqual(result.totalPixels, 100);

  // Original sizes preserved
  assert.strictEqual(result.originalWidthA, 10);
  assert.strictEqual(result.originalHeightA, 10);
  assert.strictEqual(result.originalWidthB, 12);
  assert.strictEqual(result.originalHeightB, 12);

  // Region commune est identique (red) → diffRatio = 0
  assert.strictEqual(result.diffRatio, 0);
});

test('diffPng écrit outputDiffPath quand fourni', () => {
  fs.mkdirSync(TMP, { recursive: true });
  const red = new PNG({ width: 10, height: 10 });
  const blue = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < red.data.length; i += 4) {
    red.data[i] = 255; red.data[i+1] = 0; red.data[i+2] = 0; red.data[i+3] = 255;
    blue.data[i] = 0; blue.data[i+1] = 0; blue.data[i+2] = 255; blue.data[i+3] = 255;
  }
  const pA = path.join(TMP, 'red2.png');
  const pB = path.join(TMP, 'blue2.png');
  const pDiff = path.join(TMP, 'diff.png');
  fs.writeFileSync(pA, PNG.sync.write(red));
  fs.writeFileSync(pB, PNG.sync.write(blue));

  // Remove if exists from previous run
  try { fs.unlinkSync(pDiff); } catch {}

  const result = diffPng(pA, pB, pDiff);

  assert.ok(result.diffPixels > 0);
  assert.ok(fs.existsSync(pDiff), 'diff PNG should exist at outputDiffPath');

  // Verify it's a valid PNG we can read back
  const diffImg = PNG.sync.read(fs.readFileSync(pDiff));
  assert.strictEqual(diffImg.width, 10);
  assert.strictEqual(diffImg.height, 10);
});
