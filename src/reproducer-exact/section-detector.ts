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
