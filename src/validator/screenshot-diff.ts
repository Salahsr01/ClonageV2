import * as fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  width: number;
  height: number;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  diffPngPath?: string;
}

/**
 * Compare two PNG files. Returns the diff ratio (0..1). Optionally writes a
 * diff image to `outPath`.
 *
 * Threshold semantics match the rebrand test suite's `diffPng`: 0.1 is the
 * per-pixel match tolerance (similar pixels are ignored); the reported
 * diffRatio is diffPixels / totalPixels.
 */
export function diffPng(actualPath: string, expectedPath: string, outPath?: string): DiffResult {
  const a = PNG.sync.read(fs.readFileSync(actualPath));
  const b = PNG.sync.read(fs.readFileSync(expectedPath));

  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const total = width * height;
  if (total === 0) {
    return { width: 0, height: 0, diffPixels: 0, totalPixels: 0, diffRatio: 0 };
  }

  const diff = new PNG({ width, height });
  const aData = cropToSize(a, width, height);
  const bData = cropToSize(b, width, height);
  const diffPixels = pixelmatch(aData, bData, diff.data, width, height, { threshold: 0.1 });

  let diffPngPath: string | undefined;
  if (outPath) {
    fs.writeFileSync(outPath, PNG.sync.write(diff));
    diffPngPath = outPath;
  }

  return {
    width,
    height,
    diffPixels,
    totalPixels: total,
    diffRatio: diffPixels / total,
    diffPngPath,
  };
}

function cropToSize(png: PNG, width: number, height: number): Buffer {
  if (png.width === width && png.height === height) return png.data;
  // Copy the top-left region. Our use-case is usually same-size already.
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * width + x) * 4;
      out[dstIdx] = png.data[srcIdx];
      out[dstIdx + 1] = png.data[srcIdx + 1];
      out[dstIdx + 2] = png.data[srcIdx + 2];
      out[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }
  return out;
}
