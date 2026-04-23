import * as cheerio from 'cheerio';

/**
 * Build a compact string representation of the section's DOM for the VLM.
 * Keeps: tag names, class names, data-* attributes, id, role, aria-*.
 * Drops: text content (we send the screenshot for visuals), inline styles,
 * event handlers, script/style contents.
 *
 * Size budget: ~8 KB. Real sections can reach 50+ KB of HTML; we truncate
 * gracefully by collapsing deep subtrees after a depth cap.
 */
export function simplifyDOM(html: string, maxChars = 8000, maxDepth = 6): string {
  const $ = cheerio.load(html, { xml: false });

  const walk = (node: any, depth: number): string => {
    if (node.type === 'text') return '';
    // cheerio + parse5 emit `node.type === 'script' | 'style'` for those tags
    // directly rather than `'tag'`. Accept all three + 'directive'.
    const isElement =
      node.type === 'tag' ||
      node.type === 'script' ||
      node.type === 'style';
    if (!isElement) return '';
    const tag = (node.name || '').toLowerCase();
    if (!tag) return '';

    // Skip non-structural nodes
    if (tag === 'script' || tag === 'style' || tag === 'noscript') {
      return `<${tag}/>`;
    }

    const attrs: string[] = [];
    const keepAttrs = ['id', 'class', 'role', 'data-section', 'data-role', 'aria-label'];
    for (const k of keepAttrs) {
      const v = node.attribs?.[k];
      if (v) attrs.push(`${k}="${String(v).substring(0, 60)}"`);
    }
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

    if (depth >= maxDepth) {
      return `<${tag}${attrStr}>…</${tag}>`;
    }

    const children = (node.children || []).map((c: any) => walk(c, depth + 1)).filter(Boolean).join('');
    if (!children) return `<${tag}${attrStr}/>`;
    return `<${tag}${attrStr}>${children}</${tag}>`;
  };

  const roots = $('body').length ? $('body').contents().toArray() : $.root().contents().toArray();
  let out = roots.map((r) => walk(r, 0)).filter(Boolean).join('');
  if (out.length > maxChars) {
    out = out.substring(0, maxChars) + '…[truncated]';
  }
  return out;
}
