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
