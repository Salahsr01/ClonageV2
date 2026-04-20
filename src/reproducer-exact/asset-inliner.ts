import type { Page } from 'playwright';

export interface InlineResult {
  /** HTML fragment for <head> — contains an inlined @font-face <style> block, if any. */
  headStyles: string;
  /** The input subtree HTML with <img src> rewritten to data: URLs where possible. */
  subtreeHtml: string;
  /** Count of successfully inlined assets, for metadata. */
  inlined: { fonts: number; images: number };
  /** Count of assets that failed to fetch; stayed as external URLs. */
  failed: { fonts: number; images: number };
}

/**
 * Inline the page's @font-face fonts and the subtree's <img> sources as data: URLs.
 * Runs inside Playwright; uses the browser's fetch (same origin rules of the page).
 *
 * @param page  Playwright Page, already navigated to the cloned site.
 * @param subtreeHtml  HTML string produced by snapshotSubtree().
 */
export async function inlineAssets(page: Page, subtreeHtml: string): Promise<InlineResult> {
  // 1) Collect all @font-face sources + URLs from the page's stylesheets
  const fontFaces = await page.evaluate(() => {
    const results: { rule: string; urls: string[] }[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRule[] = [];
      try { rules = Array.from(sheet.cssRules || []); } catch { continue; /* cross-origin */ }
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          const text = rule.cssText;
          const urls: string[] = [];
          const re = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            const abs = new URL(m[2], document.baseURI).href;
            if (abs.startsWith('http') || abs.startsWith('file:')) urls.push(abs);
          }
          results.push({ rule: text, urls });
        }
      }
    }
    return results;
  });

  let fontsInlined = 0;
  let fontsFailed = 0;
  const fontRuleRewrites: string[] = [];

  for (const face of fontFaces) {
    let rewritten = face.rule;
    for (const url of face.urls) {
      const dataUrl = await fetchAsDataUrl(page, url);
      if (dataUrl) {
        rewritten = rewritten.split(url).join(dataUrl);
        fontsInlined++;
      } else {
        fontsFailed++;
      }
    }
    fontRuleRewrites.push(rewritten);
  }

  const headStyles = fontRuleRewrites.length
    ? `<style data-inlined="fonts">\n${fontRuleRewrites.join('\n')}\n</style>`
    : '';

  // 2) Rewrite <img src="…"> inside the subtree
  const imgUrls = new Set<string>();
  const imgRe = /<img\b[^>]*\bsrc=(['"])([^'"]+)\1/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(subtreeHtml)) !== null) {
    imgUrls.add(match[2]);
  }

  const imgReplacements = new Map<string, string>();
  let imagesInlined = 0;
  let imagesFailed = 0;

  for (const src of imgUrls) {
    if (src.startsWith('data:')) continue; // already inline
    const absolute = await page.evaluate((s) => new URL(s, document.baseURI).href, src);
    const dataUrl = await fetchAsDataUrl(page, absolute);
    if (dataUrl) {
      imgReplacements.set(src, dataUrl);
      imagesInlined++;
    } else {
      imagesFailed++;
    }
  }

  let rewrittenSubtree = subtreeHtml;
  for (const [orig, data] of imgReplacements) {
    rewrittenSubtree = rewrittenSubtree.split(`src="${orig}"`).join(`src="${data}"`);
    rewrittenSubtree = rewrittenSubtree.split(`src='${orig}'`).join(`src='${data}'`);
  }

  return {
    headStyles,
    subtreeHtml: rewrittenSubtree,
    inlined: { fonts: fontsInlined, images: imagesInlined },
    failed: { fonts: fontsFailed, images: imagesFailed },
  };
}

/**
 * Fetch a URL from the page context and return a base64 `data:` URL, or null on failure.
 */
async function fetchAsDataUrl(page: Page, url: string): Promise<string | null> {
  try {
    return await page.evaluate(async (u) => {
      try {
        const res = await fetch(u);
        if (!res.ok) return null;
        const blob = await res.blob();
        const buf = await blob.arrayBuffer();
        // Base64 encode
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const mime = blob.type || 'application/octet-stream';
        return `data:${mime};base64,${base64}`;
      } catch { return null; }
    }, url);
  } catch {
    return null;
  }
}
