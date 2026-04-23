import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';
import { logger } from '../utils/logger.js';
import { callLLM as callLLMShared } from '../utils/llm.js';
import { loadKB } from './kb-loader.js';
import { buildInventory } from './inventory.js';
import { applyPatches } from './reinject.js';
import { validateStructure, fingerprintsOf } from './validate.js';
import { rewriteCopyBlocks } from './rewrite-text.js';
import { selectSections, selectSectionsFallback } from './select.js';
import type { SelectCandidate, SelectedSection } from './select.js';
import { assembleHtml, extractHeadMaterial } from './assembler.js';
import type {
  ComposeOptions,
  ComposeResult,
  ComposeManifest,
  LLMCall,
  LoadedSection,
  LoadedKB,
  RewrittenSection,
  RewriteOutcome,
  ComposeBrief,
} from './types.js';

const defaultLLM: LLMCall = async ({ prompt, maxTokens, tag }) => {
  return callLLMShared({ prompt, maxTokens, silent: true, strict: true });
};

export async function compose(opts: ComposeOptions): Promise<ComposeResult> {
  const loaded = loadKB(opts.baseSite, opts.kbRoot);
  const llm = opts.llm || defaultLLM;
  const maxRetries = opts.maxRetries ?? 3;

  logger.info(
    `Composing for "${opts.brief.brandName}" from ${loaded.sections.length} available sections of ${loaded.index.site}...`,
  );

  const selections = await runSelect(loaded, opts, llm);
  logger.info(`  Selected ${selections.length} sections: ${selections.map((s) => s.role).join(', ')}`);

  const rewritten: RewrittenSection[] = [];
  for (let i = 0; i < selections.length; i += 1) {
    const sel = selections[i];
    const section = loaded.sections.find((s) => s.meta.role === sel.role);
    if (!section) {
      logger.warn(`  skip ${sel.role}: not found in KB`);
      continue;
    }
    logger.step(i + 1, selections.length, `Rewriting ${sel.role} (${section.html.length} bytes)...`);
    const result = await rewriteAndValidate(section, opts.brief, llm, opts.sector, maxRetries);
    logger.dim(
      `  → ${result.outcome} (attempts=${result.attempts}, ${result.originalSize}→${result.rewrittenSize} bytes${
        result.validation && !result.validation.ok ? `, errors: ${result.validation.errors.length}` : ''
      })`,
    );
    rewritten.push(result);
  }

  const headMaterial = rewritten.map((r) => extractHeadMaterial(r.bodyHtml));
  const allStyles = headMaterial.flatMap((h) => h.styles);
  const allScripts = headMaterial.flatMap((h) => h.scripts);
  const allLinks = headMaterial.flatMap((h) => h.links);
  const allMetas = headMaterial.flatMap((h) => h.metas);
  const bodySections = rewritten.map((r, i) => ({
    role: r.role,
    site: r.site,
    bodyHtml: headMaterial[i].bodyHtml,
  }));

  const finalHtml = assembleHtml({
    title: `${opts.brief.brandName} | ${opts.brief.tagline || opts.brief.industry}`,
    lang: inferLang(rewritten),
    bodySections,
    styles: allStyles,
    scripts: allScripts,
    links: allLinks,
    metas: allMetas,
  });

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const indexPath = path.join(opts.outputDir, 'index.html');
  fs.writeFileSync(indexPath, finalHtml, 'utf-8');

  const kbAssets = path.join(loaded.kbDir, 'assets');
  const outAssets = path.join(opts.outputDir, 'assets');
  if (fs.existsSync(kbAssets) && !fs.existsSync(outAssets)) {
    try {
      fs.symlinkSync(path.resolve(kbAssets), outAssets, 'dir');
    } catch {
      fs.cpSync(kbAssets, outAssets, { recursive: true });
    }
  }

  const manifest: ComposeManifest = {
    base_site: opts.baseSite,
    brand_name: opts.brief.brandName,
    industry: opts.brief.industry,
    sector: opts.sector,
    composed_at: new Date().toISOString(),
    sections: rewritten.map((r) => ({
      role: r.role,
      site: r.site,
      outcome: r.outcome,
      attempts: r.attempts,
      original_size: r.originalSize,
      rewritten_size: r.rewrittenSize,
      validation: r.validation ? { ok: r.validation.ok, errors: r.validation.errors } : null,
      llm_errors: r.llmErrors,
    })),
  };
  const manifestPath = path.join(opts.outputDir, '_compose.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  const llmCount = rewritten.filter((r) => r.outcome === 'llm').length;
  const fallbackCount = rewritten.filter((r) => r.outcome === 'fallback-rebrand').length;
  logger.success(`Compose: ${indexPath}`);
  logger.dim(`  Manifest: ${manifestPath}`);
  logger.info(`  LLM-rewritten: ${llmCount}/${rewritten.length}, fallback: ${fallbackCount}`);

  return {
    site: loaded.index.site,
    outputDir: opts.outputDir,
    indexPath,
    manifestPath,
    sections: rewritten,
  };
}

async function runSelect(loaded: LoadedKB, opts: ComposeOptions, llm: LLMCall): Promise<SelectedSection[]> {
  const candidates: SelectCandidate[] = loaded.sections.map((s) => ({
    site: loaded.index.site,
    role: s.meta.role,
    text_excerpt: s.meta.text_excerpt,
    has_animation: s.meta.has_animation,
    dominant_classes: s.meta.dominant_classes,
  }));

  const target = opts.targetSectionCount ?? loaded.sections.length;
  if (opts.skipSelect) return selectSectionsFallback(candidates, target);

  try {
    const sel = await selectSections(opts.brief, candidates, llm, {
      sector: opts.sector,
      targetCount: target,
    });
    if (sel.length === 0) throw new Error('select returned empty');
    return sel;
  } catch (err: any) {
    logger.warn(`  select phase failed: ${err.message} — falling back to narrative order`);
    return selectSectionsFallback(candidates, target);
  }
}

async function rewriteAndValidate(
  section: LoadedSection,
  brief: ComposeBrief,
  llm: LLMCall,
  sector: string | undefined,
  maxRetries: number,
): Promise<RewrittenSection> {
  const inv = buildInventory(section.html);
  const beforeFp = inv.fingerprints;
  const llmErrors: string[] = [];

  let retryFeedback: string | undefined;
  let attempts = 0;
  let lastValidated: string | null = null;
  let lastValidation: ReturnType<typeof validateStructure> | null = null;

  for (let i = 0; i < maxRetries; i += 1) {
    attempts += 1;
    try {
      const patches = await rewriteCopyBlocks(inv, brief, llm, {
        sectionRole: section.meta.role,
        sourceSite: section.meta.file,
        sector,
        retryFeedback,
        tag: `compose:rewrite:${section.meta.role}:attempt${attempts}`,
      });
      const { html: patched } = applyPatches(section.html, inv, patches);
      const validation = validateStructure(beforeFp, patched, { minSizeRatio: 0.9 });
      lastValidation = validation;
      if (validation.ok) {
        return {
          role: section.meta.role,
          site: '',
          originalSize: section.html.length,
          rewrittenSize: patched.length,
          outcome: 'llm' as RewriteOutcome,
          attempts,
          bodyHtml: patched,
          validation,
          llmErrors,
        };
      }
      retryFeedback = validation.errors.slice(0, 4).join(' | ');
      lastValidated = patched;
      llmErrors.push(`attempt ${attempts}: ${validation.errors.join('; ')}`);
    } catch (err: any) {
      llmErrors.push(`attempt ${attempts}: ${err.message}`);
      retryFeedback = `erreur parse/LLM: ${err.message}`;
    }
  }

  // All retries exhausted — fallback to deterministic brand swap on the original section HTML
  const swapped = fallbackBrandSwap(section.html, brief.brandName, section.meta.role);
  const fallbackFp = fingerprintsOf(swapped);
  return {
    role: section.meta.role,
    site: '',
    originalSize: section.html.length,
    rewrittenSize: swapped.length,
    outcome: 'fallback-rebrand' as RewriteOutcome,
    attempts,
    bodyHtml: swapped,
    validation: lastValidation,
    llmErrors,
  };
}

/**
 * Deterministic last-resort brand swap. Replaces occurrences of the likely
 * source brand name (inferred from the KB section HTML's dominant text
 * patterns) with the new brand, in text nodes only. Scripts and styles are
 * left alone.
 */
export function fallbackBrandSwap(html: string, brandName: string, _role: string): string {
  const $ = load(html);
  const candidates = detectSourceBrandCandidates($);
  if (candidates.length === 0) return html;

  const walk = (node: any) => {
    if (!node) return;
    if (node.type === 'text') {
      let s = (node.data as string) || '';
      for (const cand of candidates) {
        const re = new RegExp(escapeRegex(cand), 'gi');
        s = s.replace(re, brandName);
      }
      node.data = s;
    } else if (node.type === 'tag') {
      const tag = (node.tagName || node.name || '').toLowerCase();
      if (tag === 'script' || tag === 'style') return;
      for (const k of node.children || []) walk(k);
    } else if (node.type === 'root') {
      for (const k of node.children || []) walk(k);
    }
  };
  const root = ($('body').get(0) as any) || (($ as any).root().get(0) as any);
  walk(root);

  // also patch <title>
  const titleEl = $('head title').first();
  if (titleEl.length) {
    let t = titleEl.text();
    for (const cand of candidates) t = t.replace(new RegExp(escapeRegex(cand), 'gi'), brandName);
    titleEl.text(t);
  }
  return $.html();
}

function detectSourceBrandCandidates($: any): string[] {
  const texts: string[] = [];
  $('title, h1, h2, header, footer, [class*="brand"], [class*="logo"]').each((_: any, el: any) => {
    const t = $(el).text().trim();
    if (t && t.length < 120) texts.push(t);
  });
  const bag: Record<string, number> = {};
  for (const t of texts) {
    for (const tok of t.split(/\s+/)) {
      const word = tok.replace(/[^\w-]/g, '');
      if (word.length < 3 || word.length > 30) continue;
      if (/^\d+$/.test(word)) continue;
      bag[word] = (bag[word] || 0) + 1;
    }
  }
  return Object.entries(bag)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inferLang(rewritten: RewrittenSection[]): string {
  for (const r of rewritten) {
    const m = r.bodyHtml.match(/<html[^>]*lang=["']([a-zA-Z-]+)["']/i);
    if (m) return m[1];
  }
  return 'en';
}
