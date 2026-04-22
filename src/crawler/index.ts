import { chromium, Browser, Page, BrowserContext, Route } from 'playwright';
import {
  CloneConfig,
  CrawlResult,
  PageData,
  SiteMetadata,
  AssetData,
  FontData,
  ScriptData,
  StylesheetData,
  AssetType,
} from '../types.js';
import { normalizeUrl, isSameDomain, getDomain, getAssetFilename } from '../utils/url.js';
import { logger } from '../utils/logger.js';

export class Crawler {
  private config: CloneConfig;
  private visitedUrls = new Set<string>();
  private queuedUrls: string[] = [];
  private assets = new Map<string, AssetData>();
  private fonts = new Map<string, FontData>();

  constructor(config: CloneConfig) {
    this.config = config;
  }

  async crawl(): Promise<CrawlResult> {
    logger.step(1, 4, 'Lancement du navigateur...');

    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      viewport: {
        width: this.config.viewports[0].width,
        height: this.config.viewports[0].height,
      },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    // Seed the queue
    const startUrl = normalizeUrl(this.config.url, this.config.url);
    if (!startUrl) throw new Error(`URL invalide: ${this.config.url}`);
    this.queuedUrls.push(startUrl);

    const pages: PageData[] = [];
    const techStack = new Set<string>();

    try {
      while (this.queuedUrls.length > 0 && this.visitedUrls.size < this.config.maxPages) {
        const url = this.queuedUrls.shift()!;
        if (this.visitedUrls.has(url)) continue;
        this.visitedUrls.add(url);

        logger.info(`Crawl [${this.visitedUrls.size}/${this.config.maxPages}] ${url}`);

        try {
          const pageData = await this.crawlPage(context, url, techStack);
          if (pageData) {
            pages.push(pageData);

            // Queue discovered links
            for (const link of pageData.links) {
              const normalized = normalizeUrl(link, this.config.url);
              if (
                normalized &&
                !this.visitedUrls.has(normalized) &&
                isSameDomain(normalized, this.config.url) &&
                !this.queuedUrls.includes(normalized)
              ) {
                this.queuedUrls.push(normalized);
              }
            }
          }
        } catch (err: any) {
          logger.warn(`Erreur sur ${url}: ${err.message}`);
        }
      }
    } finally {
      await browser.close();
    }

    // Gap-fill: parse all HTML to find image URLs not captured by network interception
    logger.info('Recherche des images manquantes dans le HTML...');
    await this.gapFillMissingAssets(pages);

    const siteMetadata: SiteMetadata = {
      baseUrl: this.config.url,
      domain: getDomain(this.config.url),
      pages: pages.map((p) => p.url),
      techStack: Array.from(techStack),
      totalAssets: this.assets.size,
    };

    logger.success(
      `Crawl terminé: ${pages.length} pages, ${this.assets.size} assets, ${this.fonts.size} fonts`
    );

    return { pages, siteMetadata };
  }

  private async crawlPage(
    context: BrowserContext,
    url: string,
    techStack: Set<string>
  ): Promise<PageData | null> {
    const page = await context.newPage();
    const collectedAssets: AssetData[] = [];
    const collectedFonts: FontData[] = [];
    const collectedScripts: ScriptData[] = [];
    const collectedStylesheets: StylesheetData[] = [];

    // Intercept network requests to collect assets
    page.on('response', async (response) => {
      const resUrl = response.url();
      const contentType = response.headers()['content-type'] || '';
      const status = response.status();

      if (status < 200 || status >= 400) return;

      try {
        // Fonts
        if (
          contentType.includes('font') ||
          /\.(woff2?|ttf|otf|eot)(\?|$)/i.test(resUrl)
        ) {
          const body = await response.body().catch(() => null);
          if (body) {
            const fontData: FontData = {
              family: 'unknown',
              url: resUrl,
              content: body,
              format: this.detectFontFormat(resUrl),
            };
            this.fonts.set(resUrl, fontData);
            collectedFonts.push(fontData);
          }
        }

        // Images / SVGs
        if (
          contentType.includes('image') ||
          /\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(resUrl)
        ) {
          const body = await response.body().catch(() => null);
          if (body) {
            const asset: AssetData = {
              url: resUrl,
              localPath: `assets/images/${getAssetFilename(resUrl)}`,
              type: contentType.includes('svg') ? 'svg' : 'image',
              mimeType: contentType,
              content: body,
            };
            this.assets.set(resUrl, asset);
            collectedAssets.push(asset);
          }
        }

        // Videos
        if (contentType.includes('video') || /\.(mp4|webm|ogv)(\?|$)/i.test(resUrl)) {
          const body = await response.body().catch(() => null);
          if (body) {
            const asset: AssetData = {
              url: resUrl,
              localPath: `assets/videos/${getAssetFilename(resUrl)}`,
              type: 'video',
              mimeType: contentType,
              content: body,
            };
            this.assets.set(resUrl, asset);
            collectedAssets.push(asset);
          }
        }

        // CSS
        if (contentType.includes('css') || /\.css(\?|$)/i.test(resUrl)) {
          const body = await response.text().catch(() => null);
          if (body) {
            collectedStylesheets.push({
              url: resUrl,
              content: body,
              isExternal: true,
            });
          }
        }

        // JS (for tech stack detection)
        if (contentType.includes('javascript') || /\.js(\?|$)/i.test(resUrl)) {
          collectedScripts.push({
            url: resUrl,
            isExternal: true,
          });

          // Detect tech stack
          if (resUrl.includes('gsap') || resUrl.includes('greensock'))
            techStack.add('GSAP');
          if (resUrl.includes('three')) techStack.add('Three.js');
          if (resUrl.includes('lenis')) techStack.add('Lenis');
          if (resUrl.includes('locomotive')) techStack.add('Locomotive Scroll');
          if (resUrl.includes('framer-motion')) techStack.add('Framer Motion');
          if (resUrl.includes('webflow')) techStack.add('Webflow');
          if (resUrl.includes('react')) techStack.add('React');
          if (resUrl.includes('vue')) techStack.add('Vue');
          if (resUrl.includes('svelte')) techStack.add('Svelte');
          if (resUrl.includes('next')) techStack.add('Next.js');
          if (resUrl.includes('nuxt')) techStack.add('Nuxt');
          if (resUrl.includes('astro')) techStack.add('Astro');
          if (resUrl.includes('barba')) techStack.add('Barba.js');
          if (resUrl.includes('swiper')) techStack.add('Swiper');
        }
      } catch {
        // Silently skip failed assets
      }
    });

    try {
      // Fetch the RAW server HTML directly via HTTP (before any JS execution).
      // This is critical: Playwright's page.content() returns the DOM AFTER JS runs,
      // which has GSAP transforms baked in. The server HTML is clean.
      let serverHtml = '';
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          redirect: 'follow',
        });
        if (resp.ok) {
          serverHtml = await resp.text();
        }
      } catch {}

      // Navigate with Playwright to trigger asset loading (images, fonts, CSS via network)
      // Use 'load' instead of 'networkidle' to avoid timeouts on SPAs that never stop fetching
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeout,
        });
        // Wait for additional assets to load
        await page.waitForTimeout(5000);
        // Scroll to trigger lazy-loaded content
        await this.autoScroll(page);
      } catch {
        // Even if Playwright navigation fails, we still have serverHtml from fetch()
        logger.warn(`Navigation Playwright partielle pour ${url}`);
      }

      // Detect Next.js/React sites that need special handling:
      // - CSS is in external _next/static/chunks/*.css files
      // - Page transition overlays block content
      // - React hydration fails on wrong domain
      // For these sites: capture rendered DOM with inlined CSS, strip hydration scripts
      const isNextJs = serverHtml.includes('/_next/') || serverHtml.includes('__NEXT_DATA__');

      if (isNextJs) {
        logger.dim(`  (site Next.js détecté: CSS inline + SPA unfreeze)`);
        // Inline all CSS, remove overlays/hydration scripts, unfreeze GSAP animations
        try {
          const inlinedHtml = await page.evaluate(() => {
            const rules: string[] = [];
            for (const sheet of document.styleSheets) {
              try { for (const r of sheet.cssRules) rules.push(r.cssText); } catch {}
            }
            // Remove fixed overlays (page transitions, loaders)
            document.querySelectorAll('div').forEach(d => {
              try {
                const s = getComputedStyle(d);
                if (s.position === 'fixed' && parseInt(s.zIndex) > 500) d.remove();
              } catch {}
            });
            // Remove Next.js scripts (cause hydration mismatch on localhost)
            document.querySelectorAll('script').forEach(s => {
              const src = s.getAttribute('src') || '';
              if (src.includes('_next/') || s.id === '__NEXT_DATA__' || s.textContent?.includes('__NEXT')) s.remove();
            });

            // Remove Lenis/Locomotive smooth-scroll classes that block native scrolling
            // Lenis adds class="lenis" to <html> and uses overflow:clip to hijack scroll
            document.documentElement.classList.remove('lenis', 'lenis-smooth', 'lenis-stopped', 'lenis-scrolling');
            document.body.classList.remove('lenis', 'lenis-smooth', 'lenis-stopped', 'lenis-scrolling');
            // Remove Locomotive Scroll classes too
            document.documentElement.classList.remove('has-scroll-smooth', 'has-scroll-init');
            document.body.classList.remove('has-scroll-smooth', 'has-scroll-init');

            // === SPA UNFREEZE: Force GSAP/scroll-hidden elements visible ===
            // Uses getComputedStyle() to catch class-based hiding (not just inline).
            // IMPORTANT: Skip overlays (nav backdrop, modals) that are intentionally hidden.
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            document.querySelectorAll('*').forEach(el => {
              const htmlEl = el as HTMLElement;
              if (!htmlEl.style) return;
              const rect = htmlEl.getBoundingClientRect();
              if (rect.width < 2 && rect.height < 2) return;

              const cs = getComputedStyle(htmlEl);
              const cn = htmlEl.className?.toString().toLowerCase() || '';

              // --- SKIP: elements inside <nav> (overlays, transitions, mobile menu) ---
              if (htmlEl.closest('nav')) return;
              // --- SKIP OVERLAYS: elements that are intentionally hidden ---
              const isPositioned = cs.position === 'fixed' || cs.position === 'absolute';
              const coversViewport = rect.width > vw * 0.8 && rect.height > vh * 0.8;
              const isHidden = cs.opacity === '0' || cs.visibility === 'hidden';
              if (isPositioned && coversViewport && isHidden) return;
              if (/overlay|backdrop|modal|drawer/i.test(cn) && isHidden) return;

              // Force opacity (check COMPUTED, not just inline)
              if (cs.opacity === '0') {
                htmlEl.style.setProperty('opacity', '1', 'important');
              }
              // Force visibility
              if (cs.visibility === 'hidden') {
                htmlEl.style.setProperty('visibility', 'visible', 'important');
              }
              // Reset transforms that hide content off-screen (not all transforms!)
              const tf = cs.transform;
              if (tf && tf !== 'none') {
                // Only reset transforms that clearly push content away
                const m = tf.match(/matrix\(([^)]+)\)/);
                if (m) {
                  const parts = m[1].split(',').map(Number);
                  const translateY = parts[5] || 0;
                  // Large translateY values (>50px) = off-screen, reset them
                  if (Math.abs(translateY) > 50) {
                    htmlEl.style.setProperty('transform', 'none', 'important');
                  }
                }
              }

              // Force CSS custom properties used by scroll animations
              const cssText = htmlEl.style.cssText;
              if (cssText.includes('--animate-in')) htmlEl.style.setProperty('--animate-in', '1');
              if (cssText.includes('--slide-progress-in')) htmlEl.style.setProperty('--slide-progress-in', '1');
              if (cssText.includes('--slide-progress-out')) htmlEl.style.setProperty('--slide-progress-out', '0');
              if (cssText.includes('--slide-progress-before')) htmlEl.style.setProperty('--slide-progress-before', '0');
              if (cssText.includes('--intro-animation')) htmlEl.style.setProperty('--intro-animation', '1');
              if (cssText.includes('--show-overlay')) htmlEl.style.setProperty('--show-overlay', '0');
              // Reduce excessive sticky scroll heights (e.g. 1100vh → 100vh)
              if (cssText.includes('--sticky-height-desktop')) {
                const val = htmlEl.style.getPropertyValue('--sticky-height-desktop');
                if (val && parseInt(val) > 200) {
                  htmlEl.style.setProperty('--sticky-height-desktop', '100vh');
                  htmlEl.style.setProperty('--sticky-height-mobile', '100lvh');
                  htmlEl.style.setProperty('--sticky-height-tablet', '100vh');
                }
              }
            });

            // === CANVAS → IMAGE POSTER: Capture WebGL/Three.js canvases ===
            document.querySelectorAll('canvas').forEach(canvas => {
              try {
                const dataUrl = canvas.toDataURL('image/png');
                // Only replace if the canvas has actual content (not transparent)
                if (dataUrl.length > 1000) {
                  const img = document.createElement('img');
                  img.src = dataUrl;
                  img.className = canvas.className;
                  img.style.cssText = canvas.style.cssText;
                  img.style.width = canvas.offsetWidth + 'px';
                  img.style.height = canvas.offsetHeight + 'px';
                  img.setAttribute('alt', 'Captured 3D scene');
                  canvas.replaceWith(img);
                }
              } catch {
                // CORS or security error — canvas tainted, skip
              }
            });

            // === REMOVE ALL REMAINING SCRIPTS to kill scroll-hijacking JS ===
            document.querySelectorAll('script').forEach(s => s.remove());

            // Add a fix stylesheet at the END of body — generic rules, not site-specific
            const fixEl = document.createElement('style');
            fixEl.textContent = [
              // Unlock scroll on body — kill ALL scroll locks
              'html,body{overflow:visible!important;overflow-x:hidden!important;height:auto!important;max-height:none!important;position:static!important;}',
              '*{scroll-behavior:auto!important;}',
              // Hide page-transition overlays (common in Next.js/Barba sites)
              'div[class*="pageTransition"],div[class*="PageTransition"],div[class*="page-transition"]{display:none!important;}',
              // Hide nav overlay/transition layers ONLY (not the background bar)
              'nav [class*="overlayLayer"],nav [class*="OverlayLayer"]{display:none!important;}',
              'nav [class*="backgroundOverlay"],nav [class*="BackgroundOverlay"]{display:none!important;}',
              'nav [class*="navOpen"],nav [class*="NavOpen"]{display:none!important;}',
              // Force all media visible (GSAP often hides via class-based opacity)
              'img,video,picture,figure{opacity:1!important;visibility:visible!important;}',
              // Sticky wrappers that collapse to 0 height when children are absolute
              'div[class*="sticky"],div[class*="Sticky"]{min-height:100vh!important;}',
            ].join('\n');
            document.body.appendChild(fixEl);
            return '<!DOCTYPE html>' + document.documentElement.outerHTML;
          });
          if (inlinedHtml && inlinedHtml.length > 1000) {
            serverHtml = inlinedHtml;
          }
        } catch {}
      }

      let html: string;
      let title: string;
      let meta: Record<string, string> = {};
      let links: string[] = [];

      try {
        html = serverHtml || await page.content();
        title = await page.title();
        meta = await page.evaluate(() => {
          const metas: Record<string, string> = {};
          document.querySelectorAll('meta').forEach((m) => {
            const name = m.getAttribute('name') || m.getAttribute('property') || '';
            const content = m.getAttribute('content') || '';
            if (name && content) metas[name] = content;
          });
          return metas;
        });
        links = await page.evaluate((baseUrl: string) => {
          const anchors = Array.from(document.querySelectorAll('a[href]'));
          return anchors
            .map((a) => {
              try {
                const href = a.getAttribute('href') || '';
                if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:'))
                  return null;
                return new URL(href, baseUrl).href;
              } catch { return null; }
            })
            .filter((href): href is string => href !== null);
        }, this.config.url);
      } catch {
        // Playwright failed -- extract from server HTML
        html = serverHtml;
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        title = titleMatch ? titleMatch[1] : url;
        // Extract links from HTML with regex
        const linkMatches = html.matchAll(/href=["'](\/[^"'#]*?)["']/g);
        for (const m of linkMatches) {
          try { links.push(new URL(m[1], url).href); } catch {}
        }
      }

      if (!html) return null;

      // Get inline styles
      const inlineStyles = await page.evaluate(() => {
        const styles: StylesheetData[] = [];
        document.querySelectorAll('style').forEach((s) => {
          if (s.textContent) {
            styles.push({
              content: s.textContent,
              isExternal: false,
            });
          }
        });
        return styles;
      }) as StylesheetData[];

      collectedStylesheets.push(...inlineStyles);

      // Take screenshot (non-blocking -- don't let a screenshot failure kill the page)
      let screenshot: Buffer | undefined;
      try {
        screenshot = await page.screenshot({ fullPage: true, type: 'png' });
      } catch {
        try {
          // Fallback: viewport-only screenshot
          screenshot = await page.screenshot({ type: 'png' });
        } catch {
          logger.warn(`Screenshot échoué pour ${url}`);
        }
      }

      // Detect additional tech stack clues from the page
      const additionalTech = await page.evaluate(() => {
        const tech: string[] = [];
        if ((window as any).__NEXT_DATA__) tech.push('Next.js');
        if ((window as any).__NUXT__) tech.push('Nuxt');
        if (document.querySelector('[data-wf-site]')) tech.push('Webflow');
        if (document.querySelector('[data-astro-source-file]')) tech.push('Astro');
        if ((window as any).gsap) tech.push('GSAP');
        if ((window as any).Lenis) tech.push('Lenis');
        if ((window as any).THREE) tech.push('Three.js');
        if ((window as any).LocomotiveScroll) tech.push('Locomotive Scroll');
        if ((window as any).Swiper) tech.push('Swiper');
        if ((window as any).barba) tech.push('Barba.js');
        return tech;
      });
      additionalTech.forEach((t) => techStack.add(t));

      const pageData: PageData = {
        url,
        path: new URL(url).pathname,
        html,
        title,
        meta,
        links,
        scripts: collectedScripts,
        stylesheets: collectedStylesheets,
        assets: collectedAssets,
        fonts: collectedFonts,
        screenshot,
      };

      return pageData;
    } catch (err: any) {
      logger.warn(`Page timeout/error: ${url} - ${err.message}`);
      return null;
    } finally {
      await page.close();
    }
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let totalHeight = 0;
        const distance = 400;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            // Scroll back to top
            window.scrollTo(0, 0);
            resolve();
          }
        }, 100);
        // Safety timeout
        setTimeout(() => {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }, 10000);
      });
    });
    // Wait for lazy content to load
    await page.waitForTimeout(1500);
  }

  private detectFontFormat(url: string): string {
    if (url.includes('.woff2')) return 'woff2';
    if (url.includes('.woff')) return 'woff';
    if (url.includes('.ttf')) return 'truetype';
    if (url.includes('.otf')) return 'opentype';
    if (url.includes('.eot')) return 'embedded-opentype';
    return 'woff2';
  }

  private async gapFillMissingAssets(pages: PageData[]): Promise<void> {
    // Extract all image URLs from HTML across all pages
    const imageUrlPattern = /(?:src|data-src)=["'](https?:\/\/[^"']+\.(?:png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^"']*)?)["']/gi;
    const cssUrlPattern = /url\(['"]?(https?:\/\/[^'")\s]+\.(?:png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^'")\s]*)?)['"]?\)/gi;

    const allImageUrls = new Set<string>();

    for (const page of pages) {
      let match;
      // From src attributes
      const srcRegex = new RegExp(imageUrlPattern.source, 'gi');
      while ((match = srcRegex.exec(page.html)) !== null) {
        allImageUrls.add(match[1]);
      }
      // From CSS url() in inline styles
      const cssRegex = new RegExp(cssUrlPattern.source, 'gi');
      while ((match = cssRegex.exec(page.html)) !== null) {
        allImageUrls.add(match[1]);
      }
    }

    // Find which ones we're missing
    const missing: string[] = [];
    for (const url of allImageUrls) {
      if (!this.assets.has(url)) {
        missing.push(url);
      }
    }

    if (missing.length === 0) {
      logger.info('Aucune image manquante.');
      return;
    }

    logger.info(`${missing.length} images manquantes détectées, téléchargement...`);

    // Download missing images in parallel batches (with Referer to bypass CDN protections)
    const batchSize = 10;
    const refererHeaders = {
      'Referer': this.config.url,
      'Origin': new URL(this.config.url).origin,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    };
    for (let i = 0; i < missing.length; i += batchSize) {
      const batch = missing.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const response = await fetch(url, { headers: refererHeaders });
            if (!response.ok) return;
            const buffer = Buffer.from(await response.arrayBuffer());
            const contentType = response.headers.get('content-type') || '';
            const asset: AssetData = {
              url,
              localPath: `assets/images/${getAssetFilename(url)}`,
              type: contentType.includes('svg') ? 'svg' : 'image',
              mimeType: contentType,
              content: buffer,
            };
            this.assets.set(url, asset);
          } catch {
            // Skip unreachable images
          }
        })
      );
    }

    logger.success(`${this.assets.size - (allImageUrls.size - missing.length)} images récupérées au total`);

    // Also download external data files referenced in HTML (JSON, audio, 3D models)
    // These are often protected by Referer checks on CDNs (e.g. BunnyCDN)
    const dataUrlPattern = /["'](https?:\/\/[^"']+\.(?:json|glb|gltf|mp3|wav|ogg|mp4|webm))["']/gi;
    const dataUrls = new Set<string>();
    for (const page of pages) {
      let dm;
      const dataRegex = new RegExp(dataUrlPattern.source, 'gi');
      while ((dm = dataRegex.exec(page.html)) !== null) {
        const dataUrl = dm[1];
        if (dataUrl.includes('googleapis.com') || dataUrl.includes('cdnjs.') || dataUrl.includes('jsdelivr.net')) continue;
        // Skip script files
        if (dataUrl.endsWith('.js')) continue;
        dataUrls.add(dataUrl);
      }
    }

    if (dataUrls.size > 0) {
      logger.info(`${dataUrls.size} fichiers data/audio externes détectés, téléchargement...`);
      for (const dataUrl of dataUrls) {
        if (this.assets.has(dataUrl)) continue;
        try {
          const resp = await fetch(dataUrl, { headers: refererHeaders });
          if (!resp.ok) continue;
          const buffer = Buffer.from(await resp.arrayBuffer());
          const filename = getAssetFilename(dataUrl);
          // Classify by file type: videos go to assets/videos/, rest to assets/data/
          const isVideo = /\.(mp4|webm|ogv)(\?|$)/i.test(dataUrl);
          const asset: AssetData = {
            url: dataUrl,
            localPath: isVideo ? `assets/videos/${filename}` : `assets/data/${filename}`,
            type: isVideo ? 'video' : 'other',
            mimeType: resp.headers.get('content-type') || 'application/octet-stream',
            content: buffer,
          };
          this.assets.set(dataUrl, asset);
          logger.dim(`  ${filename}`);
        } catch {}
      }

      // Scan downloaded JSON files for additional CDN asset URLs (textures, images inside configs)
      for (const [url, asset] of this.assets.entries()) {
        if (!asset.mimeType.includes('json') || !asset.content) continue;
        try {
          const jsonText = asset.content.toString('utf-8');
          const innerUrls = jsonText.match(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|avif|gif|svg)/gi) || [];
          for (const innerUrl of innerUrls) {
            if (this.assets.has(innerUrl)) continue;
            try {
              const resp = await fetch(innerUrl, { headers: refererHeaders });
              if (!resp.ok) continue;
              const buf = Buffer.from(await resp.arrayBuffer());
              const fname = getAssetFilename(innerUrl);
              this.assets.set(innerUrl, {
                url: innerUrl,
                localPath: `assets/images/${fname}`,
                type: 'image',
                mimeType: resp.headers.get('content-type') || '',
                content: buf,
              });
              logger.dim(`  ${fname} (from JSON)`);
            } catch {}
          }
        } catch {}
      }
    }
  }

  getCollectedAssets(): Map<string, AssetData> {
    return this.assets;
  }

  getCollectedFonts(): Map<string, FontData> {
    return this.fonts;
  }
}
