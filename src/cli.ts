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

// === ATLAS commands (S3 — RAG vectoriel) ===
const atlasCmd = program
  .command('atlas')
  .description('Vector RAG index over grounded sections (§4.3)');

atlasCmd
  .command('index <kbSectionDir>')
  .description('Indexer un dossier .clonage-kb/sections/<site>/ dans l\'atlas')
  .requiredOption('-s, --site <name>', 'Identifiant du site (ex: mersi)')
  .option('--atlas-path <path>', 'Chemin du fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .option('--no-replace', 'Append au lieu de remplacer les rows du site')
  .action(async (kbSectionDir: string, options: any) => {
    try {
      const { indexSite, JsonlAtlasStore, loadDefaultEmbedder } = await import('./atlas/index.js');
      const io = new JsonlAtlasStore(path.resolve(options.atlasPath));
      const { indexed, skipped } = await indexSite({
        kbSectionDir: path.resolve(kbSectionDir),
        site: options.site,
        io,
        embedder: loadDefaultEmbedder(),
        replaceForSite: options.replace !== false,
      });
      logger.success(`Atlas indexé: ${indexed} section(s) (${skipped} skipped)`);
      logger.info(`Path: ${io.path}`);
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

atlasCmd
  .command('search <query...>')
  .description('Recherche sémantique dans l\'atlas')
  .option('-r, --role <role>', 'Filtre par rôle')
  .option('-m, --mood <mood>', 'Filtre par mood (séparés par virgule)')
  .option('-k, --top <n>', 'Top-K résultats', '5')
  .option('--atlas-path <path>', 'Chemin du fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .action(async (queryParts: string[], options: any) => {
    try {
      const { query: atlasQuery, JsonlAtlasStore, loadDefaultEmbedder } = await import('./atlas/index.js');
      const io = new JsonlAtlasStore(path.resolve(options.atlasPath));
      const brief = queryParts.join(' ');
      const hits = await atlasQuery(
        {
          brief,
          roleFilter: options.role,
          moodFilter: options.mood ? options.mood.split(',').map((m: string) => m.trim()) : undefined,
          topK: parseInt(options.top, 10),
        },
        { io, embedder: loadDefaultEmbedder() },
      );
      if (hits.length === 0) {
        logger.warn('Aucun résultat.');
        process.exit(0);
      }
      logger.success(`${hits.length} hit(s) pour "${brief}"`);
      for (const h of hits) {
        console.log(
          `  ${h.score.toFixed(3)}  ${h.entry.id}  [${h.entry.fiche.mood.join(',')}]  ${h.entry.fiche.signature.substring(0, 80)}`,
        );
      }
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

atlasCmd
  .command('stats')
  .description('Stats de l\'atlas (nombre de rows, sites indexés, embedder)')
  .option('--atlas-path <path>', 'Chemin du fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .action(async (options: any) => {
    try {
      const { stats, JsonlAtlasStore } = await import('./atlas/index.js');
      const io = new JsonlAtlasStore(path.resolve(options.atlasPath));
      const s = stats(io);
      logger.info(`Path:      ${s.path}`);
      logger.info(`Entries:   ${s.totalEntries}`);
      logger.info(`Sites:     ${s.sites.join(', ') || '(none)'}`);
      logger.info(`Embedder:  ${s.embedderIds.join(', ') || '(none)'}`);
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === PLAN command (S4 — Planning agent with Approval Mode) ===
//
// CRITICAL: this command runs ONLY Planning. It does NOT chain to Generation.
// The plan is printed + written to disk so the user can edit _plan.json
// before running `clonage generate <plan.json>` (S5).
program
  .command('plan')
  .description('Compose un plan de site à partir d\'un brief et de l\'atlas (§4.4 approval mode)')
  .requiredOption('-b, --brief <path>', 'Chemin vers le brief JSON')
  .option('-o, --output <path>', 'Chemin de sortie _plan.json', 'generated/<brand>/_plan.json')
  .option('--atlas-path <path>', 'Fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .option('--top <n>', 'Top-K candidats par rôle', '5')
  .option('--roles <list>', 'Rôles séparés par virgules (default: canoniques)', '')
  .action(async (options: any) => {
    try {
      const briefPath = path.resolve(options.brief);
      if (!fs.existsSync(briefPath)) {
        logger.error(`Brief non trouvé: ${briefPath}`);
        process.exit(1);
      }
      const brief = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));
      const brandName =
        (brief.brandName as string) ||
        (brief.name as string) ||
        (brief.brand && (brief.brand as any).name) ||
        'brand';
      const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      const outPath =
        options.output === 'generated/<brand>/_plan.json'
          ? path.resolve('generated', brandSlug, '_plan.json')
          : path.resolve(options.output);

      const { plan, writePlan, renderPlanTable } = await import('./agents/planning/index.js');
      const { JsonlAtlasStore, loadDefaultEmbedder } = await import('./atlas/index.js');
      const { loadDefaultTextLLM } = await import('./agents/planning/llm.js');

      const io = new JsonlAtlasStore(path.resolve(options.atlasPath));
      const embedder = loadDefaultEmbedder();
      const llm = loadDefaultTextLLM();

      const result = await plan({
        brief,
        io,
        embedder,
        llm,
        topKPerRole: parseInt(options.top, 10),
        roles: options.roles ? options.roles.split(',').map((s: string) => s.trim()) : undefined,
      });

      writePlan(result.plan, outPath);

      console.log('');
      console.log(renderPlanTable(result.plan, result.candidates));
      console.log('');
      logger.success(`Plan written: ${outPath}`);
      logger.info('Edit the plan if needed, then run: clonage generate <plan.json>');
      logger.warn('(plan approval mode — Generation is NOT launched automatically)');
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === GENERATE command (S5 — Generation compiler) ===
program
  .command('generate <planPath>')
  .description('Compile un plan validé en site final (§4.5 zero-LLM-on-HTML)')
  .requiredOption('-b, --brief <path>', 'Brief JSON (même que celui utilisé pour plan)')
  .option('-o, --output <dir>', 'Dossier de sortie', 'generated/<brand>')
  .option('--atlas-path <path>', 'Fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .option('--no-rewrite-text', 'Skip text-diff LLM pass (mode deterministe pur)')
  .option('--sector <text>', 'Contexte métier injecté dans les prompts text-diff')
  .action(async (planPath: string, options: any) => {
    try {
      const briefPath = path.resolve(options.brief);
      const brief = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));
      const brandName =
        (brief.brandName as string) ||
        (brief.name as string) ||
        (brief.brand && (brief.brand as any).name) ||
        'brand';
      const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      const outputDir =
        options.output === 'generated/<brand>'
          ? path.resolve('generated', brandSlug)
          : path.resolve(options.output);

      const { generate } = await import('./agents/generation/index.js');
      const { JsonlAtlasStore } = await import('./atlas/index.js');
      const io = new JsonlAtlasStore(path.resolve(options.atlasPath));

      const res = await generate({
        planPath: path.resolve(planPath),
        brief,
        outputDir,
        io,
        rewriteText: options.rewriteText !== false,
        sector: options.sector,
      });

      logger.success(`Site généré: ${res.outputHtml}`);
      logger.info(`Sections : ${res.fingerprints.length}`);
      for (const fp of res.fingerprints) {
        logger.dim(`  ${fp.role.padEnd(12)} — nodes=${fp.nodes}  scripts=${fp.scripts}  keyframes=${fp.keyframes}  (site=${fp.site})`);
      }
      logger.info(`Report  : ${path.join(res.outputDir, '_generation.json')}`);
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === BRIEF-GEN command (LLM drafts a rebrand brief from a clone) ===
program
  .command('brief-gen <cloneDir>')
  .description('LLM drafts a rebrand-har brief from a recorded clone + target description')
  .requiredOption('--for <description>', 'Short description of the target brand ("architecture studio moody minimal à Marseille")')
  .option('-o, --output <path>', 'Where to write the brief JSON', 'briefs/auto.json')
  .option('--screenshot <path>', 'Override the screenshot sent to the VLM')
  .action(async (cloneDir: string, options: any) => {
    try {
      const { generateBrief, writeBrief } = await import('./brief-gen/index.js');
      const src = path.resolve(cloneDir);
      if (!fs.existsSync(src)) {
        logger.error(`Clone dir not found: ${src}`);
        process.exit(1);
      }
      const result = await generateBrief({
        cloneDir: src,
        targetDescription: options.for,
        screenshotPath: options.screenshot ? path.resolve(options.screenshot) : undefined,
      });
      const out = path.resolve(options.output);
      writeBrief(result.brief, out);
      logger.success(`Brief written: ${out}`);
      logger.info(`  brand.source_name: ${result.brief.brand?.source_name ?? '(none)'}`);
      logger.info(`  brand.name:        ${result.brief.brand?.name ?? '(none)'}`);
      logger.info(`  copy entries:      ${result.brief.copy.length}`);
      logger.info(`Next: clonage rebrand-har ${src} -b ${out} --replay`);
      process.exit(0);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === REBRAND-HAR command (HAR-based rebrand for SPA sites) ===
//
// Rewrites every text response inside a HAR (HTML + JS + CSS + SVG) with a
// brand/copy brief, keeping binary assets (images, fonts, videos) untouched.
// Output = a twin clone dir the user can open with `clonage replay`.
//
// Complements the static `rebrand` command which targets SSR-friendly HTML.
program
  .command('rebrand-har <cloneDir>')
  .description('Rebrand a recorded clone (HAR) by rewriting strings in every text response')
  .requiredOption('-b, --brief <path>', 'Path to the brief JSON (brand + copy)')
  .option('-o, --output <dir>', 'Output clone dir (default: <cloneDir>-rebranded)')
  .option('--replay', 'Launch `clonage replay` on the output after rebrand')
  .action(async (cloneDir: string, options: any) => {
    try {
      const { rebrandClone } = await import('./rebrand-har/index.js');
      const src = path.resolve(cloneDir);
      if (!fs.existsSync(src)) {
        logger.error(`Clone dir not found: ${src}`);
        process.exit(1);
      }
      const out = options.output
        ? path.resolve(options.output)
        : src + '-rebranded';
      const result = rebrandClone({
        cloneDir: src,
        outputCloneDir: out,
        brief: path.resolve(options.brief),
      });
      logger.success(
        `Rebrand HAR: ${result.entriesModified} entries, ${result.totalHits} total hits`,
      );
      for (const e of result.perEntry.slice(0, 10)) {
        logger.dim(`  ${e.hits}× ${e.mime.padEnd(24)} ${e.url.substring(0, 60)}`);
      }
      logger.info(`Output: ${out}`);
      if (options.replay) {
        const { Replay } = await import('./replay/index.js');
        const replay = new Replay({ recordingDir: out, notFound: 'fallback' });
        await replay.start();
      } else {
        logger.info(`Next: clonage replay ${out}`);
        process.exit(0);
      }
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });

// === COMPOSE command (S6 — full pipeline with validator + retry) ===
program
  .command('compose')
  .description('Full pipeline: plan → generate → validate (retry cap 3)')
  .requiredOption('-b, --brief <path>', 'Brief JSON')
  .option('-o, --output <dir>', 'Dossier de sortie', 'generated/<brand>')
  .option('--atlas-path <path>', 'Fichier atlas JSONL', '.clonage-kb/atlas.jsonl')
  .option('--max-retries <n>', 'Retry cap (§4.6)', '3')
  .option('--plan-only', 'Run Planning only, skip Generation + Validation')
  .action(async (options: any) => {
    try {
      const briefPath = path.resolve(options.brief);
      const brief = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));
      const brandName =
        (brief.brandName as string) ||
        (brief.name as string) ||
        (brief.brand && (brief.brand as any).name) ||
        'brand';
      const brandSlug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const outputDir =
        options.output === 'generated/<brand>'
          ? path.resolve('generated', brandSlug)
          : path.resolve(options.output);

      const { compose } = await import('./pipeline-compose.js');
      const result = await compose({
        brief,
        outputDir,
        atlasPath: path.resolve(options.atlasPath),
        maxRetries: parseInt(options.maxRetries, 10),
        planOnly: !!options.planOnly,
      });

      if (result.failureReportPath) {
        logger.error(`Failure report: ${result.failureReportPath}`);
        process.exit(1);
      }
      if (result.outputHtml) logger.success(`Output: ${result.outputHtml}`);
      process.exit(result.passed ? 0 : 1);
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
