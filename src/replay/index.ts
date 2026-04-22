import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ReplayConfig, RecordingMetadata } from '../types.js';
import { logger } from '../utils/logger.js';

export class Replay {
  private config: ReplayConfig;

  constructor(config: ReplayConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const recordingDir = path.resolve(this.config.recordingDir);
    const harPath = path.join(recordingDir, 'recording.har');
    const metadataPath = path.join(recordingDir, 'metadata.json');

    if (!fs.existsSync(harPath)) {
      throw new Error(`HAR non trouvé: ${harPath}\nLancez d'abord: clonage record <url>`);
    }

    // Load metadata
    let metadata: RecordingMetadata | null = null;
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    }

    if (!metadata || !metadata.url) {
      throw new Error('URL non trouvée dans metadata.json');
    }

    const url = metadata.url;

    logger.info(`Replay de ${metadata.domain} (enregistré le ${metadata.recordedAt.split('T')[0]})`);
    if (metadata.techStack.length > 0) {
      logger.dim(`  Tech stack: ${metadata.techStack.join(', ')}`);
    }

    // Launch VISIBLE browser
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security', // Allow cross-origin for HAR replay
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    // Register HAR routes FIRST (lower priority in Playwright's LIFO order)
    await context.routeFromHAR(harPath, {
      url: '**/*',
      notFound: this.config.notFound,
    });

    // Register media routes AFTER HAR (higher priority — LIFO means last = first checked)
    // HAR can't replay Range-requested video bodies, so we serve them from local files
    const mediaDir = path.join(recordingDir, 'media');
    const manifestPath = path.join(mediaDir, '_manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const [mediaUrl, filename] of Object.entries(manifest)) {
        const filePath = path.join(mediaDir, filename);
        if (!fs.existsSync(filePath)) continue;
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
          mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';
        await context.route((reqUrl) => reqUrl.toString().includes(filename), async (route) => {
          const body = fs.readFileSync(filePath);
          await route.fulfill({ body, contentType: mime });
        });
        logger.dim(`  Media local: ${filename}`);
      }
    }

    const page = await context.newPage();

    logger.success(`Clone vivant lancé !`);
    logger.info(`  Le navigateur Chromium s'ouvre avec le site fonctionnel.`);
    logger.info(`  JS vivant — animations, scroll, interactions préservés.`);
    logger.dim(`  Fermez le navigateur pour arrêter.`);

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Keep the process alive until browser is closed
    await new Promise<void>((resolve) => {
      browser.on('disconnected', () => {
        logger.info('Navigateur fermé. Arrêt du replay.');
        resolve();
      });
    });
  }
}
