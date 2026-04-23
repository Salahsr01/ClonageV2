#!/usr/bin/env node

import { Command } from 'commander';
import { cloneSite } from './pipeline.js';
import { Recorder } from './recorder/index.js';
import { Replay } from './replay/index.js';
import { Analyzer } from './analyzer/index.js';
// ARCHIVED in S1 (REFACTOR_BRIEF.md §3) — see _archive/ and git log for original code:
//   - src/knowledge/       → import { KnowledgeBase } from './knowledge/index.js';
//   - src/generator/       → import { Generator }     from './generator/index.js';
// TODO: rewire to agents/ in S4-S5 (Planning + Generation agents will replace these)
import { logger } from './utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('clonage')
  .description('Clone vivant + analyse + generation de sites Awwwards')
  .version('3.1.0-refactor');

// === CLONE command ===
program
  .command('clone <url>')
  .description('Cloner un site web')
  .option('-o, --output <dir>', 'Dossier de sortie', './output')
  .option('-m, --max-pages <n>', 'Nombre maximum de pages', '50')
  .option('-w, --width <n>', 'Largeur du viewport', '1920')
  .option('-t, --timeout <ms>', 'Timeout par page (ms)', '30000')
  // --analyze flag removed in S1 — needed KnowledgeBase (archived).
  // TODO: replace with --ground flag (feeds grounding agent) in S2-S3.
  .action(async (url: string, options: any) => {
    try {
      await cloneSite({
        url,
        outputDir: options.output,
        maxPages: parseInt(options.maxPages, 10),
        viewports: [{ name: 'desktop', width: parseInt(options.width, 10), height: 1080 }],
        timeout: parseInt(options.timeout, 10),
      });
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

// === EXTRACT command (deep-extractor — tokens/animations/components) ===
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

// === ANALYZE command (keeps section-extractor; KnowledgeBase indexing removed) ===
program
  .command('analyze <directory>')
  .description('Analyser un site cloné (section-extractor — KB indexing désactivé post-refactor)')
  .action(async (directory: string) => {
    try {
      const dir = path.resolve(directory);
      if (!fs.existsSync(dir)) {
        logger.error(`Dossier non trouvé: ${dir}`);
        process.exit(1);
      }

      const analyzer = new Analyzer(dir);
      const analysis = await analyzer.analyze();

      const analysisPath = path.join(dir, '_analysis.json');
      fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
      logger.success(`Analyse sauvegardée: ${analysisPath}`);
      logger.warn('KnowledgeBase indexing disabled — archived in S1. TODO: rewire to atlas/ in S3.');
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

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

// === REBRAND command (deterministic, LLM-free) ===
program
  .command('rebrand <html>')
  .description('Appliquer un brand brief JSON a un HTML reproduit (nom, couleurs, typo, copy, images)')
  .requiredOption('-b, --brief <path>', 'Chemin vers le brand brief JSON')
  .option('-o, --output <path>', 'Fichier HTML de sortie (default: {basename}.rebranded.html)')
  .action(async (htmlPath: string, options: any) => {
    try {
      const { loadBrief } = await import('./rebrand/brief.js');
      const { rebrand } = await import('./rebrand/index.js');
      const brief = loadBrief(path.resolve(options.brief));
      const result = await rebrand({
        inputHtml: path.resolve(htmlPath),
        brief,
        outputPath: options.output ? path.resolve(options.output) : undefined,
      });
      logger.info(`Output: ${result.outputHtml}`);
      logger.info(`Metadata: ${result.metadataPath}`);
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === DEEP-EXTRACT command (static, KB v2 foundation) ===
program
  .command('deep-extract <cloneDir>')
  .description('Extraire un clone en sections autonomes indexees dans .clonage-kb/')
  .option('-s, --sections <n>', 'Nombre cible de sections (soft)', '6')
  .option('-f, --force', 'Ecraser une entree KB existante')
  .action(async (cloneDir: string, options: any) => {
    try {
      const { deepExtract } = await import('./deep-extract/index.js');
      const result = await deepExtract({
        cloneDir: path.resolve(cloneDir),
        sectionsTarget: parseInt(options.sections, 10),
        force: !!options.force,
      });
      logger.success(`KB ecrite: ${result.kbDir}`);
      logger.info(`${result.index.sections.length} sections extraites`);
      for (const s of result.index.sections) {
        logger.dim(`  - ${s.role} (${(s.size_bytes / 1024).toFixed(1)} KB)`);
      }
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

/* =============================================================================
 * ARCHIVED COMMANDS — S1 of ScreenCoder refactor (REFACTOR_BRIEF.md §3)
 * =============================================================================
 *
 * The following commands were disabled because their backing modules were
 * moved to `_archive/` in Week 1. Their original code lives in git history
 * on this branch (`refactor/screencoder-v2`) and in `_archive/<module>/`.
 *
 * TODO: rewire to agents/ in S4-S5. The new flow will be:
 *
 *     clonage plan --brief <path>     → agents/planning       (S4)
 *     clonage generate <plan.json>    → agents/generation     (S5)
 *     clonage atlas index <cloneDir>  → atlas/store           (S3)
 *     clonage ground <cloneDir>       → agents/grounding      (S2)
 *     clonage compose --brief <path>  → full pipeline         (S6)
 *
 * Removed commands and their replacement target:
 *
 *   - search      → atlas.query()                              (S3)
 *   - generate    → clonage generate <plan.json>               (S5)
 *   - kb          → atlas stats                                (S3)
 *   - compose     → agents/generation compose                  (S5)
 *   - reskin      → agents/generation with --preserve-source   (S5)
 *   - template    → agents/generation with identity plan       (S5)
 *   - reproduce   → replaced by reproduce-exact (already live)
 *   - kb-compose  → agents/planning + agents/generation        (S4-S5)
 *   - rebrand-ai  → agents/generation text-diff                (S5)
 *
 * =============================================================================
 */

// Default: if first arg looks like a URL, treat it as clone command
const args = process.argv.slice(2);
if (args.length > 0 && (args[0].startsWith('http') || args[0].includes('.'))) {
  // Legacy mode: clonage <url>
  process.argv.splice(2, 0, 'clone');
}

program.parse();
