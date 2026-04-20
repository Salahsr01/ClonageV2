#!/usr/bin/env node

import { Command } from 'commander';
import { cloneSite } from './pipeline.js';
import { Recorder } from './recorder/index.js';
import { Replay } from './replay/index.js';
import { Analyzer } from './analyzer/index.js';
import { KnowledgeBase } from './knowledge/index.js';
import { Generator } from './generator/index.js';
import { logger } from './utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('clonage')
  .description('Clone vivant + analyse + generation de sites Awwwards')
  .version('3.0.0');

// === CLONE command ===
program
  .command('clone <url>')
  .description('Cloner un site web')
  .option('-o, --output <dir>', 'Dossier de sortie', './output')
  .option('-m, --max-pages <n>', 'Nombre maximum de pages', '50')
  .option('-w, --width <n>', 'Largeur du viewport', '1920')
  .option('-t, --timeout <ms>', 'Timeout par page (ms)', '30000')
  .option('--analyze', 'Analyser et indexer automatiquement après le clonage')
  .action(async (url: string, options: any) => {
    try {
      const outputDir = await cloneSite({
        url,
        outputDir: options.output,
        maxPages: parseInt(options.maxPages, 10),
        viewports: [{ name: 'desktop', width: parseInt(options.width, 10), height: 1080 }],
        timeout: parseInt(options.timeout, 10),
      });

      // Auto-analyze if requested
      if (options.analyze) {
        console.log('');
        const analyzer = new Analyzer(outputDir);
        const analysis = await analyzer.analyze();
        const kb = new KnowledgeBase();
        kb.ingest(analysis);

        // Save analysis
        const analysisPath = path.join(outputDir, '_analysis.json');
        fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
        logger.success(`Analyse sauvegardée: ${analysisPath}`);
      }
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === RECORD command (v3.0 Clone Vivant) ===
program
  .command('record <url>')
  .description('Enregistrer un site en HAR (Clone Vivant — JS préservé)')
  .option('-o, --output <dir>', 'Dossier de sortie', './output')
  .option('-t, --timeout <ms>', 'Timeout (ms)', '60000')
  .option('--no-headless', 'Navigateur visible (pour bypass anti-bot)')
  .action(async (url: string, options: any) => {
    try {
      const recorder = new Recorder({
        url,
        outputDir: options.output,
        viewport: { name: 'desktop', width: 1920, height: 1080 },
        timeout: parseInt(options.timeout, 10),
        maxPages: 1,
        headless: options.headless !== false,
      });

      await recorder.record();
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === REPLAY command (v3.0 Clone Vivant) ===
program
  .command('replay <directory>')
  .description('Rejouer un enregistrement HAR (navigateur Chromium avec JS vivant)')
  .option('--offline', 'Mode offline strict (pas de fallback réseau)')
  .action(async (directory: string, options: any) => {
    try {
      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        logger.error(`Dossier non trouvé: ${dir}`);
        process.exit(1);
      }

      const replay = new Replay({
        recordingDir: dir,
        notFound: options.offline ? 'abort' : 'fallback',
      });

      await replay.start();
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === EXTRACT command (v3.0 Deep Extraction) ===
program
  .command('extract <directory>')
  .description('Extraction profonde des tokens, animations et composants depuis un enregistrement')
  .option('--tokens', 'Extraire les design tokens')
  .option('--animations', 'Extraire les animations')
  .option('--components', 'Extraire les composants')
  .option('--screenshots <n>', 'Nombre de screenshots scroll', '10')
  .option('--all', 'Tout extraire (défaut)')
  .action(async (directory: string, options: any) => {
    try {
      const { DeepExtractor } = await import('./extractor/deep-extractor.js');

      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        logger.error(`Dossier non trouvé: ${dir}`);
        process.exit(1);
      }

      const extractAll = options.all || (!options.tokens && !options.animations && !options.components);

      const extractor = new DeepExtractor({
        recordingDir: dir,
        tokens: extractAll || !!options.tokens,
        animations: extractAll || !!options.animations,
        components: extractAll || !!options.components,
        screenshotCount: parseInt(options.screenshots, 10),
      });

      await extractor.extract();
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// NOTE: The old `regenerate` command (Regenerator 6-pass from-scratch IA)
// was removed in v3.1. It produced generic, Awwwards-unworthy output
// (validation score 52/100) and conflicts with the feedback documented in
// memory/feedback_generation.md. For same-site-new-content use `template`
// or `reskin` instead; for new-site generation the approach is
// clone-as-template, not from-scratch LLM output.

// === REPRODUCE command (v3.1 — deterministic, computed-styles, no AI) ===
// Replaces the old AI-chunked Regenerator.reproduce() which scored 52/100
// and lost ~85% of the DOM info. See src/reproducer/index.ts for rationale.
program
  .command('reproduce <directory>')
  .description('Reproduire fidèlement un site à partir de son enregistrement (computed styles, déterministe)')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated')
  .action(async (directory: string, options: any) => {
    try {
      const { Reproducer } = await import('./reproducer/index.js');

      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        logger.error(`Dossier non trouvé: ${dir}`);
        process.exit(1);
      }

      // Read metadata for domain name
      const metadataPath = path.join(dir, 'metadata.json');
      const metadata = fs.existsSync(metadataPath)
        ? JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
        : { domain: 'site' };

      const outDir = path.join(path.resolve(options.output), `reproduce-${metadata.domain}`);

      const reproducer = new Reproducer({
        recordingDir: dir,
        outputDir: outDir,
        simplifyClasses: true,
        inlineStyles: true,
      });

      const outputPath = await reproducer.reproduce();

      // Open in browser
      const { startServer } = await import('./server.js');
      startServer(path.dirname(outputPath));
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === ANALYZE command ===
program
  .command('analyze <directory>')
  .description('Analyser un site cloné et l\'indexer dans la knowledge base')
  .action(async (directory: string) => {
    try {
      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        logger.error(`Dossier non trouvé: ${dir}`);
        process.exit(1);
      }

      const analyzer = new Analyzer(dir);
      const analysis = await analyzer.analyze();

      // Index in knowledge base
      const kb = new KnowledgeBase();
      kb.ingest(analysis);

      // Save analysis
      const analysisPath = path.join(dir, '_analysis.json');
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
      logger.success(`Analyse sauvegardée: ${analysisPath}`);

      // Show stats
      const stats = kb.getStats();
      console.log('');
      logger.info(`Knowledge Base: ${stats.sites} sites, ${stats.sections} sections, ${stats.animations} animations, ${stats.components} composants`);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === SEARCH command ===
program
  .command('search <query>')
  .description('Rechercher des patterns dans la knowledge base')
  .option('-t, --type <type>', 'Type (section, animation, component, tokens)')
  .option('-n, --limit <n>', 'Nombre de résultats', '10')
  .action((query: string, options: any) => {
    const kb = new KnowledgeBase();
    const results = kb.search(query, options.type, parseInt(options.limit, 10));

    if (results.length === 0) {
      logger.warn('Aucun résultat trouvé.');
      return;
    }

    logger.success(`${results.length} résultats pour "${query}":`);
    for (const r of results) {
      console.log(`  [${r.type}] ${r.domain} → ${r.tags.join(', ')}`);
      if (r.type === 'section') {
        console.log(`    ${(r.content as any).textContent?.substring(0, 100) || ''}`);
      }
    }
  });

// === GENERATE command ===
program
  .command('generate')
  .description('Générer un site web à partir d\'un brief')
  .requiredOption('-b, --brief <text>', 'Description du site à générer')
  .option('-s, --style <style>', 'Style visuel (dark-luxury, light-minimal, bold-creative)')
  .option('--sections <list>', 'Sections séparées par des virgules', 'hero,features,portfolio,testimonials,contact,footer')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated')
  .action(async (options: any) => {
    try {
      const generator = new Generator(options.output);
      const brief = {
        description: options.brief,
        style: options.style,
        sections: options.sections.split(',').map((s: string) => s.trim()),
        animations: true,
      };

      await generator.generate(brief);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === KB STATS command ===
program
  .command('kb')
  .description('Afficher les stats de la knowledge base')
  .action(() => {
    const kb = new KnowledgeBase();
    const stats = kb.getStats();
    const sites = kb.getSiteSummaries();

    logger.banner();
    logger.info('Knowledge Base Stats:');
    console.log(`  Sites indexés:  ${stats.sites}`);
    console.log(`  Sections:       ${stats.sections}`);
    console.log(`  Animations:     ${stats.animations}`);
    console.log(`  Composants:     ${stats.components}`);
    console.log('');

    if (sites.length > 0) {
      logger.info('Sites indexés:');
      for (const s of sites) {
        console.log(`  ${s.domain} — ${s.summary.vibe} | ${s.summary.primaryFont} | ${s.summary.techStack.join(', ')}`);
      }
    }
  });

// === COMPOSE command ===
program
  .command('compose')
  .description('Composer un site à partir de vraies sections de sites clonés')
  .requiredOption('-t, --title <text>', 'Nom du site')
  .option('-d, --description <text>', 'Description', '')
  .option('-s, --sections <list>', 'Sections (type:domain,...)', 'hero,portfolio,about,contact,footer')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated')
  .action(async (options: any) => {
    try {
      const { Composer } = await import('./generator/composer.js');
      const { startServer } = await import('./server.js');

      const composer = new Composer();
      composer.loadFromOutput('./output');

      // Show available sections
      const available = composer.listAvailable();
      logger.info('Sections disponibles:');
      for (const a of available) {
        console.log(`  ${a.type} (${a.count}) — ${a.domains.join(', ')}`);
      }
      console.log('');

      // Parse section picks
      const sectionPicks = options.sections.split(',').map((s: string) => {
        const parts = s.trim().split(':');
        return { type: parts[0], from: parts[1] };
      });

      const brief = {
        title: options.title,
        description: options.description,
        sections: sectionPicks,
      };

      const html = composer.compose(brief);

      // Save
      const fs = await import('fs');
      const path = await import('path');
      const slug = options.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const outDir = path.join(options.output, `composed-${slug}`);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');

      // Copy assets from all used clone dirs
      const outputBase = path.resolve('./output');
      const cloneDirs = fs.readdirSync(outputBase)
        .filter((d: string) => fs.statSync(path.join(outputBase, d)).isDirectory())
        .filter((d: string) => fs.existsSync(path.join(outputBase, d, 'index.html')));

      for (const dir of cloneDirs) {
        const assetsDir = path.join(outputBase, dir, 'assets');
        if (fs.existsSync(assetsDir)) {
          // Symlink assets for quick access
          const targetLink = path.join(outDir, `assets-${dir.split('_')[0]}`);
          if (!fs.existsSync(targetLink)) {
            fs.symlinkSync(assetsDir, targetLink, 'dir');
          }
        }
      }

      // Also create a merged styles.css
      const cssFiles = cloneDirs
        .map((d: string) => path.join(outputBase, d, 'styles.css'))
        .filter((f: string) => fs.existsSync(f));
      const mergedCss = cssFiles.map((f: string) => fs.readFileSync(f, 'utf-8')).join('\n\n');
      fs.writeFileSync(path.join(outDir, 'styles.css'), mergedCss, 'utf-8');

      logger.success(`Site composé: ${outDir}/index.html`);

      // Launch server
      startServer(outDir);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === RESKIN command ===
program
  .command('reskin <source>')
  .description('Reskin un site cloné : même structure/animations, nouveau contenu/couleurs')
  .requiredOption('-n, --name <text>', 'Nouveau nom de marque')
  .option('-r, --replacements <json>', 'Remplacements texte en JSON ({"ancien":"nouveau",...})')
  .option('-c, --colors <json>', 'Overrides couleurs en JSON ({"#ancien":"#nouveau",...})')
  .option('-f, --fonts <json>', 'Overrides fonts en JSON ({"AncienneFont":"NouvelleFont",...})')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated')
  .action(async (source: string, options: any) => {
    try {
      const { Reskin } = await import('./generator/reskin.js');
      const { startServer } = await import('./server.js');

      const sourcePath = path.resolve(source);
      if (!fs.existsSync(sourcePath)) {
        logger.error(`Clone non trouvé: ${sourcePath}`);
        process.exit(1);
      }

      const slug = options.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const outDir = path.join(path.resolve(options.output), `reskin-${slug}`);

      // Parse JSON options
      let replacements: Record<string, string> = {};
      let colors: Record<string, string> | undefined;
      let fonts: Record<string, string> | undefined;

      if (options.replacements) {
        try { replacements = JSON.parse(options.replacements); } catch { logger.warn('JSON replacements invalide'); }
      }

      if (options.colors) {
        try { colors = JSON.parse(options.colors); } catch { logger.warn('JSON colors invalide'); }
      }

      if (options.fonts) {
        try { fonts = JSON.parse(options.fonts); } catch { logger.warn('JSON fonts invalide'); }
      }

      const reskin = new Reskin({
        sourceClone: sourcePath,
        outputDir: outDir,
        brandName: options.name,
        textReplacements: replacements,
        colorOverrides: colors,
        fontOverrides: fonts,
      });

      const resultDir = await reskin.execute();
      startServer(resultDir);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === TEMPLATE command (v3.1 — clone-as-template + auto text rewrite via LLM) ===
program
  .command('template <cloneDir>')
  .description('Cloner un site comme template, puis reecrire le texte via IA (structure/CSS/JS intacts)')
  .requiredOption('-n, --name <text>', 'Nom de la marque')
  .requiredOption('-i, --industry <text>', 'Secteur (ex: agence de design)')
  .option('-t, --tagline <text>', 'Tagline', '')
  .option('-d, --description <text>', 'Description longue', '')
  .option('-s, --services <list>', 'Services separes par des virgules', '')
  .option('-e, --email <email>', 'Email de contact', 'contact@example.com')
  .option('--projects <json>', 'Projets en JSON [{name,category,description},...]', '[]')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated')
  .action(async (cloneDir: string, options: any) => {
    try {
      const { TemplateEngine } = await import('./generator/template.js');
      const { startServer } = await import('./server.js');

      const sourcePath = path.resolve(cloneDir);
      if (!fs.existsSync(sourcePath)) {
        logger.error(`Clone non trouvé: ${sourcePath}`);
        process.exit(1);
      }

      let projects: Array<{ name: string; category: string; description: string }> = [];
      try { projects = JSON.parse(options.projects); } catch { logger.warn('JSON projects invalide, liste vide.'); }

      const brief = {
        brandName: options.name,
        industry: options.industry,
        tagline: options.tagline,
        description: options.description,
        services: options.services ? options.services.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
        projects,
        contact: { email: options.email },
        style: 'keep',
      };

      const engine = new TemplateEngine();
      const projectDir = await engine.execute(sourcePath, brief, path.resolve(options.output));
      startServer(projectDir);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// Default: if first arg looks like a URL, treat it as clone command
const args = process.argv.slice(2);
if (args.length > 0 && (args[0].startsWith('http') || args[0].includes('.'))) {
  // Legacy mode: clonage <url>
  process.argv.splice(2, 0, 'clone');
}

// === REPRODUCE-EXACT command (deterministic, LLM-free) ===
program
  .command('reproduce-exact <clone-path>')
  .description('Reproduction fidele deterministe d\'une section clonee (zero LLM)')
  .option('-s, --section <sel>', 'CSS selector ou alias (hero|header|footer|nav)', 'hero')
  .option('-o, --output <dir>', 'Dossier de sortie', './generated/reproduce-exact')
  .option('-e, --entry <file>', 'Fichier HTML d\'entree dans le clone', 'index.html')
  .option('-w, --width <n>', 'Largeur du viewport', '1920')
  .option('--height <n>', 'Hauteur du viewport', '1080')
  .option('--threshold <n>', 'Seuil pixel-diff (0..1)', '0.02')
  .action(async (clonePath: string, options: any) => {
    try {
      const { reproduceExact } = await import('./reproducer-exact/index.js');
      const result = await reproduceExact({
        clonePath: path.resolve(clonePath),
        section: options.section,
        outputDir: path.resolve(options.output),
        entryFile: options.entry,
        viewport: { width: parseInt(options.width, 10), height: parseInt(options.height, 10) },
        diffThreshold: parseFloat(options.threshold),
      });
      logger.info(`Output: ${result.outputHtml}`);
      logger.info(`Metadata: ${result.metadataPath}`);
      logger.info(`Diff score: ${(result.diffScore * 100).toFixed(2)}%`);
      process.exit(result.passed ? 0 : 1);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

program.parse();
