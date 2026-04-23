// Agent ③ — Generation (REFACTOR_BRIEF.md §4.5)
//
// Zero-LLM on HTML structure. The only LLM touch is the text-diff pass that
// modifies text nodes in place. Everything else is deterministic TypeScript.

import * as fs from 'fs';
import * as path from 'path';

import type { Plan } from '../planning/schema.js';
import type { TextLLM } from '../planning/llm.js';
import { readPlan } from '../planning/index.js';
import { loadDefaultTextLLM } from '../planning/llm.js';
import type { AtlasEntry, AtlasIO } from '../../atlas/index.js';
import { JsonlAtlasStore } from '../../atlas/index.js';
import { loadSectionBySourceId, siteAssetsDir } from './kb-loader.js';
import { textDiff } from './text-diff.js';
import { remapTokens } from './token-remap.js';
import { assemble } from './assembler.js';

export interface GenerateInput {
  /** Path to a validated _plan.json. Alternative to passing `plan` directly. */
  planPath?: string;
  plan?: Plan;
  brief: Record<string, unknown>;
  outputDir: string;
  kbRoot?: string;
  io?: AtlasIO;
  llm?: TextLLM;
  /** If false, skip the LLM text-diff pass (used for deterministic e2e tests). */
  rewriteText?: boolean;
  sector?: string;
}

export interface GenerateResult {
  outputHtml: string;
  outputDir: string;
  fingerprints: Array<{
    role: string;
    site: string;
    scripts: number;
    keyframes: number;
    nodes: number;
  }>;
  report: {
    plan: Plan;
    textDiff: Array<{ role: string; applied: number; blocks: number }>;
  };
}

export async function generate(input: GenerateInput): Promise<GenerateResult> {
  const plan: Plan = input.plan ?? (input.planPath ? readPlan(input.planPath) : undefined!);
  if (!plan) {
    throw new Error('generate: either plan or planPath is required');
  }
  const io = input.io ?? new JsonlAtlasStore();
  const rewriteText = input.rewriteText !== false;

  // Load sections from KB.
  const loaded = plan.sections.map((s) => ({
    planSection: s,
    ...loadSectionBySourceId(s.source, input.kbRoot),
  }));

  // Resolve atlas entries for palette / typo references.
  const atlasEntries = io.load();
  const atlasById: Record<string, AtlasEntry> = {};
  for (const e of atlasEntries) atlasById[e.id] = e;
  const paletteRef = firstAtlasEntryForSite(atlasEntries, plan.design_constraints.palette_reference);
  const typoRef = firstAtlasEntryForSite(atlasEntries, plan.design_constraints.typo_reference);

  // Process each section: token-remap, then text-diff (optional).
  const processed: Array<{ role: string; site: string; html: string; textDiff: { applied: number; blocks: number } }> = [];
  for (const s of loaded) {
    let html = s.html;
    const selfEntry = atlasById[s.planSection.source];
    if (selfEntry) {
      html = remapTokens({ html, self: selfEntry, paletteRef, typoRef });
    }

    let td = { applied: 0, blocks: 0 };
    if (rewriteText && input.llm) {
      const res = await textDiff({
        html,
        brief: input.brief,
        sectionRole: s.role,
        llm: input.llm,
        sector: input.sector,
      });
      html = res.html;
      td = { applied: res.applied, blocks: res.blocks };
    } else if (rewriteText && !input.llm) {
      // Try the default LLM — if no key, skip silently.
      try {
        const llm = loadDefaultTextLLM();
        const res = await textDiff({ html, brief: input.brief, sectionRole: s.role, llm, sector: input.sector });
        html = res.html;
        td = { applied: res.applied, blocks: res.blocks };
      } catch {
        // No API key — skip text-diff. The deterministic output still ships.
      }
    }

    processed.push({ role: s.role, site: s.site, html, textDiff: td });
  }

  // Assemble.
  const brandTitle = typeof input.brief.brandName === 'string' ? (input.brief.brandName as string) : undefined;
  const assembled = assemble({
    sections: processed.map((p) => ({ role: p.role, site: p.site, html: p.html })),
    title: brandTitle,
    designConstraintsJson: JSON.stringify(plan.design_constraints),
  });

  // Write output.
  fs.mkdirSync(input.outputDir, { recursive: true });
  const outHtml = path.join(input.outputDir, 'index.html');
  fs.writeFileSync(outHtml, assembled.html, 'utf-8');

  // Copy assets from each referenced site.
  const assetsDir = path.join(input.outputDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  const seenSites = new Set<string>();
  for (const s of loaded) {
    if (seenSites.has(s.site)) continue;
    seenSites.add(s.site);
    const srcAssets = siteAssetsDir(s.site, input.kbRoot);
    if (srcAssets) {
      const dest = path.join(assetsDir, s.site);
      try {
        fs.cpSync(srcAssets, dest, { recursive: true });
      } catch {
        // Assets are optional — sometimes they're huge binary dirs (videos).
      }
    }
  }

  // Write a generation report.
  fs.writeFileSync(
    path.join(input.outputDir, '_generation.json'),
    JSON.stringify(
      {
        plan,
        fingerprints: assembled.fingerprints,
        textDiff: processed.map((p) => ({ role: p.role, ...p.textDiff })),
        generated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf-8',
  );

  return {
    outputHtml: outHtml,
    outputDir: input.outputDir,
    fingerprints: assembled.fingerprints,
    report: {
      plan,
      textDiff: processed.map((p) => ({ role: p.role, ...p.textDiff })),
    },
  };
}

function firstAtlasEntryForSite(entries: AtlasEntry[], site: string): AtlasEntry | undefined {
  for (const e of entries) {
    if (e.site === site) return e;
  }
  return undefined;
}

export { assemble } from './assembler.js';
export { textDiff, extractCopyBlocks, applyRewrites } from './text-diff.js';
export { remapTokens, remapPalette, remapFont } from './token-remap.js';
export { loadSectionBySourceId } from './kb-loader.js';
