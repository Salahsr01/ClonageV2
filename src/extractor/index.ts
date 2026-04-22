import {
  CloneConfig,
  CrawlResult,
  ExtractedData,
  ExtractedPage,
  FontData,
  AssetData,
  AnimationData,
} from '../types.js';
import { logger } from '../utils/logger.js';

export class Extractor {
  private config: CloneConfig;
  private collectedAssets: Map<string, AssetData>;
  private collectedFonts: Map<string, FontData>;

  constructor(
    config: CloneConfig,
    assets: Map<string, AssetData>,
    fonts: Map<string, FontData>
  ) {
    this.config = config;
    this.collectedAssets = assets;
    this.collectedFonts = fonts;
  }

  async extract(crawlResult: CrawlResult): Promise<ExtractedData> {
    logger.step(2, 4, 'Extraction des styles et assets...');

    const extractedPages: ExtractedPage[] = [];

    // Collect all CSS from stylesheets
    let globalStyles = '';
    const allStylesheetContents = new Set<string>();

    for (const page of crawlResult.pages) {
      for (const ss of page.stylesheets) {
        if (ss.content && !allStylesheetContents.has(ss.content)) {
          allStylesheetContents.add(ss.content);
          globalStyles += `\n/* Source: ${ss.url || 'inline'} */\n${ss.content}\n`;
        }
      }
    }

    // With initial HTML capture (pre-JS), we use the HTML directly from the Crawler.
    // No need to re-navigate -- the HTML is already the clean server response.
    for (const pageData of crawlResult.pages) {
      logger.info(`Extraction: ${pageData.path || '/'}`);

      // Use the FULL server HTML (keeping <html>, <head>, <body> with all data-attributes).
      // This preserves Barba.js wrappers, meta tags, script ordering, etc.
      let cleanHtml = pageData.html;

      // Remove tracking scripts (keep framework scripts)
      cleanHtml = cleanHtml.replace(
        /<script[^>]*>[\s\S]*?<\/script>/gi,
        (match) => {
          const isTracker = /google|analytics|gtag|gtm|facebook|fbq|hotjar|segment|mixpanel/i.test(match);
          if (isTracker) return '';

          // Keep scripts with src (CDN/framework scripts)
          if (/src=/.test(match)) return match;

          // Remove small inline scripts (usually tracking snippets)
          const content = match.replace(/<\/?script[^>]*>/gi, '');
          if (content.length < 200) return '';

          return match;
        }
      );

      // Remove unwanted elements
      const removePatterns = [
        /<noscript[\s\S]*?<\/noscript>/gi,
        /<iframe[^>]*(?:google|analytics|facebook|doubleclick)[^>]*>[\s\S]*?<\/iframe>/gi,
        /<!--[\s\S]*?-->/g, // HTML comments
      ];
      for (const pattern of removePatterns) {
        cleanHtml = cleanHtml.replace(pattern, '');
      }

      extractedPages.push({
        url: pageData.url,
        path: pageData.path,
        title: pageData.title,
        meta: pageData.meta,
        cleanHtml,
        styles: '',
        inlineStyles: {},
        animations: [],
        screenshot: pageData.screenshot,
      });
    }

    logger.success(
      `Extraction terminée: ${extractedPages.length} pages, ${this.collectedFonts.size} fonts`
    );

    return {
      pages: extractedPages,
      globalStyles,
      fonts: Array.from(this.collectedFonts.values()),
      assets: Array.from(this.collectedAssets.values()),
      siteMetadata: crawlResult.siteMetadata,
    };
  }
}
