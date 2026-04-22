import { Page } from 'playwright';
import { ExtractedComponent } from '../types.js';

export async function extractComponents(page: Page, domain: string): Promise<ExtractedComponent[]> {
  const rawComponents = await page.evaluate((domainArg: string) => {
    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    const UTILITY_CLASS_RE = /^(w-|h-|p-|px-|py-|pt-|pb-|pl-|pr-|m-|mx-|my-|mt-|mb-|ml-|mr-|flex|grid|text-|bg-|border-|rounded-|shadow-|opacity-|transition-|duration-|ease-|translate-|scale-|rotate-|transform|overflow-|z-|gap-|space-|col-|row-|justify-|items-|self-|order-|sr-only|hidden|block|inline|absolute|relative|fixed|sticky|static|container|mx-auto)/;

    const SEMANTIC_CLASS_RE = /hero|nav|footer|card|grid|slider|testimonial|cta|feature|about|portfolio|pricing|faq|team|process|stats|contact/i;

    const SEMANTIC_TAGS = new Set(['SECTION', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ARTICLE']);

    function generateSelector(el: Element): string {
      // 1. ID
      if (el.id) {
        return `#${CSS.escape(el.id)}`;
      }

      // 2. Semantic (non-utility) classes
      const classes = Array.from(el.classList).filter(c => !UTILITY_CLASS_RE.test(c));
      if (classes.length > 0) {
        const meaningful = classes.slice(0, 3);
        return meaningful.map(c => `.${CSS.escape(c)}`).join('');
      }

      // 3. Fallback: tag:nth-of-type
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter(s => s.tagName === el.tagName);
      if (siblings.length === 1) return tag;
      const index = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${index})`;
    }

    function getDepth(el: Element): number {
      let depth = 0;
      let current: Element | null = el;
      while (current && current !== document.body) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    }

    function getRect(el: Element): { top: number; left: number; width: number; height: number } {
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top + window.scrollY),
        left: Math.round(r.left + window.scrollX),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    }

    function overlapRatio(a: { top: number; left: number; width: number; height: number },
                          b: { top: number; left: number; width: number; height: number }): number {
      const x1 = Math.max(a.left, b.left);
      const y1 = Math.max(a.top, b.top);
      const x2 = Math.min(a.left + a.width, b.left + b.width);
      const y2 = Math.min(a.top + a.height, b.top + b.height);
      if (x2 <= x1 || y2 <= y1) return 0;
      const intersection = (x2 - x1) * (y2 - y1);
      const areaA = a.width * a.height;
      const areaB = b.width * b.height;
      const smaller = Math.min(areaA, areaB);
      return smaller > 0 ? intersection / smaller : 0;
    }

    function areaOf(r: { width: number; height: number }): number {
      return r.width * r.height;
    }

    // ──────────────────────────────────────────────
    // Step 1: Section Detection
    // ──────────────────────────────────────────────

    const vw = window.innerWidth;
    const detected = new Set<Element>();

    function walkDOM(node: Element) {
      if (!node || node === document.documentElement) return;

      const tag = node.tagName;
      const classList = node.className && typeof node.className === 'string' ? node.className : '';

      // Signal: semantic tags
      if (SEMANTIC_TAGS.has(tag)) {
        detected.add(node);
      }

      // Signal: semantic class names
      if (SEMANTIC_CLASS_RE.test(classList)) {
        detected.add(node);
      }

      // Signal: wide + tall elements (visual section boundary)
      const rect = node.getBoundingClientRect();
      if (rect.width > vw * 0.8 && rect.height > 100) {
        // Styling boundary check
        const style = window.getComputedStyle(node);
        const parentStyle = node.parentElement ? window.getComputedStyle(node.parentElement) : null;

        const hasDifferentBg = parentStyle && style.backgroundColor !== parentStyle.backgroundColor
          && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
        const hasPadding = parseFloat(style.paddingTop) > 16 || parseFloat(style.paddingBottom) > 16;
        const hasBorderOrShadow = style.boxShadow !== 'none' || style.borderTopWidth !== '0px';

        if (hasDifferentBg || hasPadding || hasBorderOrShadow) {
          detected.add(node);
        }
      }

      // Recurse into children (but not too deep for performance)
      for (let i = 0; i < node.children.length; i++) {
        walkDOM(node.children[i]);
      }
    }

    try {
      walkDOM(document.body);
    } catch (_) {
      // Graceful fallback: use direct children of body
      for (let i = 0; i < document.body.children.length; i++) {
        detected.add(document.body.children[i]);
      }
    }

    // ──────────────────────────────────────────────
    // Step 2: Component Classification
    // ──────────────────────────────────────────────

    const CLASS_TYPE_MAP: Array<[RegExp, string]> = [
      [/hero/i, 'hero'],
      [/nav/i, 'navigation'],
      [/footer/i, 'footer'],
      [/portfolio|gallery|work/i, 'portfolio'],
      [/testimonial|review/i, 'testimonials'],
      [/cta|call.?to.?action/i, 'cta'],
      [/feature/i, 'features'],
      [/about/i, 'about'],
      [/contact/i, 'contact'],
      [/slider|carousel|swiper/i, 'slider'],
      [/video/i, 'video-section'],
      [/stat|counter|number/i, 'stats'],
      [/pricing|plan/i, 'pricing'],
      [/faq|accordion/i, 'faq'],
      [/logo|brand|partner|client/i, 'logo-bar'],
      [/card|grid/i, 'card-grid'],
      [/process|step|timeline/i, 'process'],
      [/team|member/i, 'team'],
    ];

    function classifyComponent(el: Element, rect: { top: number; left: number; width: number; height: number }): string {
      const tag = el.tagName;
      const classList = el.className && typeof el.className === 'string' ? el.className : '';
      const isFullWidth = rect.width > vw * 0.8;

      // 1. Position-based
      if (rect.top < 100 && isFullWidth) return 'navigation';

      const hasH1 = el.querySelector('h1') !== null;
      const bodyRect = document.body.getBoundingClientRect();
      const totalHeight = bodyRect.height;

      // First major section with h1
      if (hasH1 && rect.top < totalHeight * 0.3 && isFullWidth) return 'hero';

      // Bottom of page
      if (rect.top + rect.height > totalHeight * 0.9 && isFullWidth) return 'footer';

      // 2. Tag-based
      if (tag === 'NAV') return 'navigation';
      if (tag === 'FOOTER') return 'footer';

      // 3. Class-based
      for (const [regex, type] of CLASS_TYPE_MAP) {
        if (regex.test(classList)) return type;
      }

      // Also check id
      const id = el.id || '';
      for (const [regex, type] of CLASS_TYPE_MAP) {
        if (regex.test(id)) return type;
      }

      // 4. Content-based
      if (el.querySelector('form')) return 'contact';
      if (el.querySelector('video') || el.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]')) return 'video-section';

      // Repeated children pattern detection
      const children = Array.from(el.children);
      if (children.length >= 3) {
        const firstTag = children[0]?.tagName;
        const similarChildren = children.filter(c => c.tagName === firstTag);
        if (similarChildren.length >= 3) {
          const hasImages = similarChildren.some(c => c.querySelector('img') !== null);
          return hasImages ? 'card-grid' : 'features';
        }
      }

      // 5. Default
      return 'content';
    }

    // ──────────────────────────────────────────────
    // Step 3: Metadata Collection
    // ──────────────────────────────────────────────

    interface RawComponent {
      id: string;
      selector: string;
      type: string;
      html: string;
      textPreview: string;
      rect: { top: number; left: number; width: number; height: number };
      childCount: number;
      depth: number;
      meta: {
        hasAnimation: boolean;
        hasVideo: boolean;
        hasImage: boolean;
        hasForm: boolean;
        estimatedHeight: string;
        classes: string[];
      };
    }

    const components: RawComponent[] = [];
    const typeCounters: Record<string, number> = {};

    for (const el of detected) {
      try {
        const rect = getRect(el);

        // Skip invisible or tiny elements
        if (rect.width < 50 || rect.height < 20) continue;

        const type = classifyComponent(el, rect);

        if (!typeCounters[type]) typeCounters[type] = 0;
        const index = typeCounters[type]++;

        const selector = generateSelector(el);

        // Truncate outerHTML to 10000 chars
        let html = '';
        try {
          html = el.outerHTML;
          if (html.length > 10000) {
            html = html.substring(0, 10000) + '<!-- truncated -->';
          }
        } catch (_) {
          html = `<${el.tagName.toLowerCase()}><!-- could not serialize --></${el.tagName.toLowerCase()}>`;
        }

        // Text preview: first 200 chars of textContent
        const textContent = (el.textContent || '').trim().replace(/\s+/g, ' ');
        const textPreview = textContent.substring(0, 200);

        // Child count
        const childCount = el.children.length;

        // Depth from body
        const depth = getDepth(el);

        // Meta: hasAnimation
        let hasAnimation = false;
        try {
          const allEls = [el, ...Array.from(el.querySelectorAll('*'))];
          for (const child of allEls) {
            const cs = window.getComputedStyle(child);
            if (cs.transitionDuration && cs.transitionDuration !== '0s') {
              hasAnimation = true;
              break;
            }
            const childClasses = child.className && typeof child.className === 'string' ? child.className : '';
            if (/anim|gsap|scroll|aos|wow|reveal/i.test(childClasses)) {
              hasAnimation = true;
              break;
            }
          }
        } catch (_) {
          // ignore
        }

        // Meta: hasVideo
        const hasVideo = el.querySelector('video') !== null
          || el.querySelector('iframe[src*="youtube"], iframe[src*="vimeo"]') !== null;

        // Meta: hasImage
        const hasImage = el.querySelector('img') !== null;

        // Meta: hasForm
        const hasForm = el.querySelector('form') !== null;

        // Meta: estimatedHeight
        let estimatedHeight: string;
        if (rect.height < 400) estimatedHeight = 'compact';
        else if (rect.height < 800) estimatedHeight = 'medium';
        else if (rect.height < 1200) estimatedHeight = 'tall';
        else estimatedHeight = 'hero';

        // Meta: classes (top 5 non-utility)
        const allClasses = Array.from(el.classList || []);
        const meaningfulClasses = allClasses
          .filter(c => !UTILITY_CLASS_RE.test(c))
          .slice(0, 5);

        components.push({
          id: `${domainArg}:${type}:${index}`,
          selector,
          type,
          html,
          textPreview,
          rect,
          childCount,
          depth,
          meta: {
            hasAnimation,
            hasVideo,
            hasImage,
            hasForm,
            estimatedHeight,
            classes: meaningfulClasses,
          },
        });
      } catch (_) {
        // Skip problematic elements
        continue;
      }
    }

    // ──────────────────────────────────────────────
    // Step 4: Deduplication
    // ──────────────────────────────────────────────

    // Sort by area ascending so smaller (more specific) components come first
    components.sort((a, b) => areaOf(a.rect) - areaOf(b.rect));

    const kept: RawComponent[] = [];

    for (const comp of components) {
      let dominated = false;

      for (const existing of kept) {
        const ratio = overlapRatio(comp.rect, existing.rect);

        if (ratio > 0.8) {
          // Two components overlap >80%: keep the smaller (more specific) one.
          // Since we iterate smallest-first, `existing` is already smaller or equal.
          // The current larger `comp` is dominated.
          dominated = true;
          break;
        }
      }

      if (!dominated) {
        // Check if this component is entirely inside another non-body/main element
        // Only remove the outer one, which we handle by checking if an already-kept
        // component fully contains this one. Since we go smallest first, we keep inner.
        kept.push(comp);
      }
    }

    // Re-sort by vertical position for natural reading order
    kept.sort((a, b) => a.rect.top - b.rect.top);

    return kept;
  }, domain);

  // Cast the raw results to the proper typed array
  return rawComponents as ExtractedComponent[];
}
