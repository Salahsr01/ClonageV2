import * as fs from 'fs';
import * as path from 'path';
import type { Page } from 'playwright';
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface VerifyOptions {
  viewport: { width: number; height: number };
  diffThreshold: number;
}

export interface VerifyResult {
  sourceScreenshot: string;
  outputScreenshot: string;
  diffImage: string;
  diffRatio: number;
  diffPixels: number;
  totalPixels: number;
}

/**
 * Screenshot the source section (in the already-loaded Playwright page) and the
 * reproduced HTML file (in a fresh browser context), then pixel-diff the two PNGs.
 */
export async function verifyVisual(
  sourcePage: Page,
  sectionSelector: string,
  outputHtmlPath: string,
  opts: VerifyOptions
): Promise<VerifyResult> {
  const outputDir = path.dirname(outputHtmlPath);
  const sourceShotPath = path.join(outputDir, '_source.png');
  const outputShotPath = path.join(outputDir, '_output.png');
  const diffShotPath = path.join(outputDir, '_diff.png');

  // 1) Screenshot the source section in the live page
  const sourceLocator = sourcePage.locator(sectionSelector).first();
  await sourceLocator.screenshot({ path: sourceShotPath, type: 'png' });

  // 2) Open the output HTML in a fresh browser and screenshot its first body child
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: opts.viewport });
    await page.goto(`file://${path.resolve(outputHtmlPath)}`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(500);
    const locator = page.locator('body > *').first();
    await locator.screenshot({ path: outputShotPath, type: 'png' });
  } finally {
    await browser.close();
  }

  // 3) Pixel-diff (crop to common dimensions, same pattern as tests/reproducer/pixel-diff.ts)
  const a = PNG.sync.read(fs.readFileSync(sourceShotPath));
  const b = PNG.sync.read(fs.readFileSync(outputShotPath));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const ca = cropPng(a, width, height);
  const cb = cropPng(b, width, height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold: 0.1, includeAA: true });
  fs.writeFileSync(diffShotPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  return {
    sourceScreenshot: sourceShotPath,
    outputScreenshot: outputShotPath,
    diffImage: diffShotPath,
    diffRatio: diffPixels / totalPixels,
    diffPixels,
    totalPixels,
  };
}

function cropPng(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);
  return out;
}
