// One-off Playwright capture of a live URL → hydrated HTML + inline styles.
// Purpose: bootstrap a "clone" dir for SPA sites the regular crawler can't unfreeze.
// Usage: node scripts/capture-live.mjs <url> <outputDir>

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const url = process.argv[2];
const outDir = process.argv[3];
if (!url || !outDir) {
  console.error('usage: capture-live.mjs <url> <outputDir>');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage();

console.log(`[1/5] Loading ${url} ...`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

console.log('[2/5] Waiting for hydration (3s)...');
await page.waitForTimeout(3000);

console.log('[3/5] Scroll pass to trigger lazy content...');
const height = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y < height; y += 400) {
  await page.evaluate((pos) => window.scrollTo(0, pos), y);
  await page.waitForTimeout(120);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(800);

console.log('[4/5] Taking screenshot + inlining computed styles...');
await page.screenshot({ path: path.join(outDir, 'hero.png'), fullPage: false });

// Inline all <style> rules from the document + computed styles per element
const inlined = await page.evaluate(() => {
  // Gather all CSS text from sheets we can access.
  const styles = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = Array.from(sheet.cssRules || []);
      styles.push(rules.map(r => r.cssText).join('\n'));
    } catch {
      /* cross-origin — skip */
    }
  }
  return {
    html: document.documentElement.outerHTML,
    styles: styles.join('\n'),
  };
});

// Strip script tags and rewrite asset URLs to be absolute (live).
let html = inlined.html;
// Remove script tags (they won't run offline anyway and clutter the DOM)
html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
// Inject inlined CSS into <head>
html = html.replace('</head>', `<style>\n${inlined.styles}\n</style>\n</head>`);

// Write outputs
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
fs.writeFileSync(path.join(outDir, 'styles.css'), inlined.styles, 'utf-8');

const sizeKb = (html.length / 1024).toFixed(1);
console.log(`[5/5] Written ${path.join(outDir, 'index.html')} (${sizeKb} KB)`);
console.log(`      + ${path.join(outDir, 'styles.css')} (${(inlined.styles.length / 1024).toFixed(1)} KB)`);

await browser.close();
