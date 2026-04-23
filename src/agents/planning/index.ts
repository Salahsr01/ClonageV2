// Agent ② — Planning (REFACTOR_BRIEF.md §4.4)

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import type { AtlasHit, AtlasIO, EmbeddingProvider } from '../../atlas/index.js';
import { JsonlAtlasStore, loadDefaultEmbedder, query as atlasQuery } from '../../atlas/index.js';
import type { TextLLM } from './llm.js';
import { loadDefaultTextLLM } from './llm.js';
import { SYSTEM_PROMPT, buildPlanningPrompt, buildRetryPrompt, formatCandidates, parsePlanJson } from './prompt.js';
import type { Plan } from './schema.js';
import { CANONICAL_PLAN_ROLES, PlanSchema } from './schema.js';

export type { Plan, PlanSection } from './schema.js';
export { CANONICAL_PLAN_ROLES } from './schema.js';

export interface PlanningInput {
  brief: Record<string, unknown>;
  io?: AtlasIO;
  embedder?: EmbeddingProvider;
  llm?: TextLLM;
  /** Override which roles to search for. Defaults to CANONICAL_PLAN_ROLES. */
  roles?: readonly string[];
  topKPerRole?: number;
  maxRetries?: number;
  /** Extra sources to block across all role queries (used by S6 retry). */
  excludeSources?: string[];
}

export interface PlanningResult {
  plan: Plan;
  /** Candidate pool per role, for display/debug. */
  candidates: Record<string, AtlasHit[]>;
}

export async function plan(input: PlanningInput): Promise<PlanningResult> {
  const {
    brief,
    roles = CANONICAL_PLAN_ROLES,
    topKPerRole = 5,
    maxRetries = 2,
    excludeSources = [],
  } = input;
  const io = input.io ?? new JsonlAtlasStore();
  const embedder = input.embedder ?? loadDefaultEmbedder();
  const llm = input.llm ?? loadDefaultTextLLM();

  // Convert brief to a single searchable text for atlas queries.
  const briefText = briefToQueryText(brief);

  const candidates: Record<string, AtlasHit[]> = {};
  for (const role of roles) {
    const hits = await atlasQuery(
      {
        brief: briefText,
        roleFilter: role,
        excludeSources,
        topK: topKPerRole,
      },
      { io, embedder },
    );
    if (hits.length > 0) candidates[role] = hits;
  }

  if (Object.keys(candidates).length === 0) {
    throw new Error(
      'planning: atlas returned no candidates for any role — run `clonage atlas index` first.',
    );
  }

  const validIds = new Set<string>();
  const validSites = new Set<string>();
  for (const hits of Object.values(candidates)) {
    for (const h of hits) {
      validIds.add(h.entry.id);
      validSites.add(h.entry.site);
    }
  }

  const userPrompt = buildPlanningPrompt(brief, formatCandidates(candidates));

  let lastResponse = '';
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = attempt === 0 ? userPrompt : `${userPrompt}\n\n${buildRetryPrompt(lastResponse, lastError)}`;
    try {
      lastResponse = await llm.complete({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        maxTokens: 2500,
      });
      const parsed = parsePlanJson(lastResponse);
      const validated = PlanSchema.parse(parsed);

      // Integrity checks that zod can't express: sources must be in candidates.
      for (const s of validated.sections) {
        if (!validIds.has(s.source)) {
          throw new Error(`plan references unknown source "${s.source}" — not in candidate pool`);
        }
      }
      for (const ref of [
        validated.design_constraints.palette_reference,
        validated.design_constraints.typo_reference,
        validated.design_constraints.rhythm_reference,
      ]) {
        if (!validSites.has(ref)) {
          throw new Error(`design_constraints reference "${ref}" — not in candidate pool`);
        }
      }

      return { plan: validated, candidates };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        lastError = JSON.stringify(err.issues).substring(0, 800);
      } else {
        lastError = err?.message || String(err);
      }
      if (attempt === maxRetries) {
        throw new Error(`planning failed after ${maxRetries + 1} attempts: ${lastError}`);
      }
    }
  }
  throw new Error('planning: unexpected loop exit');
}

function briefToQueryText(brief: Record<string, unknown>): string {
  // Pull the common fields if present. Fallback to JSON.
  const parts: string[] = [];
  for (const key of ['brandName', 'name', 'industry', 'tagline', 'description']) {
    const v = (brief as any)[key];
    if (typeof v === 'string' && v) parts.push(v);
  }
  const vals = (brief as any).values || (brief as any).brand?.values;
  if (Array.isArray(vals)) parts.push(vals.join(' '));
  const mood = (brief as any).mood || (brief as any).brand?.mood;
  if (typeof mood === 'string') parts.push(mood);
  if (Array.isArray(mood)) parts.push(mood.join(' '));
  if (parts.length === 0) parts.push(JSON.stringify(brief));
  return parts.join('. ');
}

/**
 * Render a plan as a terminal-friendly ASCII table. Used by `clonage plan`
 * to print the plan alongside writing it to disk.
 */
export function renderPlanTable(plan: Plan, candidates?: Record<string, AtlasHit[]>): string {
  const lines: string[] = [];
  lines.push(`# Plan for "${plan.brand}"`);
  lines.push('');
  lines.push('| role | source | reason |');
  lines.push('|---|---|---|');
  for (const s of plan.sections) {
    const reason = s.reason.replace(/\|/g, '\\|').substring(0, 100);
    lines.push(`| ${s.role} | ${s.source} | ${reason} |`);
  }
  lines.push('');
  lines.push(`**Design constraints:** palette=${plan.design_constraints.palette_reference}  typo=${plan.design_constraints.typo_reference}  rhythm=${plan.design_constraints.rhythm_reference}`);
  lines.push('');
  lines.push(`**Coherence:** ${plan.coherence_notes}`);
  if (candidates) {
    lines.push('');
    lines.push('## Candidate pool (top-5 per role)');
    for (const role of Object.keys(candidates)) {
      lines.push(`- ${role}:`);
      for (const h of candidates[role]) {
        lines.push(`    ${h.score.toFixed(3)}  ${h.entry.id}`);
      }
    }
  }
  return lines.join('\n');
}

export function writePlan(plan: Plan, outPath: string): void {
  const validated = PlanSchema.parse(plan);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(validated, null, 2), 'utf-8');
}

export function readPlan(filePath: string): Plan {
  return PlanSchema.parse(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}
