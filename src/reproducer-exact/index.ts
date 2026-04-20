import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { ReproduceExactOptions, ReproduceExactResult } from './types.js';
import { detectSection } from './section-detector.js';
import { snapshotSubtree } from './style-snapshot.js';
import { inlineAssets } from './asset-inliner.js';
import { logger } from '../utils/logger.js';

export async function reproduceExact(options: ReproduceExactOptions): Promise<ReproduceExactResult> {
  const viewport = options.viewport ?? { width: 1920, height: 1080 };
  const entryFile = options.entryFile ?? 'index.html';
  const diffThreshold = options.diffThreshold ?? 0.02;

  const entryPath = path.resolve(options.clonePath, entryFile);
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Clone entry file not found: ${entryPath}`);
  }

  fs.mkdirSync(options.outputDir, { recursive: true });

  logger.step(1, 4, 'Lancement du navigateur headless...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });

  try {
    await page.goto(`file://${entryPath}`, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    logger.step(2, 4, 'Detection de la section...');
    const candidate = await detectSection(page, { section: options.section });
    logger.info(`Section: ${candidate.selector} (${candidate.method}, coverage ${(candidate.viewportCoverage * 100).toFixed(1)}%)`);

    logger.step(3, 4, 'Snapshot des styles calcules...');
    const snapshotHtml = await snapshotSubtree(page, candidate.selector);

    logger.step(4, 4, 'Inlining des assets (fonts + images)...');
    const inlined = await inlineAssets(page, snapshotHtml);

    const finalHtml = buildStandaloneHtml(inlined.headStyles, inlined.subtreeHtml);

    const sectionName = sanitizeFilename(options.section ?? 'auto');
    const outputHtmlPath = path.join(options.outputDir, `${sectionName}.html`);
    fs.writeFileSync(outputHtmlPath, finalHtml, 'utf-8');

    // TODO(Task 7): visual verification
    const diffScore = 0;
    const passed = diffScore <= diffThreshold;

    const metadata = {
      clonePath: options.clonePath,
      entryFile,
      sectionSelector: candidate.selector,
      detectionMethod: candidate.method,
      boundingBox: candidate.boundingBox,
      viewportCoverage: candidate.viewportCoverage,
      lcpSize: candidate.lcpSize,
      viewport,
      assetsInlined: inlined.inlined,
      assetsFailed: inlined.failed,
      diffScore,
      diffThreshold,
      passed,
      timestamp: new Date().toISOString(),
    };
    const metadataPath = path.join(options.outputDir, '_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    logger.success(`Reproduit: ${outputHtmlPath} (fonts ${inlined.inlined.fonts}/${inlined.inlined.fonts + inlined.failed.fonts}, images ${inlined.inlined.images}/${inlined.inlined.images + inlined.failed.images})`);

    return {
      outputHtml: outputHtmlPath,
      metadataPath,
      diffScore,
      passed,
      sectionSelector: candidate.selector,
      detectionMethod: candidate.method,
    };
  } finally {
    await browser.close();
  }
}

function buildStandaloneHtml(headStyles: string, subtreeHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${headStyles}
<style>
  body { margin: 0; }
</style>
</head>
<body>
${subtreeHtml}
</body>
</html>`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
}
