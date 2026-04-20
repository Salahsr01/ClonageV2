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
        if (!styleParts.some(s => s.startsWith('display:'))) {
          const d = computed.getPropertyValue('display');
          if (d) styleParts.push(`display:${d}`);
        }

        const tag = node.tagName.toLowerCase();
        const attrs: string[] = [];
        for (const attr of Array.from(node.attributes)) {
          if (attr.name === 'style') continue;
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
