import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { chromium } from 'playwright';
import { detectSection, NAMED_ALIAS_SELECTORS } from '../../src/reproducer-exact/section-detector.js';

// Fixture lives in the repo at tests/reproducer-exact/fixtures/. `npm test` runs from project root.
const FIXTURE = 'file://' + path.resolve(process.cwd(), 'tests/reproducer-exact/fixtures/sample-hero.html');

test('detectSection resolves an explicit CSS selector', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const candidate = await detectSection(page, { section: 'section.hero' });

  assert.strictEqual(candidate.selector, 'section.hero');
  assert.strictEqual(candidate.method, 'selector');
  assert.ok(candidate.boundingBox.height >= 900, `hero should cover ~90vh, got ${candidate.boundingBox.height}`);

  await browser.close();
});

test('detectSection resolves the "hero" named alias to the hero section', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const candidate = await detectSection(page, { section: 'hero' });

  assert.strictEqual(candidate.method, 'selector');
  assert.ok(
    NAMED_ALIAS_SELECTORS.hero.includes(candidate.selector) || candidate.selector.includes('hero'),
    `expected hero-aliased selector, got ${candidate.selector}`
  );

  await browser.close();
});

test('detectSection auto-detects via LCP when no selector is given', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const candidate = await detectSection(page, {});

  assert.strictEqual(candidate.method, 'lcp');
  assert.ok(
    candidate.selector.includes('hero') || candidate.selector.includes('h1'),
    `expected hero-related selector, got ${candidate.selector}`
  );
  assert.ok(candidate.viewportCoverage > 0.2, `viewport coverage too low: ${candidate.viewportCoverage}`);

  await browser.close();
});
