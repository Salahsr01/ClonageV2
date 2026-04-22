/**
 * Deep Extractor — orchestrates token, animation, and component extraction
 * from a Clone Vivant (HAR recording replayed via Playwright).
 *
 * This is the bridge between Phase 1 (Clone Vivant) and Phase 3 (Regeneration).
 * It opens the clone in Playwright with HAR replay, then injects extraction
 * scripts to pull out everything that makes the site look premium.
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { DeepExtraction, RecordingMetadata } from '../types.js';
import { extractDesignTokens } from './tokens.js';
import { extractAnimations } from './animations.js';
import { extractComponents } from './components.js';
import { logger } from '../utils/logger.js';

interface ExtractOptions {
  recordingDir: string;
  tokens: boolean;
  animations: boolean;
  components: boolean;
  screenshotCount: number;
}

export class DeepExtractor {
  private options: ExtractOptions;

  constructor(options: ExtractOptions) {
    this.options = options;
  }

  async extract(): Promise<DeepExtraction> {
    const recordingDir = path.resolve(this.options.recordingDir);
    const harPath = path.join(recordingDir, 'recording.har');
    const metadataPath = path.join(recordingDir, 'metadata.json');

    if (!fs.existsSync(harPath)) {
      throw new Error(`HAR non trouve: ${harPath}\nLancez d'abord: clonage record <url>`);
    }

    const metadata: RecordingMetadata = fs.existsSync(metadataPath)
      ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
      : { url: '', domain: 'unknown', recordedAt: '', techStack: [], pageCount: 0, harSize: 0, screenshotCount: 0 };

    if (!metadata.url) {
      throw new Error('URL non trouvee dans metadata.json');
    }

    logger.step(1, 5, `Lancement du clone vivant: ${metadata.domain}...`);

    // Launch browser with HAR replay
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    await context.routeFromHAR(harPath, {
      url: '**/*',
      notFound: 'fallback',
    });

    // Also route local media files if present
    const mediaDir = path.join(recordingDir, 'media');
    const manifestPath = path.join(mediaDir, '_manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const [, filename] of Object.entries(manifest)) {
        const filePath = path.join(mediaDir, filename);
        if (!fs.existsSync(filePath)) continue;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
          mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
        };
        await context.route(url => url.toString().includes(filename), async route => {
          await route.fulfill({ body: fs.readFileSync(filePath), contentType: mimeMap[ext] || 'application/octet-stream' });
        });
      }
    }

    const page = await context.newPage();
    await page.goto(metadata.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => {
      logger.warn('Navigation partielle — extraction quand meme...');
    });

    // Wait for JS to execute and render
    await page.waitForTimeout(5000);

    // Scroll through the page to trigger lazy content + ScrollTrigger
    logger.info('Scroll complet pour trigger les animations...');
    await this.scrollThrough(page);

    // Create extraction output directory
    const extractionDir = path.join(recordingDir, 'extraction');
    fs.mkdirSync(extractionDir, { recursive: true });

    // ── Extract tokens ───────────────────────────────────────
    let tokens = null;
    if (this.options.tokens) {
      logger.step(2, 5, 'Extraction des design tokens...');
      try {
        tokens = await extractDesignTokens(page);
        fs.writeFileSync(
          path.join(extractionDir, 'design-tokens.json'),
          JSON.stringify(tokens, null, 2)
        );
        logger.success(`  Couleurs: ${tokens.colors.palette.length} | Spacing: ${tokens.spacing.scale.length} valeurs | Fonts: ${tokens.typography.fonts.length}`);
      } catch (err: any) {
        logger.warn(`  Tokens extraction failed: ${err.message}`);
      }
    }

    // ── Extract animations ───────────────────────────────────
    let animations = null;
    if (this.options.animations) {
      logger.step(3, 5, 'Extraction des animations...');
      try {
        animations = await extractAnimations(page);
        fs.writeFileSync(
          path.join(extractionDir, 'animations.json'),
          JSON.stringify(animations, null, 2)
        );
        const gsapCount = animations.gsap ? countGsapEntries(animations.gsap.timeline) : 0;
        const stCount = animations.gsap?.scrollTriggers.length || 0;
        logger.success(`  GSAP tweens: ${gsapCount} | ScrollTriggers: ${stCount} | CSS anims: ${animations.cssAnimations.length} | Transitions: ${animations.transitions.length}`);
      } catch (err: any) {
        logger.warn(`  Animation extraction failed: ${err.message}`);
      }
    }

    // ── Extract components ───────────────────────────────────
    let components: any[] = [];
    if (this.options.components) {
      logger.step(4, 5, 'Detection des composants...');
      try {
        components = await extractComponents(page, metadata.domain);
        fs.writeFileSync(
          path.join(extractionDir, 'components.json'),
          JSON.stringify(components, null, 2)
        );
        const types = [...new Set(components.map(c => c.type))];
        logger.success(`  ${components.length} composants: ${types.join(', ')}`);
      } catch (err: any) {
        logger.warn(`  Component extraction failed: ${err.message}`);
      }
    }

    // ── Screenshots at scroll positions ──────────────────────
    logger.step(5, 5, 'Capture des screenshots...');
    const screenshotsDir = path.join(extractionDir, 'screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });

    // Scroll back to top first
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);

    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = 1080;
    const screenshotPaths: string[] = [];

    const stepSize = Math.max(viewportHeight, Math.floor(scrollHeight / this.options.screenshotCount));
    let screenshotIndex = 0;

    for (let y = 0; y <= scrollHeight; y += stepSize) {
      await page.evaluate(scrollY => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(500);
      const screenshotPath = path.join(screenshotsDir, `scroll-${screenshotIndex}.png`);
      try {
        const buffer = await page.screenshot({ type: 'png' });
        fs.writeFileSync(screenshotPath, buffer);
        screenshotPaths.push(screenshotPath);
        screenshotIndex++;
      } catch {
        // Skip failed screenshots
      }
    }

    logger.success(`  ${screenshotPaths.length} screenshots captures`);

    await browser.close();

    // Build the final extraction object
    const extraction: DeepExtraction = {
      domain: metadata.domain,
      url: metadata.url,
      extractedAt: new Date().toISOString(),
      tokens: tokens || createEmptyTokens(),
      animations: animations || { gsap: null, cssAnimations: [], transitions: [], scrollPatterns: [] },
      components,
      screenshotPaths,
    };

    // Save the complete extraction
    fs.writeFileSync(
      path.join(extractionDir, 'extraction.json'),
      JSON.stringify(extraction, null, 2)
    );

    logger.success(`\nExtraction complete: ${extractionDir}/`);

    return extraction;
  }

  /**
   * Slowly scroll through the entire page to trigger lazy content and scroll animations.
   */
  private async scrollThrough(page: Page): Promise<void> {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const step = 300;
    const totalSteps = Math.ceil(scrollHeight / step);

    for (let i = 0; i <= totalSteps; i++) {
      await page.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), i * step);
      await page.waitForTimeout(200);
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function countGsapEntries(entries: any[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.type === 'tween') count++;
    if (e.children) count += countGsapEntries(e.children);
  }
  return count;
}

function createEmptyTokens(): DeepExtraction['tokens'] {
  return {
    colors: { palette: [], backgrounds: [], texts: [], accents: [], gradients: [] },
    spacing: { values: [], baseUnit: 8, ratio: null, scale: [4, 8, 16, 24, 32, 48, 64, 96], sectionPaddings: [] },
    typography: { fonts: [], scale: [], baseSize: 16, scaleRatio: null },
    borders: { radii: [], widths: [] },
    effects: { shadows: [], blendModes: [], filters: [], backdropFilters: [] },
  };
}
