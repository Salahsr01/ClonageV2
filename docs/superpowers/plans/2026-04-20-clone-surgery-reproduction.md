# Clone-Surgery Reproduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, LLM-free `reproduce-exact` CLI command that produces a pixel-perfect self-contained HTML file from an already-cloned website section.

**Architecture:** Playwright loads the cloned site from a local `file://` path. A section detector (LCP-based with manual CSS-selector fallback) identifies the target subtree. A style-snapshotter walks every descendant and writes computed styles into inline `style` attributes. A `freeze-dry` wrapper inlines fonts and assets. A visual-verification step screenshots source and output and reports a pixel-diff ratio.

**Tech Stack:** TypeScript 6, Node 20+, Playwright 1.59 (existing), `freeze-dry` (new npm dep), `pixelmatch` + `pngjs` (already installed), Commander (existing CLI framework), `node:test` (existing test runner).

**Spec reference:** `docs/tech-spec-clone-surgery-2026-04-20.md`

---

## File Structure

New module at `src/reproducer-exact/` with focused files:

| File | Responsibility |
|---|---|
| `src/reproducer-exact/types.ts` | Shared interfaces (`ReproduceExactOptions`, `ReproduceExactResult`, `SectionCandidate`) |
| `src/reproducer-exact/section-detector.ts` | LCP detection + selector resolution inside a Playwright page |
| `src/reproducer-exact/style-snapshot.ts` | Walk subtree, inline `getComputedStyle` values on each node |
| `src/reproducer-exact/freeze-dry-wrapper.ts` | Adapter around `freeze-dry`; subtree-scoping; asset inlining |
| `src/reproducer-exact/verify.ts` | Screenshot + `pixelmatch` diff |
| `src/reproducer-exact/index.ts` | Orchestrator: `reproduceExact(options)` entry point |
| `src/cli.ts` | *Modify* — add `reproduce-exact` subcommand |
| `tests/reproducer-exact/section-detector.test.ts` | Unit tests for selector resolution logic |
| `tests/reproducer-exact/style-snapshot.test.ts` | Unit tests for computed-style serialization |
| `tests/reproducer-exact/e2e.test.ts` | End-to-end test against a fixture HTML file |
| `tests/reproducer-exact/fixtures/sample-hero.html` | Minimal hero fixture for deterministic E2E |

No existing files are modified except `src/cli.ts` (command registration) and `package.json` (one new dep).

---

## Task 1: Bootstrap the module and install freeze-dry

**Files:**
- Modify: `package.json` (add `freeze-dry` dep)
- Create: `src/reproducer-exact/types.ts`
- Create: `src/reproducer-exact/index.ts` (stub)
- Create: `tests/reproducer-exact/bootstrap.test.ts`

- [ ] **Step 1.1: Install freeze-dry**

Run from project root:

```bash
cd /Users/salah/Desktop/Clonage && npm install freeze-dry@^0.5.0
```

Expected: `package.json` and `package-lock.json` updated; no error.

- [ ] **Step 1.2: Write types.ts**

Create `src/reproducer-exact/types.ts`:

```ts
export interface ReproduceExactOptions {
  clonePath: string;
  entryFile?: string;
  section?: string;
  outputDir: string;
  viewport?: { width: number; height: number };
  diffThreshold?: number;
}

export interface ReproduceExactResult {
  outputHtml: string;
  assetsDir?: string;
  metadataPath: string;
  diffScore: number;
  passed: boolean;
  sectionSelector: string;
  detectionMethod: 'lcp' | 'selector' | 'fallback';
}

export interface SectionCandidate {
  selector: string;
  method: 'lcp' | 'selector' | 'fallback';
  boundingBox: { x: number; y: number; width: number; height: number };
  lcpSize?: number;
  viewportCoverage: number;
  runnerUp?: { selector: string; viewportCoverage: number };
}
```

- [ ] **Step 1.3: Write index.ts stub**

Create `src/reproducer-exact/index.ts`:

```ts
import { ReproduceExactOptions, ReproduceExactResult } from './types.js';

export async function reproduceExact(
  _options: ReproduceExactOptions
): Promise<ReproduceExactResult> {
  throw new Error('Not implemented yet');
}
```

- [ ] **Step 1.4: Write the failing bootstrap test**

Create `tests/reproducer-exact/bootstrap.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { reproduceExact } from '../../src/reproducer-exact/index.js';

test('reproduceExact throws "Not implemented yet" before Task 5', async () => {
  await assert.rejects(
    reproduceExact({ clonePath: '/tmp/nope', outputDir: '/tmp/out' }),
    /Not implemented yet/
  );
});
```

- [ ] **Step 1.5: Run the test to verify it passes**

Run:
```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="Not implemented"
```

Expected: `PASS` (the stub throws as expected).

- [ ] **Step 1.6: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git init 2>/dev/null; git add package.json package-lock.json src/reproducer-exact tests/reproducer-exact/bootstrap.test.ts && git commit -m "chore(reproducer-exact): scaffold module + freeze-dry dep"
```

Expected: commit created. (If `git init` was needed, `git config user.name/email` may also be required — ask user if commit fails with identity error.)

---

## Task 2: Section Detector — CSS-selector resolution path

**Files:**
- Create: `src/reproducer-exact/section-detector.ts`
- Create: `tests/reproducer-exact/section-detector.test.ts`
- Create: `tests/reproducer-exact/fixtures/sample-hero.html`

Start with the simpler, deterministic path (explicit selector). LCP-based auto-detection comes in Task 3.

- [ ] **Step 2.1: Create the fixture HTML**

Create `tests/reproducer-exact/fixtures/sample-hero.html`:

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Fixture</title>
<style>
  body { margin: 0; font-family: sans-serif; }
  nav { height: 80px; background: #111; color: #fff; display: flex; align-items: center; padding: 0 24px; }
  section.hero { min-height: 90vh; background: linear-gradient(135deg, #f0e6d2, #d4a574); display: flex; align-items: center; justify-content: center; }
  section.hero h1 { font-size: 72px; color: #2a1810; letter-spacing: -0.02em; }
  footer { height: 200px; background: #222; color: #aaa; padding: 32px; }
</style>
</head>
<body>
<nav>LOGO</nav>
<section class="hero" id="hero"><h1>Fixture Hero Title</h1></section>
<footer>© Fixture</footer>
</body>
</html>
```

- [ ] **Step 2.2: Write the failing test for explicit-selector resolution**

Create `tests/reproducer-exact/section-detector.test.ts`:

```ts
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
```

- [ ] **Step 2.3: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="detectSection"
```

Expected: `FAIL` — module `section-detector` doesn't export `detectSection` / `NAMED_ALIAS_SELECTORS`.

- [ ] **Step 2.4: Implement section-detector.ts (selector path only)**

Create `src/reproducer-exact/section-detector.ts`:

```ts
import type { Page } from 'playwright';
import type { SectionCandidate } from './types.js';

export const NAMED_ALIAS_SELECTORS: Record<string, string[]> = {
  hero: ['section.hero', '#hero', '[data-section="hero"]', 'header + section', 'main > section:first-of-type', 'body > section:first-of-type'],
  header: ['header', 'nav', '[role="banner"]'],
  footer: ['footer', '[role="contentinfo"]'],
  nav: ['nav', '[role="navigation"]'],
};

export interface DetectOptions {
  section?: string;
}

export async function detectSection(page: Page, opts: DetectOptions): Promise<SectionCandidate> {
  if (opts.section) {
    const alias = NAMED_ALIAS_SELECTORS[opts.section];
    if (alias) {
      for (const sel of alias) {
        const box = await getBoundingBox(page, sel);
        if (box) return toCandidate(sel, 'selector', box, page);
      }
      throw new Error(`No element found for named alias "${opts.section}" (tried ${alias.join(', ')})`);
    }

    const box = await getBoundingBox(page, opts.section);
    if (!box) throw new Error(`Selector "${opts.section}" did not match any element`);
    return toCandidate(opts.section, 'selector', box, page);
  }

  throw new Error('LCP auto-detection not implemented in this task (see Task 3)');
}

async function getBoundingBox(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

async function toCandidate(
  selector: string,
  method: 'lcp' | 'selector' | 'fallback',
  box: { x: number; y: number; width: number; height: number },
  page: Page
): Promise<SectionCandidate> {
  const viewport = page.viewportSize() || { width: 1920, height: 1080 };
  const viewportCoverage = (box.width * box.height) / (viewport.width * viewport.height);
  return { selector, method, boundingBox: box, viewportCoverage };
}
```

- [ ] **Step 2.5: Run tests to verify they pass**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="detectSection"
```

Expected: both `detectSection` tests `PASS`.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/reproducer-exact/section-detector.ts tests/reproducer-exact/section-detector.test.ts tests/reproducer-exact/fixtures/ && git commit -m "feat(reproducer-exact): section detector — explicit selector + named aliases"
```

---

## Task 3: Section Detector — LCP-based auto-detection

**Files:**
- Modify: `src/reproducer-exact/section-detector.ts`
- Modify: `tests/reproducer-exact/section-detector.test.ts`

- [ ] **Step 3.1: Add the failing LCP test**

Append to `tests/reproducer-exact/section-detector.test.ts`:

```ts
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
```

- [ ] **Step 3.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="auto-detects via LCP"
```

Expected: `FAIL` — the current implementation throws `'LCP auto-detection not implemented'`.

- [ ] **Step 3.3: Implement LCP auto-detection**

Replace the `throw` at the bottom of `detectSection` in `src/reproducer-exact/section-detector.ts` with a call to `detectByLcp(page)` and add the new helper. Final file:

```ts
import type { Page } from 'playwright';
import type { SectionCandidate } from './types.js';

export const NAMED_ALIAS_SELECTORS: Record<string, string[]> = {
  hero: ['section.hero', '#hero', '[data-section="hero"]', 'header + section', 'main > section:first-of-type', 'body > section:first-of-type'],
  header: ['header', 'nav', '[role="banner"]'],
  footer: ['footer', '[role="contentinfo"]'],
  nav: ['nav', '[role="navigation"]'],
};

export interface DetectOptions {
  section?: string;
}

export async function detectSection(page: Page, opts: DetectOptions): Promise<SectionCandidate> {
  if (opts.section) {
    const alias = NAMED_ALIAS_SELECTORS[opts.section];
    if (alias) {
      for (const sel of alias) {
        const box = await getBoundingBox(page, sel);
        if (box) return toCandidate(sel, 'selector', box, page);
      }
      throw new Error(`No element found for named alias "${opts.section}" (tried ${alias.join(', ')})`);
    }
    const box = await getBoundingBox(page, opts.section);
    if (!box) throw new Error(`Selector "${opts.section}" did not match any element`);
    return toCandidate(opts.section, 'selector', box, page);
  }

  return detectByLcp(page);
}

async function detectByLcp(page: Page): Promise<SectionCandidate> {
  // Use PerformanceObserver to capture LCP, then walk up to nearest section-like ancestor.
  const result = await page.evaluate(() => {
    return new Promise<{ selector: string; size: number; box: { x: number; y: number; width: number; height: number } } | null>((resolve) => {
      let resolved = false;
      const timeoutId = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 3000);

      try {
        const obs = new PerformanceObserver((list) => {
          const entries = list.getEntries() as any[];
          const last = entries[entries.length - 1];
          if (!last || !last.element) return;
          const el = last.element as HTMLElement;
          const container = findSectionContainer(el);
          const sel = uniqueSelector(container);
          const r = container.getBoundingClientRect();
          const box = { x: r.x, y: r.y, width: r.width, height: r.height };
          if (!resolved) { resolved = true; clearTimeout(timeoutId); obs.disconnect(); resolve({ selector: sel, size: last.size ?? 0, box }); }
        });
        obs.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        clearTimeout(timeoutId); resolve(null);
      }

      function findSectionContainer(node: HTMLElement): HTMLElement {
        let cur: HTMLElement | null = node;
        while (cur && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          if (['section', 'header', 'main', 'article', 'aside', 'footer'].includes(tag)) return cur;
          cur = cur.parentElement;
        }
        return node;
      }

      function uniqueSelector(el: HTMLElement): string {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const tag = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).filter(c => c && !/[:\[]/.test(c)).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
          if (cls) return tag + cls;
        }
        return tag;
      }
    });
  });

  if (!result) {
    // Fallback: first section-like block with height >= 50vh below the top
    const fallback = await page.evaluate(() => {
      const tags = ['section', 'header', 'main', 'article'];
      for (const tag of tags) {
        const els = Array.from(document.querySelectorAll(tag)) as HTMLElement[];
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.height >= window.innerHeight * 0.5 && r.top < window.innerHeight) {
            return { selector: el.id ? `#${el.id}` : tag + (el.className ? '.' + (el.className as string).trim().split(/\s+/)[0] : ''), box: { x: r.x, y: r.y, width: r.width, height: r.height } };
          }
        }
      }
      return null;
    });
    if (!fallback) throw new Error('Could not auto-detect a section — pass --section explicitly');
    return toCandidate(fallback.selector, 'fallback', fallback.box, page);
  }

  return toCandidate(result.selector, 'lcp', result.box, page, result.size);
}

async function getBoundingBox(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = (el as HTMLElement).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

async function toCandidate(
  selector: string,
  method: 'lcp' | 'selector' | 'fallback',
  box: { x: number; y: number; width: number; height: number },
  page: Page,
  lcpSize?: number
): Promise<SectionCandidate> {
  const viewport = page.viewportSize() || { width: 1920, height: 1080 };
  const viewportCoverage = (box.width * box.height) / (viewport.width * viewport.height);
  return { selector, method, boundingBox: box, viewportCoverage, lcpSize };
}
```

- [ ] **Step 3.4: Run all section-detector tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="detectSection"
```

Expected: all 3 tests `PASS`.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/reproducer-exact/section-detector.ts tests/reproducer-exact/section-detector.test.ts && git commit -m "feat(reproducer-exact): LCP-based auto-detection with fallback"
```

---

## Task 4: Style Snapshotter — inline computed styles on every descendant

**Files:**
- Create: `src/reproducer-exact/style-snapshot.ts`
- Create: `tests/reproducer-exact/style-snapshot.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `tests/reproducer-exact/style-snapshot.test.ts`:

```ts
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
```

- [ ] **Step 4.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="snapshotSubtree|LAYOUT_CRITICAL"
```

Expected: `FAIL` — module doesn't exist.

- [ ] **Step 4.3: Implement style-snapshot.ts**

Create `src/reproducer-exact/style-snapshot.ts`:

```ts
import type { Page } from 'playwright';

export const LAYOUT_CRITICAL_PROPS: readonly string[] = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration',
  'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'border', 'border-radius', 'box-shadow',
  'opacity', 'transform', 'transform-origin',
  'transition', 'animation',
  'overflow', 'cursor', 'visibility',
];

export async function snapshotSubtree(page: Page, rootSelector: string): Promise<string> {
  // Ensure GSAP/scroll-pinned states are settled at top
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  return page.evaluate(
    ({ sel, props }) => {
      const root = document.querySelector(sel);
      if (!root) throw new Error(`snapshot: selector "${sel}" not found`);

      function serialize(node: Element): string {
        const computed = window.getComputedStyle(node);
        const styleParts: string[] = [];
        for (const p of props) {
          const v = computed.getPropertyValue(p);
          if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
            styleParts.push(`${p}:${v}`);
          }
        }
        // Always preserve display if computed (for layout correctness)
        if (!styleParts.some(s => s.startsWith('display:'))) {
          const d = computed.getPropertyValue('display');
          if (d) styleParts.push(`display:${d}`);
        }

        const tag = node.tagName.toLowerCase();
        const attrs: string[] = [];
        for (const attr of Array.from(node.attributes)) {
          if (attr.name === 'style') continue;
          // Keep href/src/alt/role/aria-* but drop data-* noise
          if (attr.name.startsWith('data-') && !/^data-(src|srcset|gsap)/.test(attr.name)) continue;
          attrs.push(`${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`);
        }
        attrs.push(`style="${styleParts.join(';')}"`);

        const voidTags = ['img', 'br', 'hr', 'input', 'source', 'meta', 'link'];
        if (voidTags.includes(tag)) {
          return `<${tag} ${attrs.join(' ')}>`;
        }

        let innerHtml = '';
        node.childNodes.forEach((child) => {
          if (child.nodeType === 3) innerHtml += escapeText((child as Text).data);
          else if (child.nodeType === 1) innerHtml += serialize(child as Element);
        });

        return `<${tag} ${attrs.join(' ')}>${innerHtml}</${tag}>`;
      }

      function escapeText(s: string): string {
        return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
      }

      return serialize(root);
    },
    { sel: rootSelector, props: [...LAYOUT_CRITICAL_PROPS] }
  );
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="snapshotSubtree|LAYOUT_CRITICAL"
```

Expected: both tests `PASS`.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/reproducer-exact/style-snapshot.ts tests/reproducer-exact/style-snapshot.test.ts && git commit -m "feat(reproducer-exact): computed-style snapshotter with layout-critical prop whitelist"
```

---

## Task 5: Freeze-dry wrapper — subtree scoping + asset inlining

**Files:**
- Create: `src/reproducer-exact/freeze-dry-wrapper.ts`

The `freeze-dry` library serializes a full `Document`. To scope it to a subtree, we mutate `document.body` in the page to contain only our target, then call freeze-dry.

- [ ] **Step 5.1: Confirm the freeze-dry bundle path**

Run:
```bash
cd /Users/salah/Desktop/Clonage && node -e "console.log(require.resolve('freeze-dry'))" && ls node_modules/freeze-dry/dist 2>/dev/null || ls node_modules/freeze-dry
```

Expected: output shows the main entry + a `dist/` folder. Note the exact UMD filename (e.g., `freeze-dry.umd.js`, `index.umd.js`, or similar). Use whichever matches in Step 5.2. If no UMD bundle ships, the wrapper falls back to a plain `<script>` tag pointing at the main file — adapt the `require.resolve` call accordingly.

- [ ] **Step 5.2: Write the wrapper**

Create `src/reproducer-exact/freeze-dry-wrapper.ts`:

```ts
import type { Page } from 'playwright';

/**
 * Returns a self-contained HTML string for the subtree matching `rootSelector`.
 * Strategy:
 *   1. In the page, trim <body> to contain only the target subtree (wrapped in the original <html>/<head> preserved).
 *   2. Run freeze-dry's inlining logic to convert external resources to data: URLs.
 *   3. Serialize the resulting document.
 */
export async function freezeDrySubtree(page: Page, rootSelector: string): Promise<string> {
  // Inject freeze-dry UMD into the page
  const freezeDryPath = require.resolve('freeze-dry/dist/freeze-dry.umd.js');
  await page.addScriptTag({ path: freezeDryPath });

  return page.evaluate(async (sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`freeze-dry: selector "${sel}" not found`);

    // Clone the document to avoid mutating the real one, then trim body to target subtree
    const clone = document.cloneNode(true) as Document;
    const cloneRoot = clone.querySelector(sel);
    if (!cloneRoot) throw new Error('freeze-dry: selector not present in clone');

    const newBody = clone.createElement('body');
    // Copy body's attributes (class, data-*) for CSS scoping
    for (const attr of Array.from(clone.body.attributes)) newBody.setAttribute(attr.name, attr.value);
    newBody.appendChild(cloneRoot.cloneNode(true));
    clone.body.replaceWith(newBody);

    // @ts-ignore — injected UMD
    const freezeDry = (window as any).freezeDry as (doc: Document, opts?: any) => Promise<string>;
    if (typeof freezeDry !== 'function') throw new Error('freeze-dry: UMD not loaded');

    const html = await freezeDry(clone, {
      timeout: 30000,
      docUrl: document.URL,
    });
    return html;
  }, rootSelector);
}
```

- [ ] **Step 5.3: Verify TypeScript compiles**

```bash
cd /Users/salah/Desktop/Clonage && npx tsc --noEmit
```

Expected: no errors. If `require.resolve` complains about `module`, add `/// <reference types="node" />` at top of the file.

- [ ] **Step 5.4: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/reproducer-exact/freeze-dry-wrapper.ts && git commit -m "feat(reproducer-exact): freeze-dry wrapper scoped to subtree"
```

(No standalone test in this task — coverage comes from the E2E test in Task 8.)

---

## Task 6: Orchestrator — wire detector + snapshotter + freeze-dry

**Files:**
- Modify: `src/reproducer-exact/index.ts`

- [ ] **Step 6.1: Replace the stub with the full orchestrator**

Replace the contents of `src/reproducer-exact/index.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { ReproduceExactOptions, ReproduceExactResult } from './types.js';
import { detectSection } from './section-detector.js';
import { snapshotSubtree } from './style-snapshot.js';
import { freezeDrySubtree } from './freeze-dry-wrapper.js';
import { verifyVisual } from './verify.js';
import { logger } from '../utils/logger.js';

export async function reproduceExact(options: ReproduceExactOptions): Promise<ReproduceExactResult> {
  const viewport = options.viewport ?? { width: 1920, height: 1080 };
  const entryFile = options.entryFile ?? 'index.html';
  const diffThreshold = options.diffThreshold ?? 0.02;

  const entryPath = path.resolve(options.clonePath, entryFile);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Clone entry file not found: ${entryPath}`);
  }

  fs.mkdirSync(options.outputDir, { recursive: true });

  logger.step(1, 5, 'Lancement du navigateur headless...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });

  try {
    await page.goto(`file://${entryPath}`, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    logger.step(2, 5, 'Detection de la section...');
    const candidate = await detectSection(page, { section: options.section });
    logger.info(`Section: ${candidate.selector} (${candidate.method}, coverage ${(candidate.viewportCoverage * 100).toFixed(1)}%)`);

    logger.step(3, 5, 'Snapshot des styles calcules...');
    const snapshotHtml = await snapshotSubtree(page, candidate.selector);

    logger.step(4, 5, 'Inlining des assets (freeze-dry)...');
    let finalHtml: string;
    try {
      finalHtml = await freezeDrySubtree(page, candidate.selector);
      // Replace freeze-dry's body content with our computed-style-annotated snapshot
      finalHtml = mergeSnapshotIntoFrame(finalHtml, snapshotHtml);
    } catch (err: any) {
      logger.warn(`freeze-dry failed (${err.message}) — using snapshot-only fallback`);
      finalHtml = wrapSnapshotInFrame(snapshotHtml);
    }

    const sectionName = options.section ?? 'auto';
    const outputHtmlPath = path.join(options.outputDir, `${sectionName}.html`);
    fs.writeFileSync(outputHtmlPath, finalHtml, 'utf-8');

    logger.step(5, 5, 'Verification visuelle...');
    const verification = await verifyVisual(page, candidate.selector, outputHtmlPath, {
      viewport,
      diffThreshold,
    });

    const metadata = {
      clonePath: options.clonePath,
      entryFile,
      sectionSelector: candidate.selector,
      detectionMethod: candidate.method,
      boundingBox: candidate.boundingBox,
      viewportCoverage: candidate.viewportCoverage,
      lcpSize: candidate.lcpSize,
      viewport,
      diffScore: verification.diffRatio,
      diffThreshold,
      passed: verification.diffRatio <= diffThreshold,
      timestamp: new Date().toISOString(),
    };
    const metadataPath = path.join(options.outputDir, '_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    if (metadata.passed) logger.success(`Reproduit: ${outputHtmlPath} (diff ${(verification.diffRatio * 100).toFixed(2)}%)`);
    else logger.warn(`Reproduit avec diff ${(verification.diffRatio * 100).toFixed(2)}% > seuil ${(diffThreshold * 100).toFixed(1)}%: ${outputHtmlPath}`);

    return {
      outputHtml: outputHtmlPath,
      metadataPath,
      diffScore: verification.diffRatio,
      passed: metadata.passed,
      sectionSelector: candidate.selector,
      detectionMethod: candidate.method,
    };
  } finally {
    await browser.close();
  }
}

function wrapSnapshotInFrame(snapshot: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0">${snapshot}</body></html>`;
}

function mergeSnapshotIntoFrame(freezeDried: string, snapshot: string): string {
  // freeze-dry gave us <html><head>...assets inlined...</head><body>...original markup...</body></html>
  // Replace body's inner markup with our computed-style snapshot so layout is driven by inline styles,
  // but keep freeze-dry's <head> (for inlined @font-face rules, etc.).
  return freezeDried.replace(/<body[^>]*>[\s\S]*<\/body>/i, `<body style="margin:0">${snapshot}</body>`);
}
```

- [ ] **Step 6.2: TypeScript compile check**

```bash
cd /Users/salah/Desktop/Clonage && npx tsc --noEmit
```

Expected: fails because `./verify.js` doesn't exist yet — that's Task 7. Proceed to Task 7 and return after.

- [ ] **Step 6.3: Commit (after Task 7 compiles)**

After Task 7 passes compile, commit orchestrator + verify together (see Task 7 Step 7.5).

---

## Task 7: Visual verification with pixelmatch

**Files:**
- Create: `src/reproducer-exact/verify.ts`

- [ ] **Step 7.1: Implement verify.ts**

Create `src/reproducer-exact/verify.ts`:

```ts
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

  // 1. Screenshot the source section in the already-loaded page
  const sourceHandle = await sourcePage.locator(sectionSelector).first();
  await sourceHandle.screenshot({ path: sourceShotPath, type: 'png' });

  // 2. Open the output HTML in a second page and screenshot at the same viewport
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

  // 3. Pixel-diff
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
```

- [ ] **Step 7.2: TypeScript compile check**

```bash
cd /Users/salah/Desktop/Clonage && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3: Run existing tests to ensure no regression**

```bash
cd /Users/salah/Desktop/Clonage && npm test
```

Expected: all tests pass (new E2E test added in Task 8 not yet present).

- [ ] **Step 7.4: Commit orchestrator + verify together**

```bash
cd /Users/salah/Desktop/Clonage && git add src/reproducer-exact/index.ts src/reproducer-exact/verify.ts && git commit -m "feat(reproducer-exact): orchestrator + pixel-diff verification"
```

---

## Task 8: CLI command `reproduce-exact`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 8.1: Locate insertion point**

Run:
```bash
cd /Users/salah/Desktop/Clonage && grep -n "program.parse" src/cli.ts
```

Note the line number (typically near end of file). Insert the new command block just before `program.parse`.

- [ ] **Step 8.2: Add the command**

Insert the following above the `program.parse` line in `src/cli.ts`:

```ts
// === REPRODUCE-EXACT command (deterministic, LLM-free) ===
program
  .command('reproduce-exact <clone-path>')
  .description('Reproduction fidele deterministe d\'une section clonee (zero LLM)')
  .option('-s, --section <sel>', 'CSS selector ou alias (hero|header|footer|nav)', 'hero')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated/reproduce-exact')
  .option('-e, --entry <file>', 'Fichier HTML d\'entree dans le clone', 'index.html')
  .option('-w, --width <n>', 'Largeur du viewport', '1920')
  .option('-h, --height <n>', 'Hauteur du viewport', '1080')
  .option('--threshold <n>', 'Seuil pixel-diff (0..1)', '0.02')
  .action(async (clonePath: string, options: any) => {
    try {
      const { reproduceExact } = await import('./reproducer-exact/index.js');
      const result = await reproduceExact({
        clonePath: path.resolve(clonePath),
        section: options.section,
        outputDir: path.resolve(options.output),
        entryFile: options.entry,
        viewport: { width: parseInt(options.width, 10), height: parseInt(options.height, 10) },
        diffThreshold: parseFloat(options.threshold),
      });
      logger.info(`Output: ${result.outputHtml}`);
      logger.info(`Metadata: ${result.metadataPath}`);
      logger.info(`Diff score: ${(result.diffScore * 100).toFixed(2)}%`);
      process.exit(result.passed ? 0 : 1);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 8.3: Build and smoke-test the CLI help**

```bash
cd /Users/salah/Desktop/Clonage && npm run build && node dist/cli.js reproduce-exact --help
```

Expected: the help text displays the new options (`--section`, `--output`, `--entry`, `--width`, `--height`, `--threshold`).

- [ ] **Step 8.4: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/cli.ts && git commit -m "feat(cli): reproduce-exact command"
```

---

## Task 9: End-to-end test on fixture

**Files:**
- Create: `tests/reproducer-exact/e2e.test.ts`

- [ ] **Step 9.1: Write the E2E test**

Create `tests/reproducer-exact/e2e.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { reproduceExact } from '../../src/reproducer-exact/index.js';

test('reproduceExact runs end-to-end on the hero fixture', async () => {
  const fixtureDir = path.resolve(process.cwd(), 'tests/reproducer-exact/fixtures');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-e2e-'));

  const result = await reproduceExact({
    clonePath: fixtureDir,
    entryFile: 'sample-hero.html',
    section: 'section.hero',
    outputDir,
    viewport: { width: 1280, height: 800 },
    diffThreshold: 0.05,
  });

  assert.ok(fs.existsSync(result.outputHtml), `output HTML missing: ${result.outputHtml}`);
  assert.ok(fs.existsSync(result.metadataPath), `metadata missing: ${result.metadataPath}`);

  const meta = JSON.parse(fs.readFileSync(result.metadataPath, 'utf-8'));
  assert.strictEqual(meta.detectionMethod, 'selector');
  assert.ok(typeof meta.diffScore === 'number');

  const html = fs.readFileSync(result.outputHtml, 'utf-8');
  assert.match(html, /Fixture Hero Title/, 'hero title text preserved');
  assert.match(html, /font-size:\s*72px/, 'computed font-size inlined');

  // 5% threshold for fixture (should typically be < 1%)
  assert.ok(result.diffScore < 0.05, `diff score too high: ${(result.diffScore * 100).toFixed(2)}%`);
});
```

- [ ] **Step 9.2: Run the test**

```bash
cd /Users/salah/Desktop/Clonage && npm test -- --test-name-pattern="end-to-end on the hero fixture"
```

Expected: `PASS`. If fails with diff > 5%, inspect `_diff.png` in the temp output dir — likely cause is a missing layout-critical property in the whitelist; add it to `LAYOUT_CRITICAL_PROPS` in `src/reproducer-exact/style-snapshot.ts` and re-run.

- [ ] **Step 9.3: Run the full test suite**

```bash
cd /Users/salah/Desktop/Clonage && npm test
```

Expected: all tests `PASS`.

- [ ] **Step 9.4: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add tests/reproducer-exact/e2e.test.ts && git commit -m "test(reproducer-exact): e2e on hero fixture"
```

---

## Task 10: Validation on real cloned sites

**Files:**
- Create: `docs/tech-spec-clone-surgery-2026-04-20-results.md`

- [ ] **Step 10.1: Run on madeinevolve**

```bash
cd /Users/salah/Desktop/Clonage && node dist/cli.js reproduce-exact ./output/madeinevolve/madeinevolve.com_2026-04-20 --section hero --output ./generated/reproduce-exact/madeinevolve
```

Expected: command exits with code 0 (diff ≤ 2%) or logs a warning with a concrete percentage. Capture the printed `Diff score`.

- [ ] **Step 10.2: Run on mersi-architecture**

```bash
cd /Users/salah/Desktop/Clonage && node dist/cli.js reproduce-exact ./output/www.mersi-architecture.com_2026-04-17 --section hero --output ./generated/reproduce-exact/mersi --threshold 0.05
```

(Threshold raised because mersi has GSAP pinning that may shift computed layout slightly.) Capture score.

- [ ] **Step 10.3: Run on obsidianassembly, jobyaviation, icomat**

```bash
cd /Users/salah/Desktop/Clonage && for site in obsidianassembly.com_2026-04-16 www.jobyaviation.com_2026-04-16 www.icomat.co.uk_2026-04-15; do echo "=== $site ==="; node dist/cli.js reproduce-exact ./output/$site --section hero --output ./generated/reproduce-exact/$site --threshold 0.05 || true; done
```

Expected: each site produces output. Some may fail auto-detection — note those for fallback analysis.

- [ ] **Step 10.4: Write results doc**

Create `docs/tech-spec-clone-surgery-2026-04-20-results.md` with a markdown table:

```markdown
# Clone-Surgery Reproduction — Validation Results (2026-04-20)

| Site | Section (auto/manual) | Detection Method | Diff Score | Passed @ 2% | Notes |
|---|---|---|---|---|---|
| madeinevolve | hero | lcp/selector | X.XX% | ✓/✗ | ... |
| mersi-architecture | hero | ... | X.XX% | ✓/✗ | GSAP pinning consideration |
| obsidianassembly | hero | ... | X.XX% | ✓/✗ | ... |
| jobyaviation | hero | ... | X.XX% | ✓/✗ | ... |
| icomat | hero | ... | X.XX% | ✓/✗ | ... |

## Observations
- (fill based on actual runs)

## Next-Step Recommendations
- (e.g., expand LAYOUT_CRITICAL_PROPS whitelist if a class of diff emerged)
- (e.g., tune LCP fallback if N of 5 sites auto-detect wrong)
```

Fill the table from the commands above.

- [ ] **Step 10.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add docs/tech-spec-clone-surgery-2026-04-20-results.md && git commit -m "docs(reproducer-exact): validation results on 5 reference sites"
```

---

## Self-Review Checklist (to be done after Task 10)

- [ ] Every R1-R8 from the tech-spec maps to at least one task above.
- [ ] No `TODO` / `TBD` / `implement later` in the plan.
- [ ] All function names, types, and selectors referenced in later tasks exist in earlier tasks (e.g., `snapshotSubtree`, `detectSection`, `LAYOUT_CRITICAL_PROPS`, `verifyVisual`).
- [ ] All commands include the `cd /Users/salah/Desktop/Clonage` prefix (the repo is not a git repo at root; Task 1 Step 1.6 initializes it).
- [ ] Test code is concrete (no `// add tests here`), and every step shows real code, not prose.
- [ ] Commits are scoped to the task (one scope per commit, feat/test/docs/chore prefixes).

---

**Plan ready for execution.**
