import {
  CloneConfig,
  ExtractedData,
  ExtractedPage,
  ReconstructedSite,
  ReconstructedPage,
  FontData,
  ScriptData,
} from '../types.js';
import { logger } from '../utils/logger.js';
import { getDomain } from '../utils/url.js';

export class Reconstructor {
  private config: CloneConfig;
  private pagePathMap = new Map<string, string>(); // original path -> local filename

  constructor(config: CloneConfig) {
    this.config = config;
  }

  async reconstruct(data: ExtractedData): Promise<ReconstructedSite> {
    logger.step(3, 4, 'Reconstruction du site...');

    // Build the path -> filename mapping for internal link rewriting
    this.buildPathMap(data.pages);

    // Process and clean global CSS
    const globalCss = this.processGlobalCss(data.globalStyles, data.fonts);

    // Collect all script URLs from all pages (for inclusion)
    const allScriptUrls = this.collectScriptUrls(data);

    // Reconstruct each page
    const pages: ReconstructedPage[] = [];
    for (const page of data.pages) {
      const reconstructed = this.reconstructPage(page, data, allScriptUrls);
      pages.push(reconstructed);
      logger.info(`Reconstruit: ${reconstructed.filename}`);
    }

    logger.success(`Reconstruction terminée: ${pages.length} pages`);

    return {
      pages,
      globalCss,
      assets: data.assets,
      fonts: data.fonts,
      siteMetadata: data.siteMetadata,
    };
  }

  private buildPathMap(pages: ExtractedPage[]): void {
    for (const page of pages) {
      const originalPath = page.path;
      const filename = this.pathToFilename(originalPath);
      // Map all variations of the path
      this.pagePathMap.set(originalPath, filename);
      // Without trailing slash
      this.pagePathMap.set(originalPath.replace(/\/$/, ''), filename);
      // With trailing slash
      if (!originalPath.endsWith('/')) {
        this.pagePathMap.set(originalPath + '/', filename);
      }
    }
  }

  private pathToFilename(path: string): string {
    if (path === '/' || path === '') return 'index.html';
    const clean = path.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '-');
    return `${clean}.html`;
  }

  private collectScriptUrls(data: ExtractedData): string[] {
    const scripts = new Set<string>();
    for (const page of data.pages) {
      // We need the original page data which has scripts info
      // The scripts are collected during crawl, pass them through
    }
    return Array.from(scripts);
  }

  private processGlobalCss(rawCss: string, fonts: FontData[]): string {
    let fontFaces = '';
    const seenFonts = new Set<string>();

    for (const font of fonts) {
      const key = font.url || font.family;
      if (seenFonts.has(key)) continue;
      seenFonts.add(key);

      if (font.url) {
        const filename = this.getFontFilename(font.url);
        fontFaces += `
@font-face {
  font-family: '${font.family}';
  src: url('./assets/fonts/${filename}') format('${font.format || 'woff2'}');
  ${font.weight ? `font-weight: ${font.weight};` : ''}
  ${font.style ? `font-style: ${font.style};` : ''}
  font-display: swap;
}
`;
      }
    }

    let processedCss = rawCss;

    // Pre-process: replace CDN URLs that contain escaped parentheses in filenames
    // Uses lazy .*? to match through \( and \) to reach the file extension
    processedCss = processedCss.replace(
      /url\((https?:\/\/cdn\.prod\.website-files\.com\/.*?\.(?:webp|png|jpe?g|gif|svg|avif|ico|woff2?|ttf|otf|eot))\)/gi,
      (match, rawUrl) => {
        const cleanUrl = rawUrl.replace(/\\/g, '');
        if (/\.(woff2?|ttf|otf|eot)$/i.test(cleanUrl)) {
          return `url('./assets/fonts/${this.getFontFilename(cleanUrl)}')`;
        }
        const filename = this.getAssetFilename(cleanUrl);
        if (filename && filename.length > 5) {
          return `url('./assets/images/${filename}')`;
        }
        return match;
      }
    );

    // Rewrite url() references to local paths
    // Use a robust regex that handles parentheses in filenames (e.g. "Grain (1).webp")
    processedCss = processedCss.replace(
      /url\((['"]?)(https?:\/\/[^'"]*?\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^'")]*)?)\1\)/gi,
      (match, quote, url) => {
        if (/\.(woff2?|ttf|otf|eot)(\?|$)/i.test(url)) {
          return `url('./assets/fonts/${this.getFontFilename(url)}')`;
        }
        if (/\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(url)) {
          return `url('./assets/images/${this.getAssetFilename(url)}')`;
        }
        return match;
      }
    );

    // Catch-all: replace any remaining CDN url() references that the main regex missed
    // (handles escaped parens, unusual encodings, etc.)
    processedCss = processedCss.replace(
      /url\(([^)]*(?:cdn\.prod\.website-files\.com|assets\.website-files\.com)[^)]*)\)/g,
      (match, inner) => {
        // Clean up the inner content: remove quotes, backslash escapes
        let cleanUrl = inner.replace(/['"]/g, '').replace(/\\/g, '');
        // Try to find the image extension
        const extMatch = cleanUrl.match(/\.(png|jpe?g|gif|webp|avif|svg|ico)/i);
        if (extMatch) {
          // Truncate after the extension
          const extIdx = cleanUrl.indexOf(extMatch[0]) + extMatch[0].length;
          cleanUrl = cleanUrl.substring(0, extIdx);
          const filename = this.getAssetFilename(cleanUrl);
          if (filename && filename.length > 5) {
            return `url('./assets/images/${filename}')`;
          }
        }
        const fontMatch = cleanUrl.match(/\.(woff2?|ttf|otf|eot)/i);
        if (fontMatch) {
          const extIdx = cleanUrl.indexOf(fontMatch[0]) + fontMatch[0].length;
          cleanUrl = cleanUrl.substring(0, extIdx);
          const filename = this.getFontFilename(cleanUrl);
          return `url('./assets/fonts/${filename}')`;
        }
        return match;
      }
    );

    // Remove Webflow badge
    processedCss = processedCss
      .replace(/\.w-webflow-badge[\s\S]*?\}/g, '')
      .replace(/\n{3,}/g, '\n\n');

    return fontFaces + '\n' + processedCss;
  }

  private reconstructPage(
    page: ExtractedPage,
    data: ExtractedData,
    scriptUrls: string[]
  ): ReconstructedPage {
    const filename = this.pathToFilename(page.path);
    let html = page.cleanHtml;

    // === 1. Remove broken srcset/sizes (responsive variants we didn't download) ===
    html = html.replace(/\s*srcset="[^"]*"/g, '');
    html = html.replace(/\s*srcset='[^']*'/g, '');
    html = html.replace(/\s*sizes="[^"]*"/g, '');
    html = html.replace(/\s*sizes='[^']*'/g, '');

    // Remove loading="lazy" for immediate loading
    html = html.replace(/\s*loading="lazy"/g, '');
    html = html.replace(/\s*loading="eager"/g, '');

    // === 1.5. Light cleanup ===
    // With initial HTML capture, the DOM is already pre-JS (no GSAP states).
    // Only remove tracking/analytics artifacts if any slipped through.
    html = html.replace(/; opacity: 0;"/g, ';"');

    // Clean empty styles
    html = html.replace(/ style=""/g, '');
    html = html.replace(/ style=" "/g, '');

    // === 1.8. For Next.js/framework sites: rewrite /_next/ paths to original server ===
    // These are JS bundles, CSS, and image API endpoints that can't be served locally
    const domain = getDomain(this.config.url);
    const origin = `https://${domain}`;

    // Rewrite relative /_next/ paths to absolute URLs on original server
    html = html.replace(
      /(href|src)=["'](\/(?:_next|_vercel|__next)\b[^"']*?)["']/g,
      (match, attr, path) => {
        return `${attr}="${origin}${path}"`;
      }
    );

    // Rewrite Next.js image optimization URLs to direct image URLs
    // /_next/image?url=https%3A%2F%2Fimages.prismic.io%2F... → direct prismic URL
    html = html.replace(
      /\/_next\/image\?url=([^&"']+)(?:&[^"']*)?/g,
      (match, encodedUrl) => {
        try {
          return decodeURIComponent(encodedUrl);
        } catch {
          return match;
        }
      }
    );

    // === 2. Rewrite internal links ===
    html = this.rewriteInternalLinks(html, domain);

    // === 3. Rewrite image/video src to local paths ===
    html = html.replace(
      /(src|data-src)=['"]?(https?:\/\/[^'">\s,]+)['"]?/g,
      (match, attr, url) => {
        // Skip script URLs -- we keep those from CDN
        if (/\.(js)(\?|$)/i.test(url)) return match;
        if (/\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(url)) {
          return `${attr}="./assets/images/${this.getAssetFilename(url)}"`;
        }
        if (/\.(mp4|webm|ogv)(\?|$)/i.test(url)) {
          return `${attr}="./assets/videos/${this.getVideoFilename(url)}"`;
        }
        return match;
      }
    );

    // === 4. Rewrite CSS background-image URLs in inline styles ===
    html = html.replace(
      /url\((['"]?)(https?:\/\/[^'"]*?\.(?:png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^'")]*)?)\1\)/gi,
      (match, quote, url) => {
        if (/\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/i.test(url)) {
          return `url('./assets/images/${this.getAssetFilename(url)}')`;
        }
        return match;
      }
    );

    // === 5. Rewrite preload/prefetch href for assets ===
    html = html.replace(
      /href="(https?:\/\/[^"]+\.(png|jpe?g|gif|webp|avif|svg|ico)(\?[^"]*)?)"/g,
      (match, url) => {
        return `href="./assets/images/${this.getAssetFilename(url)}"`;
      }
    );

    // === 6. Rewrite external data/audio file URLs to local paths ===
    html = html.replace(
      /["'](https?:\/\/[^"']+\.(?:json|glb|gltf|mp3|wav|ogg)(?:\?[^"']*)?)["']/g,
      (match, url) => {
        // Skip common CDN scripts that shouldn't be localized
        if (url.includes('googleapis.com') || url.includes('cdnjs.') || url.includes('jsdelivr.net')) return match;
        if (url.endsWith('.js')) return match;
        const quote = match[0];
        const filename = this.getAssetFilename(url);
        return `${quote}./assets/data/${filename}${quote}`;
      }
    );

    // === 7. Remove the Webflow badge ===
    html = html.replace(/<a[^>]*class="[^"]*w-webflow-badge[^"]*"[^>]*>[\s\S]*?<\/a>/g, '');

    // === 8. Make videos autoplay (scroll-driven videos are frozen without JS) ===
    html = html.replace(/<video([^>]*)>/g, (match, attrs) => {
      let newAttrs = attrs;
      if (!newAttrs.includes('autoplay')) newAttrs += ' autoplay';
      if (!newAttrs.includes('muted')) newAttrs += ' muted';
      if (!newAttrs.includes('loop')) newAttrs += ' loop';
      if (!newAttrs.includes('playsinline')) newAttrs += ' playsinline';
      return `<video${newAttrs}>`;
    });

    // Inject our local CSS into the existing <head> (preserve the original HTML structure)
    // This keeps all data-attributes, Barba wrappers, meta tags, script ordering intact.
    if (html.includes('</head>')) {
      html = html.replace('</head>', `  <link rel="stylesheet" href="./styles.css">\n</head>`);
    }

    const fullHtml = html;

    return {
      path: page.path,
      filename,
      html: fullHtml,
      title: page.title,
    };
  }

  private rewriteInternalLinks(html: string, domain: string): string {
    // Rewrite href="/path" to href="./local-file.html"
    // Also handle href="/path/" with trailing slash
    return html.replace(
      /href="(\/[^"]*?)"/g,
      (match, path) => {
        // Skip anchors like href="#"
        if (path === '#' || path.startsWith('/#')) return match;

        // Skip external protocol links
        if (path.startsWith('//')) return match;

        // Check if this path maps to a cloned page
        const localFile = this.pagePathMap.get(path) || this.pagePathMap.get(path.replace(/\/$/, ''));

        if (localFile) {
          return `href="./${localFile}"`;
        }

        // For paths we didn't clone, keep original with full URL
        return `href="https://${domain}${path}"`;
      }
    );
  }

  private buildInlineStyles(inlineStyles: Map<string, string> | Record<string, string>): string {
    const entries =
      inlineStyles instanceof Map
        ? Array.from(inlineStyles.entries())
        : Object.entries(inlineStyles);

    if (entries.length === 0) return '';

    return entries
      .map(([selector, style]) => `${selector} { ${style} }`)
      .join('\n    ');
  }

  private sanitizeFilename(raw: string): string {
    let name = raw.split('?')[0];
    try { name = decodeURIComponent(name); } catch { /* keep as-is */ }
    return name.replace(/\s+/g, '-').replace(/[()]/g, '');
  }

  private getFontFilename(url: string): string {
    try {
      const parsed = new URL(url);
      return this.sanitizeFilename(parsed.pathname.split('/').pop() || 'font.woff2');
    } catch {
      return 'font.woff2';
    }
  }

  private getAssetFilename(url: string): string {
    try {
      const parsed = new URL(url);
      return this.sanitizeFilename(parsed.pathname.split('/').pop() || 'image.png');
    } catch {
      return 'image.png';
    }
  }

  private getVideoFilename(url: string): string {
    try {
      const parsed = new URL(url);
      return this.sanitizeFilename(parsed.pathname.split('/').pop() || 'video.mp4');
    } catch {
      return 'video.mp4';
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
