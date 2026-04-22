import * as fs from 'fs';
import * as path from 'path';
import { ReconstructedSite, CloneConfig, AssetData, FontData } from '../types.js';
import { logger } from '../utils/logger.js';
import { getDomain } from '../utils/url.js';

export class Exporter {
  private config: CloneConfig;

  constructor(config: CloneConfig) {
    this.config = config;
  }

  async export(site: ReconstructedSite): Promise<string> {
    logger.step(4, 4, 'Export du projet...');

    const domain = getDomain(this.config.url);
    const timestamp = new Date().toISOString().split('T')[0];
    const projectName = `${domain}_${timestamp}`;
    const outputDir = path.resolve(this.config.outputDir, projectName);

    // Create directory structure
    this.createDirectories(outputDir);

    // Write global CSS
    const cssPath = path.join(outputDir, 'styles.css');
    fs.writeFileSync(cssPath, site.globalCss, 'utf-8');
    logger.info(`CSS global: styles.css`);

    // Write HTML pages
    for (const page of site.pages) {
      const pagePath = path.join(outputDir, page.filename);
      fs.writeFileSync(pagePath, page.html, 'utf-8');
      logger.info(`Page: ${page.filename}`);
    }

    // Write assets (images)
    let imageCount = 0;
    let fontCount = 0;
    let videoCount = 0;

    for (const asset of site.assets) {
      if (asset.content) {
        // Always sanitize the path when writing to ensure consistency
        const sanitizedLocalPath = asset.localPath.split('/').map((part, i) => {
          if (i === asset.localPath.split('/').length - 1) {
            return this.sanitizeFilename(part);
          }
          return part;
        }).join('/');
        const assetPath = path.join(outputDir, sanitizedLocalPath);
        const dir = path.dirname(assetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        // Deduplicate by checking if file already exists
        if (!fs.existsSync(assetPath)) {
          let content = asset.content;

          // For JSON data files, rewrite any CDN URLs to local paths
          if (asset.mimeType.includes('json')) {
            let jsonText = content.toString('utf-8');
            // Rewrite image URLs in JSON to local paths
            jsonText = jsonText.replace(
              /https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|avif|gif|svg)/gi,
              (imgUrl) => {
                const fname = this.sanitizeFilename(imgUrl.split('/').pop() || 'asset');
                return `./assets/images/${fname}`;
              }
            );
            content = Buffer.from(jsonText, 'utf-8');
          }

          fs.writeFileSync(assetPath, content);
          if (asset.type === 'image' || asset.type === 'svg') imageCount++;
          else if (asset.type === 'video') videoCount++;
        }
      }
    }

    // Write fonts
    for (const font of site.fonts) {
      if (font.content && font.url) {
        const filename = this.getFontFilename(font.url);
        const fontPath = path.join(outputDir, 'assets', 'fonts', filename);
        const dir = path.dirname(fontPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        if (!fs.existsSync(fontPath)) {
          fs.writeFileSync(fontPath, font.content);
          fontCount++;
        }
      }
    }

    // Write screenshots
    const screenshotsDir = path.join(outputDir, '_screenshots');
    fs.mkdirSync(screenshotsDir, { recursive: true });

    // Write site metadata / report
    const report = this.generateReport(site, outputDir, {
      imageCount,
      fontCount,
      videoCount,
    });
    fs.writeFileSync(path.join(outputDir, '_report.md'), report, 'utf-8');

    // Write a simple local server script
    this.writeServerScript(outputDir);

    logger.success(`
Export terminé !
  Dossier: ${outputDir}
  Pages:   ${site.pages.length}
  Images:  ${imageCount}
  Fonts:   ${fontCount}
  Videos:  ${videoCount}
`);

    return outputDir;
  }

  private createDirectories(outputDir: string): void {
    const dirs = [
      outputDir,
      path.join(outputDir, 'assets'),
      path.join(outputDir, 'assets', 'images'),
      path.join(outputDir, 'assets', 'fonts'),
      path.join(outputDir, 'assets', 'videos'),
      path.join(outputDir, 'assets', 'data'),
      path.join(outputDir, '_screenshots'),
    ];

    for (const dir of dirs) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private generateReport(
    site: ReconstructedSite,
    outputDir: string,
    counts: { imageCount: number; fontCount: number; videoCount: number }
  ): string {
    const meta = site.siteMetadata;

    return `# Clone Report: ${meta.domain}

**Date:** ${new Date().toISOString()}
**URL:** ${meta.baseUrl}
**Outil:** Clonage v1.0.0

## Résumé

| Métrique | Valeur |
|----------|--------|
| Pages clonées | ${site.pages.length} |
| Images | ${counts.imageCount} |
| Fonts | ${counts.fontCount} |
| Vidéos | ${counts.videoCount} |

## Stack technique détectée

${meta.techStack.length > 0 ? meta.techStack.map((t) => `- ${t}`).join('\n') : '- Non détectée'}

## Pages

${site.pages.map((p) => `- [${p.title || p.path}](${p.filename})`).join('\n')}

## Structure du projet

\`\`\`
${meta.domain}/
├── index.html          # Page d'accueil
├── styles.css          # CSS global (toutes les feuilles de style)
├── assets/
│   ├── images/         # Images, SVGs, icônes
│   ├── fonts/          # Polices (woff2, woff, ttf)
│   └── videos/         # Vidéos
├── _screenshots/       # Captures d'écran de référence
├── _report.md          # Ce fichier
└── serve.sh            # Script pour lancer un serveur local
\`\`\`

## Comment utiliser ce clone

1. Ouvrir un terminal dans ce dossier
2. Lancer \`bash serve.sh\` (ou \`npx serve .\` ou \`python3 -m http.server 3000\`)
3. Ouvrir http://localhost:3000 dans un navigateur

## Notes d'apprentissage

- Examiner \`styles.css\` pour comprendre l'approche CSS (layout, grid, animations)
- Les fonts dans \`assets/fonts/\` montrent les choix typographiques
- Comparer les screenshots originaux avec le rendu local pour identifier les différences
- Les animations CSS sont préservées dans le CSS global
`;
  }

  private writeServerScript(outputDir: string): void {
    const script = `#!/bin/bash
# Simple server script for viewing the cloned site

if command -v npx &> /dev/null; then
  echo "Starting server with 'serve'..."
  npx -y serve . -p 3000
elif command -v python3 &> /dev/null; then
  echo "Starting server with Python..."
  python3 -m http.server 3000
elif command -v php &> /dev/null; then
  echo "Starting server with PHP..."
  php -S localhost:3000
else
  echo "No server found. Please install Node.js, Python 3, or PHP."
  echo "Or simply open index.html in your browser."
fi
`;
    fs.writeFileSync(path.join(outputDir, 'serve.sh'), script, { mode: 0o755 });
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
}
