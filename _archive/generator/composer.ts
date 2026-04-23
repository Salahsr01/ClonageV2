import * as fs from 'fs';
import * as path from 'path';
import { SectionExtractor, ExtractedSection } from '../analyzer/section-extractor.js';
import { logger } from '../utils/logger.js';

export interface ComposeBrief {
  title: string;       // "NOIR STUDIO"
  description: string; // "Studio de design parisien"
  sections: SectionPick[];
}

export interface SectionPick {
  type: string;        // "hero", "portfolio", etc.
  from?: string;       // domain to pick from (e.g. "mersi-architecture.com"), or auto
}

interface LibraryEntry {
  section: ExtractedSection;
  css: string;
  scripts: string[];
}

export class Composer {
  private library: Map<string, LibraryEntry[]> = new Map(); // type -> entries
  private allCss: string[] = [];
  private allScripts: Set<string> = new Set();

  /**
   * Load all cloned sites into the section library
   */
  loadFromOutput(outputDir: string): void {
    const extractor = new SectionExtractor();
    const dirs = fs.readdirSync(outputDir)
      .filter(d => fs.statSync(path.join(outputDir, d)).isDirectory())
      .filter(d => !d.startsWith('.') && !d.startsWith('_'));

    for (const dir of dirs) {
      const fullPath = path.join(outputDir, dir);
      if (!fs.existsSync(path.join(fullPath, 'index.html'))) continue;

      try {
        const { sections, css, scripts } = extractor.extractFromClone(fullPath);
        this.allCss.push(`/* === ${dir} === */\n${css}`);
        scripts.forEach(s => this.allScripts.add(s));

        for (const section of sections) {
          const type = section.type;
          if (!this.library.has(type)) this.library.set(type, []);
          this.library.get(type)!.push({ section, css, scripts });
        }
      } catch (err: any) {
        logger.warn(`Erreur chargement ${dir}: ${err.message}`);
      }
    }

    const totalSections = Array.from(this.library.values()).reduce((sum, arr) => sum + arr.length, 0);
    logger.success(`Bibliothèque chargée: ${totalSections} sections de ${dirs.length} sites`);
    logger.info(`Types disponibles: ${Array.from(this.library.keys()).join(', ')}`);
  }

  /**
   * List available sections by type
   */
  listAvailable(): { type: string; count: number; domains: string[] }[] {
    return Array.from(this.library.entries()).map(([type, entries]) => ({
      type,
      count: entries.length,
      domains: [...new Set(entries.map(e => e.section.source.domain))],
    }));
  }

  /**
   * Pick the best section for a given type and optional domain preference
   */
  pickSection(type: string, fromDomain?: string): LibraryEntry | null {
    const entries = this.library.get(type);
    if (!entries || entries.length === 0) return null;

    if (fromDomain) {
      const match = entries.find(e => e.section.source.domain.includes(fromDomain));
      if (match) return match;
    }

    // Pick the one with the most features (animated > static, image > no image)
    return entries.sort((a, b) => {
      let scoreA = a.section.html.length; // longer = more detailed
      let scoreB = b.section.html.length;
      if (a.section.meta.hasAnimation) scoreA += 5000;
      if (b.section.meta.hasAnimation) scoreB += 5000;
      if (a.section.meta.hasImage) scoreA += 2000;
      if (b.section.meta.hasImage) scoreB += 2000;
      if (a.section.meta.hasVideo) scoreA += 3000;
      if (b.section.meta.hasVideo) scoreB += 3000;
      return scoreB - scoreA;
    })[0];
  }

  /**
   * Compose a new site from picked sections
   */
  compose(brief: ComposeBrief): string {
    logger.info(`Composition: "${brief.title}"`);

    const pickedSections: { type: string; html: string; source: string }[] = [];
    const usedCss = new Set<string>();

    for (const pick of brief.sections) {
      const entry = this.pickSection(pick.type, pick.from);
      if (entry) {
        pickedSections.push({
          type: pick.type,
          html: entry.section.html,
          source: entry.section.source.domain,
        });
        usedCss.add(entry.css);
        logger.info(`  ${pick.type} ← ${entry.section.source.domain} (${entry.section.meta.estimatedHeight}, ${entry.section.meta.hasAnimation ? 'animé' : 'statique'})`);
      } else {
        logger.warn(`  ${pick.type} ← pas trouvé dans la bibliothèque`);
      }
    }

    // Build the combined CSS (all site CSS combined -- class names are unique per site)
    const combinedCss = Array.from(usedCss).join('\n\n');

    // Collect all CDN scripts
    const scripts = Array.from(this.allScripts);

    // Build the final HTML
    const html = this.buildHtml(brief, pickedSections, combinedCss, scripts);

    logger.success(`Composé: ${pickedSections.length} sections de ${new Set(pickedSections.map(s => s.source)).size} sites différents`);

    return html;
  }

  private buildHtml(
    brief: ComposeBrief,
    sections: { type: string; html: string; source: string }[],
    css: string,
    scripts: string[]
  ): string {
    // Filter scripts: keep GSAP, Lenis, jQuery, Barba, etc. -- skip analytics
    const cleanScripts = scripts.filter(s =>
      /gsap|scrolltrigger|splittext|lenis|jquery|barba|swiper|locomotive/i.test(s)
    );

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brief.title}</title>
  <meta name="description" content="${brief.description}">
  <style>
    /* Combined CSS from Awwwards-level reference sites */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    ${css}
  </style>
  ${cleanScripts.map(s => `<script src="${s}"></script>`).join('\n  ')}
</head>
<body>
  <!-- Composed from ${new Set(sections.map(s => s.source)).size} award-winning sites -->
  ${sections.map(s => `\n  <!-- ${s.type} from ${s.source} -->\n  ${s.html}`).join('\n')}
</body>
</html>`;
  }
}
