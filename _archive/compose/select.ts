import { buildSelectPrompt } from './prompt.js';
import type { SelectCandidate } from './prompt.js';
import type { ComposeBrief, LLMCall } from './types.js';

export { SelectCandidate } from './prompt.js';

export interface SelectedSection {
  idx: number;
  site: string;
  role: string;
  reason: string;
}

export interface SelectOpts {
  sector?: string;
  targetCount?: number;
  tag?: string;
}

export class SelectParseError extends Error {
  readonly raw: string;
  constructor(msg: string, raw: string) {
    super(msg);
    this.name = 'SelectParseError';
    this.raw = raw;
  }
}

function stripFences(s: string): string {
  const fenced = s.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  return (fenced ? fenced[1] : s).trim();
}

function extractJsonArray(raw: string): any[] {
  const cleaned = stripFences(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through
  }
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first >= 0 && last > first) {
    try {
      const parsed = JSON.parse(cleaned.slice(first, last + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  throw new SelectParseError('could not parse JSON array from LLM response', raw);
}

export async function selectSections(
  brief: ComposeBrief,
  candidates: SelectCandidate[],
  llm: LLMCall,
  opts: SelectOpts = {},
): Promise<SelectedSection[]> {
  if (candidates.length === 0) return [];

  const prompt = buildSelectPrompt({
    brief,
    candidates,
    sector: opts.sector,
    targetCount: opts.targetCount,
  });

  const raw = await llm({
    prompt,
    maxTokens: 2000,
    tag: opts.tag ?? 'compose:select',
  });

  if (!raw || !raw.trim()) {
    throw new SelectParseError('empty LLM response', raw ?? '');
  }

  const arr = extractJsonArray(raw);
  const out: SelectedSection[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') continue;
    const idx = typeof entry.idx === 'number' ? entry.idx : -1;
    if (idx < 0 || idx >= candidates.length) continue;
    const c = candidates[idx];
    out.push({
      idx,
      site: c.site,
      role: c.role,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    });
  }
  return out;
}

/**
 * Deterministic fallback used when no LLM is configured or LLM fails.
 * Orders candidates by a simple narrative heuristic and caps at targetCount.
 */
export function selectSectionsFallback(
  candidates: SelectCandidate[],
  targetCount = 6,
): SelectedSection[] {
  const narrativeOrder = ['nav', 'hero', 'services', 'about', 'portfolio', 'testimonials', 'cta', 'contact', 'footer'];
  const rank = (role: string) => {
    const r = role.toLowerCase();
    const i = narrativeOrder.indexOf(r);
    if (i >= 0) return i;
    if (r.startsWith('section-')) return 50 + parseInt(r.slice(8), 10);
    return 100;
  };
  const ordered = candidates
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => rank(a.c.role) - rank(b.c.role))
    .slice(0, targetCount);
  return ordered.map(({ c, idx }) => ({
    idx,
    site: c.site,
    role: c.role,
    reason: 'fallback narrative order',
  }));
}
