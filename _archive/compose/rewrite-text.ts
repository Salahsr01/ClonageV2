import { buildRewritePrompt } from './prompt.js';
import type { Inventory } from './inventory.js';
import type { ComposeBrief, LLMCall } from './types.js';
import type { Patches } from './reinject.js';

export interface RewriteOpts {
  sectionRole: string;
  sourceSite: string;
  sector?: string;
  retryFeedback?: string;
  tag?: string;
  maxTokens?: number;
}

export class RewriteParseError extends Error {
  readonly raw: string;
  constructor(msg: string, raw: string) {
    super(msg);
    this.name = 'RewriteParseError';
    this.raw = raw;
  }
}

function stripFences(s: string): string {
  const fenced = s.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  return (fenced ? fenced[1] : s).trim();
}

function extractJsonObject(raw: string): any {
  const cleaned = stripFences(raw);
  // Fast path
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }
  // Slow path: find first '{' and last '}' that yield valid JSON
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = cleaned.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      // fall through
    }
  }
  throw new RewriteParseError('could not parse JSON object from LLM response', raw);
}

function coerceStringMap(obj: any): Record<string, string> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export async function rewriteCopyBlocks(
  inv: Inventory,
  brief: ComposeBrief,
  llm: LLMCall,
  opts: RewriteOpts,
): Promise<Patches> {
  const prompt = buildRewritePrompt({
    brief,
    sectionRole: opts.sectionRole,
    sourceSite: opts.sourceSite,
    inventory: inv,
    sector: opts.sector,
    retryFeedback: opts.retryFeedback,
  });

  const raw = await llm({
    prompt,
    maxTokens: opts.maxTokens ?? 8000,
    tag: opts.tag ?? `compose:rewrite:${opts.sectionRole}`,
  });

  if (!raw || !raw.trim()) {
    throw new RewriteParseError('empty LLM response', raw ?? '');
  }

  const parsed = extractJsonObject(raw);
  return {
    copy: coerceStringMap(parsed.copy),
    attrs: coerceStringMap(parsed.attrs),
    meta: coerceStringMap(parsed.meta),
  };
}
