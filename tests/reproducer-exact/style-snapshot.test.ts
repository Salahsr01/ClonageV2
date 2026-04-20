import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { chromium } from 'playwright';
import { snapshotSubtree, LAYOUT_CRITICAL_PROPS } from '../../src/reproducer-exact/style-snapshot.js';

const FIXTURE = 'file://' + path.resolve(process.cwd(), 'tests/reproducer-exact/fixtures/sample-hero.html');

test('snapshotSubtree inlines key layout properties on the hero subtree', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(FIXTURE, { waitUntil: 'load' });

  const html = await snapshotSubtree(page, 'section.hero');

  assert.ok(html.startsWith('<section'), 'output should start with <section');
  assert.match(html, /style="/, 'nodes should carry inline style attributes');
  assert.match(html, /font-size:\s*72px/, 'h1 font-size should be preserved');
  assert.match(html, /background-image:\s*linear-gradient/, 'gradient bg should be preserved');
  assert.ok(html.includes('Fixture Hero Title'), 'text content preserved');

  await browser.close();
});

test('LAYOUT_CRITICAL_PROPS covers at least 35 properties', () => {
  assert.ok(LAYOUT_CRITICAL_PROPS.length >= 35, `expected ≥35, got ${LAYOUT_CRITICAL_PROPS.length}`);
});
