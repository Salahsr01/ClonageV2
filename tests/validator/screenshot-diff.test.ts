import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PNG } from 'pngjs';
import { diffPng } from '../../src/validator/screenshot-diff.js';

function mkPng(color: [number, number, number, number], w = 50, h = 50): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      png.data[idx] = color[0];
      png.data[idx + 1] = color[1];
      png.data[idx + 2] = color[2];
      png.data[idx + 3] = color[3];
    }
  }
  return PNG.sync.write(png);
}

function mkTmpFile(bytes: Buffer, name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-diff-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

test('diffPng returns 0 ratio for identical images', () => {
  const a = mkTmpFile(mkPng([100, 100, 100, 255]), 'a.png');
  const b = mkTmpFile(mkPng([100, 100, 100, 255]), 'b.png');
  const d = diffPng(a, b);
  assert.strictEqual(d.diffRatio, 0);
  assert.strictEqual(d.diffPixels, 0);
});

test('diffPng returns ~1 ratio for totally different images', () => {
  const a = mkTmpFile(mkPng([0, 0, 0, 255]), 'a.png');
  const b = mkTmpFile(mkPng([255, 255, 255, 255]), 'b.png');
  const d = diffPng(a, b);
  assert.ok(d.diffRatio > 0.95);
});

test('diffPng writes diff image when outPath is given', () => {
  const a = mkTmpFile(mkPng([0, 0, 0, 255]), 'a.png');
  const b = mkTmpFile(mkPng([255, 255, 255, 255]), 'b.png');
  const out = path.join(path.dirname(a), 'diff.png');
  const d = diffPng(a, b, out);
  assert.strictEqual(d.diffPngPath, out);
  assert.ok(fs.existsSync(out));
});

test('diffPng crops to the smaller image if sizes differ', () => {
  const a = mkTmpFile(mkPng([0, 0, 0, 255], 50, 50), 'a.png');
  const b = mkTmpFile(mkPng([0, 0, 0, 255], 70, 50), 'b.png');
  const d = diffPng(a, b);
  assert.strictEqual(d.width, 50);
  assert.strictEqual(d.diffPixels, 0);
});
