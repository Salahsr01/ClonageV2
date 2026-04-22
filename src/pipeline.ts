import { CloneConfig, DEFAULT_CONFIG, AssetData } from './types.js';
import { Crawler } from './crawler/index.js';
import { Extractor } from './extractor/index.js';
import { Reconstructor } from './reconstructor/index.js';
import { Exporter } from './exporter/index.js';
import { killExistingServer, startServer } from './server.js';
import { logger } from './utils/logger.js';
import { getAssetFilename } from './utils/url.js';

export async function cloneSite(userConfig: Partial<CloneConfig>): Promise<string> {
  const config: CloneConfig = { ...DEFAULT_CONFIG, ...userConfig };

  if (!config.url) {
    throw new Error('URL requise');
  }

  // Ensure URL has protocol
  if (!config.url.startsWith('http')) {
    config.url = 'https://' + config.url;
  }

  // Kill any existing clone server before starting
  killExistingServer();

  const startTime = Date.now();

  logger.banner();
  logger.info(`Cible: ${config.url}`);
  logger.info(`Max pages: ${config.maxPages}`);
  logger.info(`Viewport: ${config.viewports[0].width}x${config.viewports[0].height}`);
  console.log('');

  // Step 1: Crawl
  const crawler = new Crawler(config);
  const crawlResult = await crawler.crawl();
  console.log('');

  // Step 2: Extract
  const extractor = new Extractor(
    config,
    crawler.getCollectedAssets(),
    crawler.getCollectedFonts()
  );
  const extractedData = await extractor.extract(crawlResult);
  console.log('');

  // Step 2.5: Gap-fill CSS images (textures, backgrounds referenced in stylesheets)
  const cssImagePattern = /url\(['"]?(https?:\/\/[^'")\s]+\.(?:png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^'")\s]*)?)['"]?\)/gi;
  const cssImageUrls = new Set<string>();
  let cssMatch;
  while ((cssMatch = cssImagePattern.exec(extractedData.globalStyles)) !== null) {
    cssImageUrls.add(cssMatch[1]);
  }
  const missingCssImages: string[] = [];
  for (const url of cssImageUrls) {
    if (!extractedData.assets.find((a) => a.url === url)) {
      missingCssImages.push(url);
    }
  }
  if (missingCssImages.length > 0) {
    logger.info(`${missingCssImages.length} images CSS manquantes, téléchargement...`);
    for (const url of missingCssImages) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || '';
          extractedData.assets.push({
            url,
            localPath: `assets/images/${getAssetFilename(url)}`,
            type: contentType.includes('svg') ? 'svg' : 'image',
            mimeType: contentType,
            content: buffer,
          });
        }
      } catch {}
    }
  }

  // Step 3: Reconstruct
  const reconstructor = new Reconstructor(config);
  const reconstructedSite = await reconstructor.reconstruct(extractedData);
  console.log('');

  // Step 4: Export
  const exporter = new Exporter(config);
  const outputDir = await exporter.export(reconstructedSite);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  logger.success(`Clonage complet en ${elapsed}s`);

  // Step 5: Start the dedicated server (pass original URL for proxy support)
  startServer(outputDir, config.url);

  return outputDir;
}
