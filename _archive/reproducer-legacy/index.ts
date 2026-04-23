/**
 * Programmatic site reproducer — captures the COMPUTED DOM from a Clone Vivant
 * and rebuilds it as clean, standalone HTML/CSS.
 *
 * Unlike the AI approach, this is DETERMINISTIC:
 * - Captures getComputedStyle() on every visible element
 * - Diffs against browser defaults to keep only meaningful styles
 * - Produces clean CSS with semantic class names
 * - Preserves all text content, images, structure exactly
 *
 * The insight: reproduction is a CODE TRANSFORMATION, not generation.
 * The AI was the wrong tool. Computed styles are the right tool.
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { RecordingMetadata } from '../types.js';
import { logger } from '../utils/logger.js';

interface ReproduceOptions {
  recordingDir: string;
  outputDir: string;
  simplifyClasses: boolean;  // Replace CSS module hashes with clean names
  inlineStyles: boolean;     // Inline all styles (single file, no external CSS)
}

export class Reproducer {
  private options: ReproduceOptions;

  constructor(options: ReproduceOptions) {
    this.options = options;
  }

  async reproduce(): Promise<string> {
    const recordingDir = path.resolve(this.options.recordingDir);
    const harPath = path.join(recordingDir, 'recording.har');
    const metadataPath = path.join(recordingDir, 'metadata.json');

    if (!fs.existsSync(harPath)) {
      throw new Error(`HAR non trouvé: ${harPath}`);
    }

    const metadata: RecordingMetadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      : { url: '', domain: 'unknown', recordedAt: '', techStack: [], pageCount: 0, harSize: 0, screenshotCount: 0 };

    const outputDir = path.resolve(this.options.outputDir);
    fs.mkdirSync(outputDir, { recursive: true });

    // Step 1: Open the clone vivant
    logger.step(1, 7, 'Lancement du clone vivant...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    await context.routeFromHAR(harPath, { url: '**/*', notFound: 'fallback' });

    // Route local media
    const mediaDir = path.join(recordingDir, 'media');
    const manifestPath = path.join(mediaDir, '_manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const [, filename] of Object.entries(manifest)) {
        const filePath = path.join(mediaDir, filename);
        if (!fs.existsSync(filePath)) continue;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
        };
        await context.route(url => url.toString().includes(filename), async route => {
          await route.fulfill({ body: fs.readFileSync(filePath), contentType: mimeMap[ext] || 'application/octet-stream' });
        });
      }
    }

    const page = await context.newPage();
    await page.goto(metadata.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // Step 1.5: Force-show hidden states (modales, drawers, menus) pour capture
    logger.step(2, 7, 'Force-show des états cachés...');
    await page.evaluate(() => {
      const HIDDEN_PATTERNS = [
        '[role="dialog"]',
        '[role="menu"]',
        '[aria-hidden="true"]',
        '.modal',
        '.drawer',
        '.menu-mobile',
        '.mobile-menu',
        '.dropdown',
        '.popup',
        '[class*="modal"]',
        '[class*="drawer"]',
        '[class*="overlay"]',
      ];

      const forced: HTMLElement[] = [];
      for (const selector of HIDDEN_PATTERNS) {
        let els: HTMLElement[];
        try {
          els = Array.from(document.querySelectorAll<HTMLElement>(selector));
        } catch { continue; }
        for (const el of els) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) {
            el.setAttribute('data-reproducer-forced', '1');
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.opacity = '1';
            el.style.pointerEvents = 'none'; // Éviter de bloquer la page
            forced.push(el);
          }
        }
      }
      (window as any).__forcedCount = forced.length;
    });

    await page.waitForTimeout(200);

    // Fix B: Full-scroll aller-retour pour triggers tous les ScrollTrigger
    logger.step(3, 7, 'Scroll pour trigger le contenu (pass 1: down)...');
    await this.scrollThrough(page);
    await page.waitForTimeout(1000);
    logger.step(3, 7, 'Scroll pour trigger le contenu (pass 2: up then down again)...');
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(500);

    // Fix A + C: Force-finish all Web Animations + neutralize mask containers.
    // Sites built with GSAP/Framer Motion/Intersection-Observer can leave elements at
    // mid-animation state (containers with overflow:hidden + constrained width,
    // children with transform:translateY(100%)). Previous approach of "kill animations"
    // froze them mid-reveal — new approach: FINISH them so they reach their end state.
    await page.evaluate(() => {
      // Fix A — Finish all Web Animations (CSS anims, Web Animations API, GSAP targets)
      try {
        document.getAnimations().forEach(a => {
          try { a.finish(); } catch {}
        });
      } catch {}

      // GSAP : force-avancer les timelines jusqu'au bout au lieu de les clear
      try {
        const w = window as any;
        if (w.gsap) {
          if (w.gsap.globalTimeline) {
            try { w.gsap.globalTimeline.progress(1); } catch {}
          }
          if (w.ScrollTrigger) {
            try {
              w.ScrollTrigger.getAll().forEach((st: any) => {
                try { st.scroll(st.end); } catch {}
                try { st.progress(1); } catch {}
              });
              w.ScrollTrigger.refresh();
            } catch {}
          }
        }
      } catch {}

      // Inject stylesheet pour neutraliser transitions (pour les re-captures viewport)
      const s = document.createElement('style');
      s.setAttribute('data-reproducer-force-reveal', '1');
      s.textContent = `
        *, *::before, *::after {
          animation-delay: 0s !important;
          animation-duration: 0s !important;
          transition: none !important;
        }
      `;
      document.head.appendChild(s);

      // Clear common pre-reveal inline styles (legacy — pour les anims non-WebAnim)
      document.querySelectorAll<HTMLElement>('[style]').forEach(el => {
        const st = el.style;
        if (st.opacity === '0' || parseFloat(st.opacity) === 0) st.opacity = '';
        if (st.visibility === 'hidden') st.visibility = '';
        if (st.transform && /translate|scale|rotate/i.test(st.transform)) {
          if (!/translate\(0|scale\(1|rotate\(0/i.test(st.transform) || /translate[YX]?\([^0)][^)]*\)/i.test(st.transform)) {
            st.transform = '';
          }
        }
      });

      // Fix C v2 — Détecter et aplatir le pattern SplitText (GSAP/Webflow).
      // Pattern : parent contient N >= 2 spans, chaque span a 1-2 chars de texte.
      // Chaque span peut avoir un transform qui cache la lettre (animation reveal).
      // Solution : remplacer le contenu du parent par le texte concaténé → plus de spans,
      // plus d'animation bloquante, le texte s'affiche intégralement.
      const flattened: HTMLElement[] = [];
      document.querySelectorAll<HTMLElement>('*').forEach(el => {
        // Skip ceux qu'on a déjà traités
        if (el.hasAttribute('data-reproducer-splittext-flattened')) return;
        const children = Array.from(el.children);
        if (children.length < 2) return;
        // Tous les enfants doivent être des SPAN avec texte court (1-2 chars, ou 3 si ça inclut un espace)
        const allShortSpans = children.every(c => {
          if (c.tagName !== 'SPAN' && c.tagName !== 'DIV') return false;
          const text = (c.textContent || '').trim();
          if (text.length === 0 || text.length > 2) return false;
          // Ne doit pas avoir ses propres enfants éléments (sauf textes/br)
          return Array.from(c.children).length === 0;
        });
        if (!allShortSpans) return;
        // Concaténer tous les textes — préserver les espaces si le child contient un espace
        const fullText = children.map(c => c.textContent ?? '').join('');
        // Safety: ne flatten que si le résultat a du texte réel (évite vider des elements decoratifs)
        if (fullText.trim().length === 0) return;
        // Remplacer
        el.setAttribute('data-reproducer-splittext-flattened', '1');
        el.textContent = fullText;
        flattened.push(el);
      });
      (window as any).__flattenedCount = flattened.length;

      // Fix D — Détecter les duplications marquee (2 copies d'un texte pour animation infinie)
      // Pattern : élément avec 2 enfants identiques, le 2nd aria-hidden="true"
      // Solution : supprimer le 2nd (décoratif pour animation, parasite en static)
      const removedDupes: HTMLElement[] = [];
      document.querySelectorAll<HTMLElement>('*').forEach(el => {
        const children = Array.from(el.children) as HTMLElement[];
        if (children.length !== 2) return;
        const first = children[0];
        const second = children[1];
        // Le 2nd doit être aria-hidden ET avoir le même textContent que le 1er
        if (second.getAttribute('aria-hidden') !== 'true') return;
        const text1 = (first.textContent || '').trim();
        const text2 = (second.textContent || '').trim();
        if (text1 !== text2 || text1.length === 0) return;
        second.setAttribute('data-reproducer-dupe-removed', '1');
        second.style.display = 'none';
        removedDupes.push(second);
      });
      (window as any).__dupesRemovedCount = removedDupes.length;
    }).catch(() => {});

    // Attendre les fonts + un rAF pour stabiliser le layout
    try {
      await page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve());
    } catch {}
    await page.waitForTimeout(600);

    // Step 3: Capture the full rendered DOM with computed styles
    logger.step(4, 7, 'Capture du DOM rendu avec styles computes...');
    const capturedPage = await page.evaluate(() => {
      // --- Browser-side: capture everything ---

      // Default styles for diffing (approximate — we skip properties that match these)
      const SKIP_PROPS = new Set([
        'perspective-origin', 'transform-origin', 'webkit-locale',
        '-webkit-text-decorations-in-effect', 'animation-range-end', 'animation-range-start',
        'block-size', 'inline-size', 'min-block-size', 'min-inline-size',
      ]);

      // Properties we always want to capture if non-default
      const KEY_PROPS = [
        'display', 'position', 'top', 'right', 'bottom', 'left',
        'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
        'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'background-color', 'background-image', 'background-size', 'background-position',
        'color', 'font-family', 'font-size', 'font-weight', 'font-style',
        'line-height', 'letter-spacing', 'text-align', 'text-decoration', 'text-transform',
        'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
        'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
        'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
        'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
        'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'z-index',
        'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self',
        'gap', 'row-gap', 'column-gap',
        'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
        'transform', 'transition', 'cursor', 'pointer-events',
        'mix-blend-mode', 'filter', 'backdrop-filter', 'clip-path',
        'object-fit', 'object-position', 'aspect-ratio',
        'white-space', 'word-break', 'overflow-wrap',
        'list-style-type', 'visibility',
      ];

      // Defaults to skip (browser defaults)
      const DEFAULTS: Record<string, Set<string>> = {
        'display': new Set(['inline', 'block']), // depends on element
        'position': new Set(['static']),
        'top': new Set(['auto']),
        'right': new Set(['auto']),
        'bottom': new Set(['auto']),
        'left': new Set(['auto']),
        'opacity': new Set(['1']),
        'z-index': new Set(['auto']),
        'transform': new Set(['none']),
        'transition': new Set(['all 0s ease 0s', 'none 0s ease 0s', 'none']),
        'box-shadow': new Set(['none']),
        'mix-blend-mode': new Set(['normal']),
        'filter': new Set(['none']),
        'backdrop-filter': new Set(['none']),
        'clip-path': new Set(['none']),
        'background-image': new Set(['none']),
        'cursor': new Set(['auto']),
        'pointer-events': new Set(['auto']),
        'text-decoration': new Set(['none solid rgb(0, 0, 0)', 'none']),
        'text-transform': new Set(['none']),
        'overflow-x': new Set(['visible']),
        'overflow-y': new Set(['visible']),
        'letter-spacing': new Set(['normal']),
        'white-space': new Set(['normal']),
        'word-break': new Set(['normal']),
        'visibility': new Set(['visible']),
        'list-style-type': new Set(['disc', 'none']),
        'object-fit': new Set(['fill']),
        'aspect-ratio': new Set(['auto']),
        'flex-direction': new Set(['row']),
        'flex-wrap': new Set(['nowrap']),
        'justify-content': new Set(['normal', 'flex-start']),
        'align-items': new Set(['normal', 'stretch']),
        'align-self': new Set(['auto']),
      };

      // Block-level elements (display:block is their default)
      const BLOCK_ELEMENTS = new Set([
        'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN',
        'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI',
        'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'FORM', 'FIELDSET',
        'ADDRESS', 'DETAILS', 'SUMMARY', 'DIALOG',
      ]);

      let classCounter = 0;
      const classMap = new Map<string, string>(); // hash → clean name
      const usedNames = new Set<string>();

      const TAG_NAMES: Record<string, string> = {
        h1: 'hero-title', nav: 'nav', footer: 'site-footer',
        header: 'site-header', main: 'main-content', aside: 'sidebar',
      };

      function uniqueify(name: string): string {
        if (!usedNames.has(name)) { usedNames.add(name); return name; }
        let i = 2;
        while (usedNames.has(`${name}-${i}`)) i++;
        const n = `${name}-${i}`;
        usedNames.add(n);
        return n;
      }

      function cleanClassName(original: string, el: Element): string {
        // If it's already simple (no digits — avoids CSS-module hashes like ugly-abc123), keep it
        if (/^[a-z][a-z-]*$/i.test(original) && original.length < 30) {
          usedNames.add(original);
          return original;
        }
        if (classMap.has(original)) return classMap.get(original)!;

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const dataSection = el.getAttribute('data-section');
        const textContent = (el.textContent || '').trim().slice(0, 50);

        let name: string | null = null;

        // 1. data-section
        if (dataSection) name = `${dataSection.toLowerCase()}-section`;
        // 2. tag sémantique
        else if (TAG_NAMES[tag]) name = TAG_NAMES[tag];
        // 3. ARIA role
        else if (role === 'button') name = `button-${classCounter++}`;
        else if (role === 'dialog') name = `dialog-${classCounter++}`;
        // 4. Text content court
        else if (textContent.length > 0 && textContent.length < 30) {
          const slug = textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          if (slug.length > 0 && slug.length < 30) name = `${tag}-${slug}`;
        }
        // 5. Fallback
        if (!name) name = `el-${classCounter++}`;

        const unique = uniqueify(name);
        classMap.set(original, unique);
        return unique;
      }

      function getSignificantStyles(el: Element): Record<string, string> {
        const cs = getComputedStyle(el);
        const styles: Record<string, string> = {};
        const tag = el.tagName;

        for (const prop of KEY_PROPS) {
          if (SKIP_PROPS.has(prop)) continue;
          const val = cs.getPropertyValue(prop);
          if (!val) continue;

          // Skip defaults
          const defs = DEFAULTS[prop];
          if (defs && defs.has(val)) continue;

          // Special: display:block is default for block elements
          if (prop === 'display' && val === 'block' && BLOCK_ELEMENTS.has(tag)) continue;
          // display:inline is default for inline elements
          if (prop === 'display' && val === 'inline' && !BLOCK_ELEMENTS.has(tag)) continue;

          // Skip 0px margins/paddings
          if ((prop.startsWith('margin') || prop.startsWith('padding')) && val === '0px') continue;

          // Skip transparent backgrounds
          if (prop === 'background-color' && (val === 'rgba(0, 0, 0, 0)' || val === 'transparent')) continue;

          // Skip auto dimensions
          if ((prop === 'width' || prop === 'height' || prop === 'min-width' || prop === 'max-width' || prop === 'min-height' || prop === 'max-height') && val === 'auto') continue;

          // Skip border-width: 0px
          if (prop.includes('border') && prop.includes('width') && val === '0px') continue;
          // Skip border-style: none
          if (prop.includes('border') && prop.includes('style') && val === 'none') continue;
          // Skip border-color if border-width is 0
          if (prop.includes('border') && prop.includes('color') && cs.getPropertyValue(prop.replace('color', 'width')) === '0px') continue;
          // Skip border-radius 0px
          if (prop.includes('radius') && val === '0px') continue;

          // Skip gap/row-gap/column-gap when it's "normal"
          if ((prop === 'gap' || prop === 'row-gap' || prop === 'column-gap') && val === 'normal') continue;

          styles[prop] = val;
        }

        return styles;
      }

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

      function capturePseudoElement(el: Element, pseudo: '::before' | '::after'): Record<string, string> | undefined {
        const cs = getComputedStyle(el, pseudo);
        const content = cs.getPropertyValue('content');
        // Skip si content est vide ou "none" (= pseudo inactif)
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
          if (prop === 'filter' && val === 'none') continue;
          out[prop] = val;
        }
        return Object.keys(out).length > 1 ? out : undefined;
      }

      // Walk the DOM and build a clean representation
      interface CapturedNode {
        tag: string;
        classes: string[];
        originalClasses: string[];  // kept so original-site scripts still find their hooks
        id?: string;
        dataAttrs: Record<string, string>;  // data-* preserved (Barba, GSAP hooks, etc.)
        attrs: Record<string, string>;
        styles: Record<string, string>;
        pseudoBefore?: Record<string, string>;
        pseudoAfter?: Record<string, string>;
        children: CapturedNode[];
        text?: string;
      }

      function captureNode(el: Element, depth: number): CapturedNode | null {
        if (depth > 20) return null; // Prevent infinite recursion

        const tag = el.tagName.toLowerCase();

        // Skip hidden elements, scripts, styles, SVG internals
        if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'noscript') return null;
        if (tag === 'meta' || tag === 'title') return null;

        const cs = getComputedStyle(el);
        // Skip elements that are invisible and have no visible children
        if (cs.display === 'none') return null;
        if (cs.visibility === 'hidden' && cs.opacity === '0') return null;

        const rect = el.getBoundingClientRect();
        // Skip zero-size elements (but keep 0-height containers that have content)
        if (rect.width === 0 && rect.height === 0 && el.children.length === 0) return null;

        // Clean up classes — keep originals alongside cleaned ones so that
        // original-site scripts (Barba, UnicornStudio, custom bundles) that
        // query by original class names still work.
        const originalClasses = Array.from(el.classList);
        const cleanedClasses = originalClasses.map(c => cleanClassName(c, el));

        // Si aucune classe mais élément sémantique connu, forcer un nom
        if (cleanedClasses.length === 0 && (TAG_NAMES[tag] || el.getAttribute('role'))) {
          cleanedClasses.push(cleanClassName(`_synthetic_${tag}`, el));
        }

        // Get significant styles
        const styles = getSignificantStyles(el);

        // Capture pseudo-elements ::before et ::after si content ≠ none/normal
        const pseudoBefore = capturePseudoElement(el, '::before');
        const pseudoAfter = capturePseudoElement(el, '::after');

        // Get attributes we want to keep
        const attrs: Record<string, string> = {};
        if (tag === 'img') {
          attrs.src = el.getAttribute('src') || '';
          attrs.alt = el.getAttribute('alt') || '';
          if (el.getAttribute('loading')) attrs.loading = el.getAttribute('loading')!;
          if (el.getAttribute('srcset')) attrs.srcset = el.getAttribute('srcset')!;
          if (el.getAttribute('sizes')) attrs.sizes = el.getAttribute('sizes')!;
          if (el.getAttribute('width')) attrs.width = el.getAttribute('width')!;
          if (el.getAttribute('height')) attrs.height = el.getAttribute('height')!;
        }
        if (tag === 'a') {
          attrs.href = el.getAttribute('href') || '#';
        }
        if (tag === 'video') {
          attrs.autoplay = '';
          attrs.muted = '';
          attrs.loop = '';
          attrs.playsinline = '';
          const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
          if (src) attrs.src = src;
        }
        if (tag === 'source') {
          attrs.src = el.getAttribute('src') || '';
          attrs.type = el.getAttribute('type') || '';
        }
        if (tag === 'input' || tag === 'button' || tag === 'textarea') {
          const type = el.getAttribute('type');
          if (type) attrs.type = type;
          const placeholder = el.getAttribute('placeholder');
          if (placeholder) attrs.placeholder = placeholder;
        }
        if (tag === 'svg') {
          // Keep SVGs as-is (outerHTML)
          return {
            tag: 'svg-raw',
            classes: [],
            originalClasses: [],
            dataAttrs: {},
            attrs: { html: el.outerHTML },
            styles: {},
            children: [],
          };
        }

        // Capture data-* attributes (Barba, GSAP hooks, frameworks rely on these)
        const dataAttrs: Record<string, string> = {};
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('data-') || attr.name === 'role' || attr.name === 'aria-label') {
            dataAttrs[attr.name] = attr.value;
          }
        }

        // Capture children
        const children: CapturedNode[] = [];
        for (const child of el.childNodes) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const captured = captureNode(child as Element, depth + 1);
            if (captured) children.push(captured);
          } else if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent?.trim();
            if (text) {
              children.push({ tag: '#text', classes: [], originalClasses: [], dataAttrs: {}, attrs: {}, styles: {}, children: [], text });
            }
          }
        }

        const wasForced = el.getAttribute('data-reproducer-forced') === '1';
        if (wasForced) {
          dataAttrs['data-originally-hidden'] = 'true';
        }

        return {
          tag,
          classes: cleanedClasses,
          originalClasses,
          id: el.id || undefined,
          dataAttrs,
          attrs,
          styles,
          pseudoBefore,
          pseudoAfter,
          children,
        };
      }

      // Capture the body's CHILDREN (not the body itself) — the body wrapper
      // is re-emitted by the final template using bodyAttrs/bodyClasses we
      // collect separately below. Capturing document.body would produce a
      // nested <body><body>…</body></body> which browsers render as broken.
      const bodyChildren: CapturedNode[] = [];
      for (const child of Array.from(document.body.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const captured = captureNode(child as Element, 0);
          if (captured) bodyChildren.push(captured);
        } else if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent?.trim();
          if (text) {
            bodyChildren.push({ tag: '#text', classes: [], originalClasses: [], dataAttrs: {}, attrs: {}, styles: {}, children: [], text });
          }
        }
      }
      // Wrap children in a synthetic root so the rest of the pipeline, which
      // expects a single tree, still works. This synthetic root is flattened
      // back out by the HTML builder (no <body-root> tag emitted).
      const body: CapturedNode = {
        tag: 'body-root',
        classes: [], originalClasses: [], dataAttrs: {}, attrs: {}, styles: {},
        children: bodyChildren,
      };

      // Collect all unique style combinations for CSS class extraction
      const styleGroups = new Map<string, string[]>(); // JSON(styles) → class names
      function collectStyles(node: CapturedNode) {
        if (Object.keys(node.styles).length > 0 && node.tag !== '#text' && node.tag !== 'svg-raw') {
          const key = JSON.stringify(node.styles);
          if (!styleGroups.has(key)) styleGroups.set(key, []);
          const group = styleGroups.get(key)!;
          const className = node.classes[0] || `s-${group.length}`;
          if (!group.includes(className)) group.push(className);
        }
        node.children.forEach(c => collectStyles(c));
      }
      if (body) collectStyles(body);

      // Capture original <head> assets so scripts/fonts keep working after reproduction.
      // We only grab external <link>/<script src> + inline <script> bodies; we deliberately
      // skip <style> because we re-emit computed CSS ourselves.
      const headAssets = {
        stylesheets: [] as string[],       // href values
        externalScripts: [] as { src: string; async: boolean; defer: boolean; type: string }[],
        inlineScripts: [] as string[],     // script body text (no src)
        preloads: [] as { href: string; as: string; type: string; crossorigin: string }[],
      };
      for (const link of Array.from(document.head.querySelectorAll('link'))) {
        const rel = link.getAttribute('rel') || '';
        const href = link.getAttribute('href') || '';
        if (!href) continue;
        if (rel.includes('stylesheet')) headAssets.stylesheets.push(href);
        else if (rel === 'preload') {
          headAssets.preloads.push({
            href,
            as: link.getAttribute('as') || '',
            type: link.getAttribute('type') || '',
            crossorigin: link.getAttribute('crossorigin') || '',
          });
        }
      }
      // Scripts can be in <head> OR <body>; capture both.
      for (const script of Array.from(document.querySelectorAll('script'))) {
        const src = script.getAttribute('src') || '';
        if (src) {
          headAssets.externalScripts.push({
            src,
            async: script.hasAttribute('async'),
            defer: script.hasAttribute('defer'),
            type: script.getAttribute('type') || '',
          });
        } else {
          const body = script.textContent || '';
          // Skip analytics/noise, keep anything substantive
          if (body.trim().length > 20 && !/google-?analytics|gtag|fbq|hotjar/i.test(body)) {
            headAssets.inlineScripts.push(body);
          }
        }
      }

      // Extract CSS custom properties from stylesheets → reverse map {value: tokenName}
      const cssVarMap: Record<string, string> = {};
      const cssVarRootDecl: Record<string, string> = {};
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
              cssVarRootDecl[prop] = value;
              const norm = value.toLowerCase();
              if (!cssVarMap[value] && !cssVarMap[norm]) {
                cssVarMap[value] = prop;
                cssVarMap[norm] = prop;
              }
            }
          }
        } catch {}
      }

      // Body attributes (Barba.js requires data-barba="wrapper" etc.)
      const bodyAttrs: Record<string, string> = {};
      for (const attr of Array.from(document.body.attributes)) {
        if (attr.name === 'class' || attr.name === 'style') continue;
        bodyAttrs[attr.name] = attr.value;
      }
      const bodyClasses = Array.from(document.body.classList);

      // <html> lang
      const htmlLang = document.documentElement.getAttribute('lang') || 'en';

      // <title>
      const pageTitle = document.title || '';

      // Expose for tests (no-op in prod, but harmless)
      (window as any).__captureNodeForTest = (el: Element) => captureNode(el, 0);

      // Expose capture function for multi-viewport re-capture
      (window as any).__reproducerCapture = () => {
        const bodyChildren: CapturedNode[] = [];
        for (const child of Array.from(document.body.childNodes)) {
          if (child.nodeType === Node.ELEMENT_NODE) {
            const captured = captureNode(child as Element, 0);
            if (captured) bodyChildren.push(captured);
          }
        }
        return {
          body: { tag: 'body-root', classes: [], originalClasses: [], dataAttrs: {}, attrs: {}, styles: {}, children: bodyChildren },
          classMap: Object.fromEntries(classMap),
          cssVarMap,
          cssVarRootDecl,
        };
      };

      return {
        body,
        classMap: Object.fromEntries(classMap),
        headAssets,
        bodyAttrs,
        bodyClasses,
        htmlLang,
        pageTitle,
        cssVarMap,
        cssVarRootDecl,
      };
    });

    // Multi-viewport: re-capture à tablet et mobile
    logger.step(4, 7, 'Capture multi-viewport (tablet + mobile)...');
    const captures: Record<string, any> = { desktop: capturedPage };
    try {
      captures.tablet = await this.captureAtViewport(page, 1024, 768);
    } catch (err) {
      logger.warn(`Capture tablet échouée: ${(err as Error).message}`);
    }
    try {
      captures.mobile = await this.captureAtViewport(page, 375, 812);
    } catch (err) {
      logger.warn(`Capture mobile échouée: ${(err as Error).message}`);
    }
    // Reset viewport à 1920x1080 pour compat avec la suite (scripts inline etc.)
    await page.setViewportSize({ width: 1920, height: 1080 });

    logger.step(5, 7, 'Capture hover states...');
    await page.setViewportSize({ width: 1440, height: 900 });
    const hoverStates = await this.captureHoverStates(page);
    logger.info(`  ${hoverStates.length} hover states capturés`);

    if (!capturedPage.body) {
      throw new Error('Capture du DOM echouee — body est null');
    }

    // Rewrite relative URLs in captured assets to absolute URLs anchored on the
    // original site's origin. Without this, /_next/* scripts and /assets/* images
    // 404 when the reproduction is served from ./generated/<site>/.
    // We deliberately keep URLs absolute rather than copying assets, so the file
    // stays portable (drop it in any static server and it works online).
    const origin = (() => {
      try { return new URL(metadata.url).origin; } catch { return ''; }
    })();
    const absolutize = (u: string): string => {
      if (!u || !origin) return u;
      if (/^(https?:)?\/\//i.test(u)) return u;          // already absolute
      if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('#') || u.startsWith('mailto:') || u.startsWith('tel:')) return u;
      if (u.startsWith('/')) return origin + u;          // root-relative
      return origin + '/' + u;                           // path-relative
    };
    capturedPage.headAssets.stylesheets = capturedPage.headAssets.stylesheets.map(absolutize);
    capturedPage.headAssets.externalScripts = capturedPage.headAssets.externalScripts.map(s => ({ ...s, src: absolutize(s.src) }));
    capturedPage.headAssets.preloads = capturedPage.headAssets.preloads.map(p => ({ ...p, href: absolutize(p.href) }));

    // Walk the DOM tree and absolutize img/src, video/src, source/src, a/href
    function absolutizeNode(node: any) {
      if (!node || typeof node !== 'object') return;
      if (node.attrs) {
        if (node.tag === 'img' && node.attrs.src) node.attrs.src = absolutize(node.attrs.src);
        if (node.tag === 'video' && node.attrs.src) node.attrs.src = absolutize(node.attrs.src);
        if (node.tag === 'source' && node.attrs.src) node.attrs.src = absolutize(node.attrs.src);
        if (node.tag === 'a' && node.attrs.href && node.attrs.href !== '#') node.attrs.href = absolutize(node.attrs.href);
      }
      if (Array.isArray(node.children)) node.children.forEach(absolutizeNode);
    }
    absolutizeNode(capturedPage.body);

    // Step 4: Rebuild clean HTML + CSS
    logger.step(6, 7, 'Reconstruction du HTML/CSS propre...');

    const cssRules: string[] = [];
    const usedClasses = new Set<string>();

    type CapturedNode = {
      tag: string;
      classes: string[];
      originalClasses: string[];
      id?: string;
      dataAttrs: Record<string, string>;
      attrs: Record<string, string>;
      styles: Record<string, string>;
      pseudoBefore?: Record<string, string>;
      pseudoAfter?: Record<string, string>;
      children: CapturedNode[];
      text?: string;
    };

    const cssVarMap = capturedPage.cssVarMap || {};

    function applyVarMap(value: string): string {
      if (cssVarMap[value]) return `var(${cssVarMap[value]})`;
      const normLower = value.toLowerCase();
      if (cssVarMap[normLower]) return `var(${cssVarMap[normLower]})`;
      return value;
    }

    function buildHtml(node: CapturedNode, indent: number): string {
      const pad = '  '.repeat(indent);

      if (node.tag === '#text') {
        return `${pad}${node.text}`;
      }

      if (node.tag === 'svg-raw') {
        return `${pad}${node.attrs.html || ''}`;
      }

      // Synthetic root produced by the body-children capture: emit only children.
      if (node.tag === 'body-root') {
        return node.children.map(c => buildHtml(c, indent)).join('\n');
      }

      // Build CSS class for this element's styles and/or pseudo-elements.
      // Needs a class if it has any significant styles OR any pseudo-element to emit.
      let className = '';
      const hasStyles = Object.keys(node.styles).length > 0;
      const hasPseudo = !!(node.pseudoBefore || node.pseudoAfter);
      if (hasStyles || hasPseudo) {
        if (node.dataAttrs && node.dataAttrs['data-originally-hidden'] === 'true') {
          cssRules.push(`/* Element originally hidden (modal/drawer) — forced visible for capture */`);
        }
        const candidate = node.classes[0];
        className = (candidate && candidate.length > 0) ? candidate : `el-${usedClasses.size}`;
        if (!usedClasses.has(className)) {
          usedClasses.add(className);
          if (hasStyles) {
            const cssProps = Object.entries(node.styles)
              .map(([prop, val]) => `  ${prop}: ${applyVarMap(val)};`)
              .join('\n');
            cssRules.push(`.${className} {\n${cssProps}\n}`);
          }
          if (node.pseudoBefore) {
            const props = Object.entries(node.pseudoBefore).map(([p, v]) => `  ${p}: ${applyVarMap(v)};`).join('\n');
            cssRules.push(`.${className}::before {\n${props}\n}`);
          }
          if (node.pseudoAfter) {
            const props = Object.entries(node.pseudoAfter).map(([p, v]) => `  ${p}: ${applyVarMap(v)};`).join('\n');
            cssRules.push(`.${className}::after {\n${props}\n}`);
          }
        }
      }

      // Merge cleaned class + original classes so scripts still find their hooks.
      // De-dup: if originals already contain the cleaned name, don't repeat it.
      const allClasses = new Set<string>();
      if (className) allClasses.add(className);
      for (const oc of node.originalClasses) allClasses.add(oc);
      const classAttr = Array.from(allClasses).join(' ');

      // Build attributes
      const attrs: string[] = [];
      if (node.id) attrs.push(`id="${node.id}"`);
      if (classAttr) attrs.push(`class="${classAttr}"`);
      for (const [k, v] of Object.entries(node.dataAttrs)) {
        attrs.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
      }
      for (const [k, v] of Object.entries(node.attrs)) {
        if (v === '') attrs.push(k);
        else attrs.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
      }

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

      // Self-closing tags
      if (['img', 'br', 'hr', 'input', 'meta', 'source'].includes(node.tag)) {
        return `${pad}<${node.tag}${attrStr}>`;
      }

      if (node.children.length === 0) {
        return `${pad}<${node.tag}${attrStr}></${node.tag}>`;
      }

      // Short text-only elements
      if (node.children.length === 1 && node.children[0].tag === '#text') {
        return `${pad}<${node.tag}${attrStr}>${node.children[0].text}</${node.tag}>`;
      }

      // Inline children (typically split-text spans for GSAP animations): concat without
      // newlines/indent to prevent HTML-whitespace from inserting spaces between letters.
      // e.g. <h1><span>p</span><span>r</span>...</h1> must render as "pr" not "p r".
      const INLINE_TAGS = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'small', 'sub', 'sup', 'mark', 'code', 'u', 's', '#text']);
      const allInline = node.children.every(c => INLINE_TAGS.has(c.tag));
      if (allInline && node.children.length > 1) {
        const inlineHtml = node.children
          .map(c => buildHtml(c, 0).replace(/^\s+/, ''))
          .join('');
        return `${pad}<${node.tag}${attrStr}>${inlineHtml}</${node.tag}>`;
      }

      const childHtml = node.children.map(c => buildHtml(c, indent + 1)).join('\n');
      return `${pad}<${node.tag}${attrStr}>\n${childHtml}\n${pad}</${node.tag}>`;
    }

    const bodyHtml = buildHtml(capturedPage.body as CapturedNode, 1);
    const css = cssRules.join('\n\n');

    // Multi-viewport: diff styles entre desktop et tablet/mobile → @media queries
    const mediaBlocks: { breakpoint: number; rules: string[] }[] = [
      { breakpoint: 1279, rules: [] }, // tablet styles
      { breakpoint: 767, rules: [] },  // mobile styles
    ];

    function walkAndDiff(
      desktopNode: any,
      otherNode: any,
      target: { rules: string[] }
    ) {
      if (!desktopNode || !otherNode) return;
      const dStyles = desktopNode.styles || {};
      const oStyles = otherNode.styles || {};
      const changed: Record<string, string> = {};
      const allKeys = new Set([...Object.keys(dStyles), ...Object.keys(oStyles)]);
      for (const k of allKeys) {
        if (dStyles[k] !== oStyles[k] && oStyles[k] !== undefined) {
          changed[k] = applyVarMap(oStyles[k]);
        }
      }
      const className = desktopNode.classes?.[0];
      if (className && Object.keys(changed).length > 0) {
        const props = Object.entries(changed).map(([p, v]) => `    ${p}: ${v};`).join('\n');
        target.rules.push(`  .${className} {\n${props}\n  }`);
      }
      const dChildren = desktopNode.children || [];
      const oChildren = otherNode.children || [];
      for (let i = 0; i < Math.min(dChildren.length, oChildren.length); i++) {
        walkAndDiff(dChildren[i], oChildren[i], target);
      }
    }

    if (captures.tablet) walkAndDiff(capturedPage.body, captures.tablet.body, mediaBlocks[0]);
    if (captures.mobile) walkAndDiff(capturedPage.body, captures.mobile.body, mediaBlocks[1]);

    const mediaCss = mediaBlocks
      .filter(b => b.rules.length > 0)
      .map(b => `@media (max-width: ${b.breakpoint}px) {\n${b.rules.join('\n')}\n}`)
      .join('\n\n');

    // Hover states from captureHoverStates
    const hoverCss = hoverStates
      .map((h: { selector: string; styles: Record<string, string> }) => {
        const props = Object.entries(h.styles)
          .map(([p, v]) => `  ${p}: ${applyVarMap(v)};`)
          .join('\n');
        return `${h.selector}:hover {\n${props}\n}`;
      })
      .join('\n\n');

    const rootDecl = capturedPage.cssVarRootDecl || {};
    const rootDeclCss = Object.keys(rootDecl).length > 0
      ? `:root {\n${Object.entries(rootDecl).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n\n`
      : '';
    const fullCss = rootDeclCss + css;

    // Step 5: Assemble the final page
    logger.step(7, 7, 'Assemblage final...');

    // Build <head> from original-site assets (stylesheets, fonts, scripts)
    // so GSAP/Barba/UnicornStudio and custom behaviors keep working.
    const head: string[] = [
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `  <title>${(capturedPage.pageTitle || metadata.domain || 'Reproduction').replace(/</g, '&lt;')}</title>`,
    ];
    for (const p of capturedPage.headAssets.preloads) {
      const parts = [`href="${p.href}"`, `rel="preload"`];
      if (p.as) parts.push(`as="${p.as}"`);
      if (p.type) parts.push(`type="${p.type}"`);
      if (p.crossorigin) parts.push(`crossorigin="${p.crossorigin}"`);
      head.push(`  <link ${parts.join(' ')}>`);
    }
    for (const href of capturedPage.headAssets.stylesheets) {
      head.push(`  <link rel="stylesheet" href="${href}">`);
    }
    // Inline style block for our computed CSS (small reset + computed rules)
    head.push('  <style>');
    head.push('/* Reset */');
    head.push('*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }');
    head.push('body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }');
    head.push('img { max-width: 100%; height: auto; display: block; }');
    head.push('a { text-decoration: none; color: inherit; }');
    head.push('');
    head.push('/* Computed styles from original site */');
    head.push(fullCss);
    if (mediaCss) head.push('\n/* Responsive styles */\n' + mediaCss);
    if (hoverCss) head.push('\n/* Hover states */\n' + hoverCss);
    head.push('  </style>');
    // External scripts from original page (defer to preserve behavior, unless async/type set)
    for (const s of capturedPage.headAssets.externalScripts) {
      const parts = [`src="${s.src}"`];
      if (s.async) parts.push('async');
      if (s.defer) parts.push('defer');
      if (s.type) parts.push(`type="${s.type}"`);
      // Default to defer so scripts run after DOM is built
      if (!s.async && !s.defer && s.type !== 'module') parts.push('defer');
      head.push(`  <script ${parts.join(' ')}></script>`);
    }

    // <body> attributes (Barba needs data-barba="wrapper", some sites set theme classes here)
    const bodyAttrParts: string[] = [];
    const bodyClassSet = new Set(capturedPage.bodyClasses);
    if (bodyClassSet.size > 0) bodyAttrParts.push(`class="${Array.from(bodyClassSet).join(' ')}"`);
    for (const [k, v] of Object.entries(capturedPage.bodyAttrs)) {
      bodyAttrParts.push(`${k}="${v.replace(/"/g, '&quot;')}"`);
    }
    const bodyAttrStr = bodyAttrParts.length > 0 ? ' ' + bodyAttrParts.join(' ') : '';

    // Inline scripts from the original page (init code, framework bootstraps)
    const inlineScriptsHtml = capturedPage.headAssets.inlineScripts
      .map(body => `  <script>\n${body}\n  </script>`)
      .join('\n');

    const finalHtml = `<!DOCTYPE html>
<html lang="${capturedPage.htmlLang}">
<head>
${head.join('\n')}
</head>
<body${bodyAttrStr}>
${bodyHtml}
${inlineScriptsHtml}
</body>
</html>`;

    // Write output
    const outputPath = path.join(outputDir, 'index.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');

    // Stats
    const elementCount = (finalHtml.match(/<[a-z]/gi) || []).length;
    const cssRuleCount = cssRules.length;

    await browser.close();

    logger.success(`
Reproduction programmatique terminée !
  Fichier:    ${outputPath}
  Taille:     ${(finalHtml.length / 1024).toFixed(0)} KB
  Elements:   ${elementCount}
  CSS rules:  ${cssRuleCount}
  Classes:    ${usedClasses.size}
`);

    return outputPath;
  }

  private async captureHoverStates(page: Page): Promise<Array<{ selector: string; styles: Record<string, string> }>> {
    const HOVER_SELECTORS = [
      'a:not([class*="logo"])',
      'button',
      '[role="button"]',
      '[class*="btn"]',
      '[class*="cta"]',
      '[class*="card"]',
    ];

    // Collecte targets (max 50 au total, 10 par selector)
    const targets = await page.evaluate((selectors: string[]) => {
      const out: { path: string; x: number; y: number; w: number; h: number }[] = [];
      const seen = new Set<Element>();
      for (const sel of selectors) {
        let matches: Element[];
        try { matches = Array.from(document.querySelectorAll(sel)); }
        catch { continue; }
        for (const el of matches.slice(0, 10)) {
          if (seen.has(el)) continue;
          seen.add(el);
          if (out.length >= 50) break;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const tag = el.tagName.toLowerCase();
          const id = el.id ? `#${el.id}` : '';
          const classes = Array.from(el.classList).map(c => `.${c}`).join('');
          const path = `${tag}${id}${classes}`;
          out.push({ path, x: rect.x, y: rect.y, w: rect.width, h: rect.height });
        }
        if (out.length >= 50) break;
      }
      return out;
    }, HOVER_SELECTORS);

    const results: Array<{ selector: string; styles: Record<string, string> }> = [];

    for (const target of targets) {
      try {
        const before = await page.evaluate((p: string) => {
          const el = document.querySelector(p);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return {
            color: cs.color,
            'background-color': cs.backgroundColor,
            'border-color': cs.borderColor,
            'opacity': cs.opacity,
            'transform': cs.transform,
            'box-shadow': cs.boxShadow,
          };
        }, target.path);

        if (!before) continue;

        // Hover via mouse move au centre
        await page.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
        await page.waitForTimeout(100);

        const after = await page.evaluate((p: string) => {
          const el = document.querySelector(p);
          if (!el) return null;
          const cs = getComputedStyle(el);
          return {
            color: cs.color,
            'background-color': cs.backgroundColor,
            'border-color': cs.borderColor,
            'opacity': cs.opacity,
            'transform': cs.transform,
            'box-shadow': cs.boxShadow,
          };
        }, target.path);

        if (!after) continue;

        const diff: Record<string, string> = {};
        for (const k of Object.keys(before)) {
          const key = k as keyof typeof before;
          if (before[key] !== after[key] && after[key]) {
            diff[k] = after[key];
          }
        }

        if (Object.keys(diff).length > 0) {
          results.push({ selector: target.path, styles: diff });
        }

        await page.mouse.move(0, 0);
        await page.waitForTimeout(50);
      } catch {
        // Skip les targets qui erreurent
      }
    }

    return results;
  }

  private async captureAtViewport(page: Page, width: number, height: number): Promise<any> {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(300);
    await this.scrollThrough(page);

    // Re-kill animations (peut avoir été re-déclenchées par le resize)
    await page.evaluate(() => {
      try {
        const w = window as any;
        if (w.gsap) {
          w.gsap.globalTimeline.clear();
          w.gsap.set('*', { clearProps: 'opacity,transform,visibility,y,x,scale,rotate' });
        }
      } catch {}
    });
    await page.waitForTimeout(200);

    return await page.evaluate(() => (window as any).__reproducerCapture());
  }

  private async scrollThrough(page: Page): Promise<void> {
    const initialHeight = await page.evaluate(() => document.body.scrollHeight);
    const step = 400;
    const MAX_PX = 60_000;
    const MAX_GROWTH_RATIO = 3;
    const targetHeight = Math.min(initialHeight, MAX_PX);
    for (let y = 0; y <= targetHeight; y += step) {
      await page.evaluate(scrollY => window.scrollTo({ top: scrollY, behavior: 'smooth' }), y);
      await page.waitForTimeout(150);
      const liveHeight = await page.evaluate(() => document.body.scrollHeight);
      if (liveHeight > initialHeight * MAX_GROWTH_RATIO) break;
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
  }
}
