import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

// Mini-helper : crée une page HTML minimale avec ::before
async function makeTestPage(html: string): Promise<string> {
  const dir = '/tmp/reproducer-pseudo-test';
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'page.html');
  fs.writeFileSync(p, html);
  return p;
}

test('captureNode inclut ::before avec content non-vide', async () => {
  const pagePath = await makeTestPage(`<!DOCTYPE html>
<html><head><style>
.badge::before { content: "NEW"; color: red; font-weight: bold; }
</style></head><body>
<div class="badge">Product</div>
</body></html>`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`file://${pagePath}`);

  // Inject the capture helper into the page (mirrors the logic in src/reproducer/index.ts)
  await page.evaluate(() => {
    const PSEUDO_KEY_PROPS = [
      'content', 'display', 'position', 'top', 'right', 'bottom', 'left',
      'width', 'height', 'background-color', 'background-image', 'background-size',
      'color', 'font-size', 'font-weight', 'font-family',
      'border-radius', 'border-top-width', 'border-top-color', 'border-top-style',
      'border-bottom-width', 'border-bottom-color', 'border-bottom-style',
      'border-left-width', 'border-left-color', 'border-left-style',
      'border-right-width', 'border-right-color', 'border-right-style',
      'transform', 'opacity', 'z-index', 'mix-blend-mode', 'filter',
    ];

    function capturePseudoElement(el: Element, pseudo: string): Record<string, string> | undefined {
      const cs = getComputedStyle(el, pseudo);
      const content = cs.getPropertyValue('content');
      if (!content || content === 'none' || content === 'normal') return undefined;
      const out: Record<string, string> = { content };
      for (const prop of PSEUDO_KEY_PROPS) {
        if (prop === 'content') continue;
        const val = cs.getPropertyValue(prop);
        if (!val) continue;
        if (prop === 'background-color' && (val === 'rgba(0, 0, 0, 0)' || val === 'transparent')) continue;
        if (prop === 'background-image' && val === 'none') continue;
        if (prop === 'opacity' && val === '1') continue;
        if (prop.includes('border') && prop.includes('width') && val === '0px') continue;
        if (prop.includes('radius') && val === '0px') continue;
        if ((prop === 'width' || prop === 'height') && val === 'auto') continue;
        if (prop === 'transform' && val === 'none') continue;
        if (prop === 'display' && val === 'inline') continue;
        out[prop] = val;
      }
      return Object.keys(out).length > 1 ? out : undefined;
    }

    (window as any).__captureNodeForTest = (el: Element) => {
      return {
        pseudoBefore: capturePseudoElement(el, '::before'),
        pseudoAfter: capturePseudoElement(el, '::after'),
      };
    };
  });

  const captured = await page.evaluate(() => {
    return (window as any).__captureNodeForTest(document.querySelector('.badge'));
  });

  await browser.close();

  assert.ok(captured.pseudoBefore, 'pseudoBefore should be captured');
  assert.strictEqual(captured.pseudoBefore.content, '"NEW"');
  assert.strictEqual(captured.pseudoBefore['color'], 'rgb(255, 0, 0)');
});
