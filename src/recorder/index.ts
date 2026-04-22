import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { RecordConfig, RecordingMetadata } from '../types.js';
import { getDomain } from '../utils/url.js';
import { logger } from '../utils/logger.js';

export class Recorder {
  private config: RecordConfig;

  constructor(config: RecordConfig) {
    this.config = config;
  }

  async record(): Promise<string> {
    const domain = getDomain(this.config.url);
    const timestamp = new Date().toISOString().split('T')[0];
    const outputDir = path.resolve(this.config.outputDir, `${domain}_${timestamp}`);
    const harPath = path.join(outputDir, 'recording.har');
    const screenshotsDir = path.join(outputDir, 'screenshots');

    // Create output directories
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(screenshotsDir, { recursive: true });

    logger.step(1, 3, 'Lancement du navigateur...');

    const browser = await chromium.launch({
      headless: this.config.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      recordHar: {
        path: harPath,
        mode: 'full',
        content: 'embed', // Embed response bodies in the HAR
      },
      viewport: {
        width: this.config.viewport.width,
        height: this.config.viewport.height,
      },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    });

    const techStack = new Set<string>();
    const mediaUrls = new Set<string>(); // Collect video/audio URLs for separate download

    // Detect tech stack + collect media URLs from network requests
    context.on('response', (response) => {
      const url = response.url();
      const ct = response.headers()['content-type'] || '';

      // Collect video/audio URLs (HAR doesn't embed Range-requested bodies)
      if (ct.includes('video') || ct.includes('audio') || /\.(mp4|webm|ogv|mp3|wav|ogg)(\?|$)/i.test(url)) {
        mediaUrls.add(url.split('?')[0]); // Deduplicate by stripping query params
      }

      if (url.includes('gsap') || url.includes('greensock')) techStack.add('GSAP');
      if (url.includes('three')) techStack.add('Three.js');
      if (url.includes('lenis')) techStack.add('Lenis');
      if (url.includes('locomotive')) techStack.add('Locomotive Scroll');
      if (url.includes('framer-motion')) techStack.add('Framer Motion');
      if (url.includes('react')) techStack.add('React');
      if (url.includes('next')) techStack.add('Next.js');
      if (url.includes('barba')) techStack.add('Barba.js');
      if (url.includes('swiper')) techStack.add('Swiper');
      if (url.includes('webflow')) techStack.add('Webflow');
    });

    logger.step(2, 3, `Enregistrement de ${this.config.url}...`);

    const page = await context.newPage();

    try {
      await page.goto(this.config.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });

      // Wait for initial load
      await page.waitForTimeout(3000);

      // Screenshot: top of page
      await this.takeScreenshot(page, screenshotsDir, 'viewport-top');

      // Detect tech stack from window globals
      const pageTech = await page.evaluate(() => {
        const tech: string[] = [];
        if ((window as any).__NEXT_DATA__) tech.push('Next.js');
        if ((window as any).__NUXT__) tech.push('Nuxt');
        if ((window as any).gsap) tech.push('GSAP');
        if ((window as any).Lenis) tech.push('Lenis');
        if ((window as any).THREE) tech.push('Three.js');
        if ((window as any).LocomotiveScroll) tech.push('Locomotive Scroll');
        if ((window as any).Swiper) tech.push('Swiper');
        if ((window as any).barba) tech.push('Barba.js');
        if (document.querySelector('[data-wf-site]')) tech.push('Webflow');
        return tech;
      });
      pageTech.forEach((t) => techStack.add(t));

      // Auto-scroll to trigger lazy-load + ScrollTrigger
      logger.info('Auto-scroll pour charger le contenu lazy...');
      await this.autoScroll(page, screenshotsDir);

      // Wait for everything to settle after scroll
      await page.waitForTimeout(3000);

      // Final full-page screenshot
      try {
        await this.takeScreenshot(page, screenshotsDir, 'full-page');
      } catch {
        logger.warn('Screenshot pleine page échoué (page trop grande)');
      }
    } catch (err: any) {
      logger.warn(`Navigation partielle: ${err.message}`);
    }

    // Close context → HAR is written to disk
    logger.step(3, 4, 'Sauvegarde du HAR...');
    await context.close();
    await browser.close();

    // Download media files separately (HAR doesn't capture Range-requested video bodies)
    logger.step(4, 4, 'Téléchargement des médias...');
    const mediaDir = path.join(outputDir, 'media');
    const mediaManifest: Record<string, string> = {};
    if (mediaUrls.size > 0) {
      fs.mkdirSync(mediaDir, { recursive: true });
      for (const mediaUrl of mediaUrls) {
        try {
          const filename = mediaUrl.split('/').pop() || 'media';
          const filePath = path.join(mediaDir, filename);
          logger.info(`  Téléchargement: ${filename}`);
          const resp = await fetch(mediaUrl, {
            headers: {
              'Referer': this.config.url,
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
          });
          if (resp.ok) {
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(filePath, buffer);
            mediaManifest[mediaUrl] = filename;
            logger.dim(`    ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
          }
        } catch {
          logger.warn(`  Échec: ${mediaUrl}`);
        }
      }
      // Save manifest mapping URL → local filename
      fs.writeFileSync(path.join(mediaDir, '_manifest.json'), JSON.stringify(mediaManifest, null, 2));
    }

    // Write metadata
    const harSize = fs.existsSync(harPath) ? fs.statSync(harPath).size : 0;
    const screenshotCount = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith('.png')).length;

    const metadata: RecordingMetadata = {
      url: this.config.url,
      domain,
      recordedAt: new Date().toISOString(),
      techStack: Array.from(techStack),
      pageCount: 1,
      harSize,
      screenshotCount,
    };

    fs.writeFileSync(path.join(outputDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

    logger.success(`
Enregistrement terminé !
  Dossier:      ${outputDir}
  HAR:          ${(harSize / 1024 / 1024).toFixed(1)} MB
  Screenshots:  ${screenshotCount}
  Tech stack:   ${Array.from(techStack).join(', ') || 'Non détectée'}
`);

    return outputDir;
  }

  private async autoScroll(page: Page, screenshotsDir: string): Promise<void> {
    const viewportHeight = this.config.viewport.height;
    const MAX_STEPS = 60;
    const MAX_GROWTH_RATIO = 3;

    const initialHeight = await page.evaluate(() => document.body.scrollHeight);
    let plannedSteps = Math.ceil(initialHeight / viewportHeight);
    if (plannedSteps > MAX_STEPS) {
      logger.info(`Page très longue (${Math.round(initialHeight / 1000)}k px) — cap à ${MAX_STEPS} steps`);
      plannedSteps = MAX_STEPS;
    }

    let screenshotIndex = 1;
    let currentY = 0;

    for (let i = 1; i <= plannedSteps; i++) {
      currentY = i * viewportHeight;
      await page.evaluate((scrollY) => window.scrollTo({ top: scrollY, behavior: 'smooth' }), currentY);
      await page.waitForTimeout(800);

      // GSAP ScrollTrigger pin peut gonfler scrollHeight pendant le scroll — stop si croissance excessive
      const liveHeight = await page.evaluate(() => document.body.scrollHeight);
      if (liveHeight > initialHeight * MAX_GROWTH_RATIO) {
        logger.info(`scrollHeight a explosé (${Math.round(liveHeight / 1000)}k px) — arrêt à step ${i}`);
        break;
      }

      if (i % 2 === 0 || i === plannedSteps) {
        await this.takeScreenshot(page, screenshotsDir, `scroll-${screenshotIndex++}`);
      }

      if (currentY >= liveHeight - viewportHeight) break;
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(500);
  }

  private async takeScreenshot(page: Page, dir: string, name: string): Promise<void> {
    try {
      const buffer = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(dir, `${name}.png`), buffer);
    } catch {
      // Non-critical — skip silently
    }
  }
}
