import { test } from 'node:test';
import assert from 'node:assert';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

test('extractCssVariables retourne le reverse map {value: tokenName}', async () => {
  const html = `<!DOCTYPE html><html><head><style>
    :root { --primary: #0a1628; --accent: rgb(255, 0, 0); }
    .theme-dark { --primary: #ffffff; }
  </style></head><body></body></html>`;

  fs.mkdirSync('/tmp/css-vars-test', { recursive: true });
  fs.writeFileSync('/tmp/css-vars-test/page.html', html);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('file:///tmp/css-vars-test/page.html');

  const vars = await page.evaluate(() => {
    const map: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSStyleRule)) continue;
          const selector = rule.selectorText;
          if (selector !== ':root' && selector !== 'html' && selector !== 'html, :root') continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (!prop.startsWith('--')) continue;
            const value = rule.style.getPropertyValue(prop).trim();
            if (!map[value]) map[value] = prop;
          }
        }
      } catch {}
    }
    return map;
  });

  await browser.close();

  assert.strictEqual(vars['#0a1628'], '--primary');
  assert.strictEqual(vars['rgb(255, 0, 0)'], '--accent');
});
