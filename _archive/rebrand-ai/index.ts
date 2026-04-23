import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { callLLM as callLLMShared, LLMError } from '../utils/llm.js';
import { buildInventory } from '../compose/inventory.js';
import { applyPatches } from '../compose/reinject.js';
import { validateStructure, fingerprintsOf } from '../compose/validate.js';
import { rewriteCopyBlocks } from '../compose/rewrite-text.js';
import { fallbackBrandSwap } from '../compose/index.js';
import type { ComposeBrief, LLMCall } from '../compose/types.js';
import type { Inventory, CopyBlock } from '../compose/inventory.js';
import type { Patches } from '../compose/reinject.js';

export interface RebrandAIOptions {
  inputHtml: string;
  brief: ComposeBrief;
  outputDir: string;
  llm?: LLMCall;
  /** Max retries when validation rejects a rewrite. Default 2. */
  maxRetries?: number;
  /** Process the inventory in chunks of N copyBlocks so a single LLM call stays small. Default 40. */
  chunkSize?: number;
  /** Sector hint injected into prompts. */
  sector?: string;
}

export interface RebrandAIResult {
  outputHtml: string;
  manifestPath: string;
  stats: {
    copyBlocksTotal: number;
    copyBlocksRewritten: number;
    attrsTotal: number;
    attrsRewritten: number;
    metaTotal: number;
    metaRewritten: number;
    chunks: number;
    llmErrors: string[];
    validation: { ok: boolean; errors: string[] };
    outcome: 'llm-full' | 'llm-partial' | 'fallback-rebrand';
    originalSize: number;
    outputSize: number;
  };
}

const defaultLLM: LLMCall = async ({ prompt, maxTokens }) =>
  callLLMShared({ prompt, maxTokens, silent: true, strict: true });

/**
 * Apply an LLM-driven rebrand to a full single-page HTML.
 *
 * Unlike `compose/`, this function never splices, concatenates, or reorders
 * anything. It takes the input document as-is (assumed to be a working
 * reproduction from `clone` or `reproduce-exact`) and rewrites only the
 * visible-text surface via the text-diff pipeline. Everything structural
 * — scripts, CSS at-rules, data-attributes, DOM hierarchy, asset refs —
 * is preserved byte-for-byte.
 */
export async function rebrandAi(opts: RebrandAIOptions): Promise<RebrandAIResult> {
  const absInput = path.resolve(opts.inputHtml);
  if (!fs.existsSync(absInput)) {
    throw new Error(`rebrand-ai: input HTML not found: ${absInput}`);
  }
  const html = fs.readFileSync(absInput, 'utf-8');
  const beforeFp = fingerprintsOf(html);

  const inv = buildInventory(html);
  const llm = opts.llm ?? defaultLLM;
  const chunkSize = opts.chunkSize ?? 40;
  const maxRetries = opts.maxRetries ?? 2;

  logger.info(
    `Rebrand-AI: ${inv.copyBlocks.length} text blocks, ${inv.attrs.length} text-attrs, ${inv.metaText.length} meta — rewriting in chunks of ${chunkSize}...`,
  );

  const chunks = chunkInventory(inv, chunkSize);
  const merged: Patches = { copy: {}, attrs: {}, meta: {} };
  const llmErrors: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const sub = chunks[i];
    logger.step(
      i + 1,
      chunks.length,
      `chunk ${sub.copyBlocks.length} blocks + ${sub.attrs.length} attrs + ${sub.metaText.length} meta`,
    );
    const patches = await rewriteWithRetry(sub, opts.brief, llm, maxRetries, opts.sector, llmErrors);
    Object.assign(merged.copy!, patches.copy || {});
    Object.assign(merged.attrs!, patches.attrs || {});
    Object.assign(merged.meta!, patches.meta || {});
  }

  const copyRewritten = Object.keys(merged.copy || {}).length;
  const attrsRewritten = Object.keys(merged.attrs || {}).length;
  const metaRewritten = Object.keys(merged.meta || {}).length;

  let { html: patched, report } = applyPatches(html, inv, merged);

  // Safety net: sweep leftover source-brand tokens that neither the LLM
  // addressed nor appeared in the inventory (dangling inline strings inside
  // tables, SVG text, etc.).
  patched = fallbackBrandSwap(patched, opts.brief.brandName, 'full-page');

  const validation = validateStructure(beforeFp, patched, { minSizeRatio: 0.9 });
  let outcome: RebrandAIResult['stats']['outcome'] = 'llm-full';
  if (!validation.ok) {
    logger.warn(`validation failed: ${validation.errors.join(' | ')} — keeping output anyway`);
    outcome = 'llm-partial';
  }

  // If the LLM produced zero patches (all chunks failed), fall back to the
  // deterministic brand swap on the pristine input — nothing LLM-touched.
  if (copyRewritten === 0 && attrsRewritten === 0 && metaRewritten === 0) {
    logger.warn('LLM produced no patches — falling back to deterministic brand swap only');
    patched = fallbackBrandSwap(html, opts.brief.brandName, 'full-page');
    outcome = 'fallback-rebrand';
  }

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const outputHtml = path.join(opts.outputDir, 'index.html');
  fs.writeFileSync(outputHtml, patched, 'utf-8');

  // Bring the site's assets alongside the output (symlink first, copy second).
  const inputDir = path.dirname(absInput);
  const assetsSrc = path.join(inputDir, 'assets');
  const assetsDst = path.join(opts.outputDir, 'assets');
  if (fs.existsSync(assetsSrc) && !fs.existsSync(assetsDst)) {
    try {
      fs.symlinkSync(path.resolve(assetsSrc), assetsDst, 'dir');
    } catch {
      fs.cpSync(assetsSrc, assetsDst, { recursive: true });
    }
  }

  const manifestPath = path.join(opts.outputDir, '_rebrand-ai.json');
  const stats = {
    copyBlocksTotal: inv.copyBlocks.length,
    copyBlocksRewritten: copyRewritten,
    attrsTotal: inv.attrs.length,
    attrsRewritten,
    metaTotal: inv.metaText.length,
    metaRewritten,
    chunks: chunks.length,
    llmErrors,
    validation: { ok: validation.ok, errors: validation.errors },
    outcome,
    originalSize: html.length,
    outputSize: patched.length,
    reinjectReport: report,
    input: absInput,
    output: outputHtml,
    brand_name: opts.brief.brandName,
    composed_at: new Date().toISOString(),
  };
  fs.writeFileSync(manifestPath, JSON.stringify(stats, null, 2), 'utf-8');

  logger.success(`Rebrand-AI: ${outputHtml}`);
  logger.dim(`  Manifest: ${manifestPath}`);
  logger.info(
    `  copy ${copyRewritten}/${inv.copyBlocks.length} · attrs ${attrsRewritten}/${inv.attrs.length} · meta ${metaRewritten}/${inv.metaText.length} · size ${html.length}→${patched.length} bytes · outcome=${outcome}`,
  );

  return {
    outputHtml,
    manifestPath,
    stats: {
      copyBlocksTotal: inv.copyBlocks.length,
      copyBlocksRewritten: copyRewritten,
      attrsTotal: inv.attrs.length,
      attrsRewritten,
      metaTotal: inv.metaText.length,
      metaRewritten,
      chunks: chunks.length,
      llmErrors,
      validation: { ok: validation.ok, errors: validation.errors },
      outcome,
      originalSize: html.length,
      outputSize: patched.length,
    },
  };
}

function chunkInventory(inv: Inventory, size: number): Inventory[] {
  if (inv.copyBlocks.length <= size && inv.attrs.length <= size && inv.metaText.length <= size) {
    return [inv];
  }
  const chunks: Inventory[] = [];
  const copyChunks = chunkArray(inv.copyBlocks, size);
  for (let i = 0; i < copyChunks.length; i += 1) {
    chunks.push({
      copyBlocks: copyChunks[i],
      attrs: i === 0 ? inv.attrs : [],
      metaText: i === 0 ? inv.metaText : [],
      fingerprints: inv.fingerprints,
    });
  }
  return chunks;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function rewriteWithRetry(
  chunk: Inventory,
  brief: ComposeBrief,
  llm: LLMCall,
  maxRetries: number,
  sector: string | undefined,
  errorsOut: string[],
): Promise<Patches> {
  let retryFeedback: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const patches = await rewriteCopyBlocks(chunk, brief, llm, {
        sectionRole: 'full-page',
        sourceSite: 'clone',
        sector,
        retryFeedback,
        maxTokens: 8000,
        tag: `rebrand-ai:attempt${attempt}`,
      });
      return patches;
    } catch (err: any) {
      const msg = err instanceof LLMError ? err.message : err.message || String(err);
      errorsOut.push(`attempt ${attempt}: ${msg}`);
      retryFeedback = `erreur parse/LLM précédente: ${msg}`;
    }
  }
  return { copy: {}, attrs: {}, meta: {} };
}
