// Validator — boucle de validation (REFACTOR_BRIEF.md §4.6)

import * as fs from 'fs';
import * as path from 'path';
import * as cheerio from 'cheerio';

import type { Plan } from '../agents/planning/schema.js';
import type { VisionLLM } from '../agents/grounding/llm.js';
import { loadSectionBySourceId } from '../agents/generation/kb-loader.js';
import { compareFingerprints, fingerprintHtml } from './fingerprint-check.js';
import type { Fingerprint, FingerprintCheck } from './fingerprint-check.js';
import { critique } from './vision-critique.js';
import type { Critique } from './vision-critique.js';

export type { Fingerprint, FingerprintCheck } from './fingerprint-check.js';
export { compareFingerprints, fingerprintHtml } from './fingerprint-check.js';
export { diffPng } from './screenshot-diff.js';
export type { DiffResult } from './screenshot-diff.js';
export { critique } from './vision-critique.js';

export interface ValidatorInput {
  plan: Plan;
  /** Path to the generated `index.html`. */
  generatedHtmlPath: string;
  kbRoot?: string;
  /** Optional VLM for coherence critique per section with low fingerprint delta. */
  visionLLM?: VisionLLM;
  /** Node-count tolerance per section. Default 5%. */
  nodeTolerance?: number;
}

export interface SectionValidation {
  role: string;
  source: string;
  fingerprintCheck: FingerprintCheck;
  /** Only populated when the VLM was asked. */
  critique?: Critique;
  pass: boolean;
}

export interface ValidatorResult {
  passed: boolean;
  perSection: SectionValidation[];
  /** Source ids (`site#role`) that should be excluded from the next Planning retry. */
  excludeSuggestions: string[];
}

/**
 * Run the validator without screenshots — pure DOM fingerprint comparison.
 * Good enough for unit tests and headless runs. The vision critique is an
 * optional add-on when a VisionLLM is provided.
 *
 * The full pipeline with Playwright screenshots + pixelmatch lives in
 * `compose/orchestrator.ts` to keep the validator itself side-effect-free.
 */
export async function validate(input: ValidatorInput): Promise<ValidatorResult> {
  if (!fs.existsSync(input.generatedHtmlPath)) {
    throw new Error(`validator: generated HTML not found: ${input.generatedHtmlPath}`);
  }
  const generatedHtml = fs.readFileSync(input.generatedHtmlPath, 'utf-8');

  // Extract per-section blocks from the generated doc by the inline `<!-- section: role from site -->`
  // comments our assembler writes.
  const generatedBlocks = splitGeneratedByComments(generatedHtml);

  const perSection: SectionValidation[] = [];
  const excludes: string[] = [];

  // Global fingerprint of the whole generated doc — used for scripts/keyframes
  // aggregate check. Per-section comparison only tracks body-nodes because the
  // assembler hoists head-level scripts/keyframes to the global <head>.
  const wholeGenFp = fingerprintHtml(generatedHtml);

  let sourceScriptsTotal = 0;
  let sourceKeyframesTotal = 0;

  for (const planSection of input.plan.sections) {
    const source = loadSectionBySourceId(planSection.source, input.kbRoot);
    const sourceFpFull = fingerprintHtml(source.html);
    sourceScriptsTotal += sourceFpFull.scripts;
    sourceKeyframesTotal += sourceFpFull.keyframes;

    // For per-section comparison, count nodes of body-inner only. This matches
    // the generated block (which is body-inner + section marker).
    const sourceBodyInner = extractBodyInner(source.html);
    const sourceNodes = fingerprintHtml(sourceBodyInner).nodes;
    const srcBodyOnly: Fingerprint = {
      nodes: sourceNodes,
      scripts: 0,
      keyframes: 0,
      linkStylesheets: 0,
      fonts: 0,
    };

    const block = generatedBlocks.find(
      (b) => b.role === planSection.role && b.site === source.site,
    );
    const actualBodyOnly: Fingerprint = block
      ? { ...fingerprintHtml(block.html), scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 }
      : { nodes: 0, scripts: 0, keyframes: 0, linkStylesheets: 0, fonts: 0 };

    const fpCheck = compareFingerprints(srcBodyOnly, actualBodyOnly, {
      nodeTolerance: input.nodeTolerance,
    });

    let vlmCritique: Critique | undefined;
    // Only call VLM when the fingerprint is close enough that the error might
    // be subtle visual drift, not missing scripts. Saves cost.
    if (input.visionLLM && fpCheck.ok === false && fpCheck.report.every((r) => r.startsWith('nodes:'))) {
      try {
        vlmCritique = await critique(input.visionLLM, {
          actualImageBase64: '',
          expectedImageBase64: '',
          role: planSection.role,
          sectionSignature: '',
        });
      } catch {
        // Critique is best-effort.
      }
    }

    const pass = fpCheck.ok && (vlmCritique === undefined || vlmCritique.coherent);
    perSection.push({
      role: planSection.role,
      source: planSection.source,
      fingerprintCheck: fpCheck,
      critique: vlmCritique,
      pass,
    });

    if (!pass) excludes.push(planSection.source);
  }

  // Global aggregate check: the generated doc must hold at least as many
  // scripts and @keyframes as the union of all source sections.
  const globalIssues: string[] = [];
  if (wholeGenFp.scripts < sourceScriptsTotal) {
    globalIssues.push(
      `global scripts: missing ${sourceScriptsTotal - wholeGenFp.scripts} (expected=${sourceScriptsTotal}, actual=${wholeGenFp.scripts})`,
    );
  }
  if (wholeGenFp.keyframes < sourceKeyframesTotal) {
    globalIssues.push(
      `global keyframes: missing ${sourceKeyframesTotal - wholeGenFp.keyframes} (expected=${sourceKeyframesTotal}, actual=${wholeGenFp.keyframes})`,
    );
  }

  const passed = perSection.every((s) => s.pass) && globalIssues.length === 0;
  if (!passed && globalIssues.length > 0) {
    // Attach global issues to the first failing section for report output.
    const target = perSection.find((s) => !s.pass) ?? perSection[0];
    if (target) target.fingerprintCheck.report.push(...globalIssues);
  }

  return {
    passed,
    perSection,
    excludeSuggestions: excludes,
  };
}

/**
 * Extract the contents of <body>. Returns a blob we can fingerprint
 * apples-to-apples against the per-section block in the generated output.
 */
function extractBodyInner(html: string): string {
  const $ = cheerio.load(html, { xml: false });
  const body = $('body');
  return body.length ? body.html() || '' : $.root().html() || '';
}

/**
 * Parse `<!-- section: <role> from <site> -->\n...` markers inserted by the
 * assembler. Returns each section's HTML block.
 */
function splitGeneratedByComments(html: string): Array<{ role: string; site: string; html: string }> {
  const blocks: Array<{ role: string; site: string; html: string }> = [];
  const re = /<!--\s*section:\s*([\w-]+)\s+from\s+([^\s]+)\s*-->\s*([\s\S]*?)(?=<!--\s*section:|<\/body>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    blocks.push({ role: m[1], site: m[2], html: m[3].trim() });
  }
  return blocks;
}

export function writeFailureReport(outputDir: string, result: ValidatorResult): string {
  const reportPath = path.join(outputDir, '_failure_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
  return reportPath;
}
