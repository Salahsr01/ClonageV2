// compose orchestrator — REFACTOR_BRIEF §6 S6 étape 6.
//
// Runs the full ScreenCoder pipeline: plan → generate → validate, with retry
// cap 3 on validator failure (excluded sources are fed back into Planning).

import * as fs from 'fs';
import * as path from 'path';

import type { TextLLM } from './agents/planning/llm.js';
import type { EmbeddingProvider, AtlasIO } from './atlas/index.js';
import type { VisionLLM } from './agents/grounding/llm.js';
import type { Plan } from './agents/planning/schema.js';

import { plan as runPlanning, renderPlanTable, writePlan } from './agents/planning/index.js';
import { generate } from './agents/generation/index.js';
import { validate, writeFailureReport } from './validator/index.js';
import { JsonlAtlasStore, loadDefaultEmbedder } from './atlas/index.js';
import { loadDefaultTextLLM } from './agents/planning/llm.js';
import { logger } from './utils/logger.js';

export interface ComposeInput {
  brief: Record<string, unknown>;
  outputDir: string;
  /** Atlas file path override. */
  atlasPath?: string;
  kbRoot?: string;
  embedder?: EmbeddingProvider;
  io?: AtlasIO;
  textLLM?: TextLLM;
  visionLLM?: VisionLLM;
  maxRetries?: number;
  /** When true, do not run Generation after Planning — used by `clonage plan`. */
  planOnly?: boolean;
}

export interface ComposeResult {
  plan: Plan;
  outputHtml?: string;
  passed: boolean;
  attempts: number;
  failureReportPath?: string;
}

export async function compose(input: ComposeInput): Promise<ComposeResult> {
  const io = input.io ?? new JsonlAtlasStore(input.atlasPath);
  const embedder = input.embedder ?? loadDefaultEmbedder();
  const llm = input.textLLM ?? loadDefaultTextLLM();
  const maxRetries = input.maxRetries ?? 3;

  const excludeSources: string[] = [];
  let lastPlan: Plan | null = null;
  let lastOutputHtml: string | undefined;
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    lastAttempt = attempt;
    logger.step(attempt, maxRetries, `Planning (excluded: ${excludeSources.length})`);
    const planResult = await runPlanning({
      brief: input.brief,
      io,
      embedder,
      llm,
      excludeSources: [...excludeSources],
    });
    lastPlan = planResult.plan;

    if (input.planOnly) {
      // Write the plan and stop — approval mode.
      const planPath = path.join(input.outputDir, '_plan.json');
      fs.mkdirSync(input.outputDir, { recursive: true });
      writePlan(lastPlan, planPath);
      console.log('');
      console.log(renderPlanTable(lastPlan, planResult.candidates));
      logger.info(`Plan written: ${planPath}`);
      return { plan: lastPlan, passed: true, attempts: 1 };
    }

    logger.step(attempt, maxRetries, 'Generation');
    const gen = await generate({
      plan: lastPlan,
      brief: input.brief,
      outputDir: input.outputDir,
      io,
      llm,
      kbRoot: input.kbRoot,
      rewriteText: true,
    });
    lastOutputHtml = gen.outputHtml;

    logger.step(attempt, maxRetries, 'Validation');
    const v = await validate({
      plan: lastPlan,
      generatedHtmlPath: gen.outputHtml,
      kbRoot: input.kbRoot,
      visionLLM: input.visionLLM,
    });

    if (v.passed) {
      logger.success(`Compose OK after ${attempt} attempt(s) — ${gen.outputHtml}`);
      return { plan: lastPlan, outputHtml: gen.outputHtml, passed: true, attempts: attempt };
    }

    logger.warn(
      `Validator rejected ${v.perSection.filter((s) => !s.pass).length}/${v.perSection.length} sections — retrying.`,
    );
    for (const s of v.perSection) {
      if (!s.pass) excludeSources.push(s.source);
    }
    if (attempt === maxRetries) {
      const reportPath = writeFailureReport(input.outputDir, v);
      logger.error(`Validator rejected after ${maxRetries} attempts. Failure report: ${reportPath}`);
      return {
        plan: lastPlan,
        outputHtml: lastOutputHtml,
        passed: false,
        attempts: attempt,
        failureReportPath: reportPath,
      };
    }
  }

  // Unreachable — the loop always returns.
  return { plan: lastPlan!, passed: false, attempts: lastAttempt };
}
