import type { AtlasHit } from '../../atlas/index.js';

export const SYSTEM_PROMPT = `You are the art director of a website generator. You receive:
  (1) a brand brief (name, industry, tagline, values),
  (2) a pool of candidate sections, already graded by role, mood, palette, signature,
      drawn from a library of award-winning sites.

Your job is to compose a coherent website by picking ONE section per canonical role
from the pool. You output a STRICT JSON plan.

Rules:
- NEVER mention source site names (e.g. "mersi", "icomat", "raviklaassens") in your
  "reason" or "coherence_notes". Talk about mood, layout, rhythm — not brands.
- Pick the smallest set of sections that tells the brand story. Standard order:
  navbar, hero, about, works OR services, cta, footer. Add testimonials/pricing/
  features only if the brand explicitly calls for them.
- Choose ONE site as palette_reference, ONE as typo_reference, ONE as rhythm_reference
  (they can be the same; they must be among the ids present in the pool).
- "coherence_notes" : ONE paragraph explaining WHY this composition holds together,
  written as a senior designer would — not a sales pitch.

Output ONLY a JSON object matching the schema described in the user prompt. No markdown.`;

/**
 * Formats a candidate pool into a compact, LLM-readable block. Each candidate
 * gets one line.
 */
export function formatCandidates(hitsByRole: Record<string, AtlasHit[]>): string {
  const out: string[] = [];
  for (const role of Object.keys(hitsByRole)) {
    const hits = hitsByRole[role];
    if (!hits || hits.length === 0) continue;
    out.push(`## role: ${role}`);
    for (const h of hits) {
      const f = h.entry.fiche;
      out.push(
        `- id=${h.entry.id}  mood=[${f.mood.join(',')}]  layout=${f.layout.composition}/${f.layout.density}  palette=[${f.palette_dominant.slice(0, 3).join(',')}]  signature="${f.signature}"`,
      );
    }
    out.push('');
  }
  return out.join('\n');
}

export function buildPlanningPrompt(brief: unknown, candidatesBlock: string): string {
  const briefJson = JSON.stringify(brief, null, 2);
  return `Brand brief:
\`\`\`json
${briefJson}
\`\`\`

Candidate pool (top-K per role, graded by semantic distance to the brief):
${candidatesBlock}

Compose a plan as a JSON object matching this TypeScript interface:

interface Plan {
  brand: string;
  sections: Array<{ role: string; source: string; reason: string }>;
  design_constraints: {
    palette_reference: string;
    typo_reference: string;
    rhythm_reference: string;
  };
  coherence_notes: string;
}

\`source\` must be one of the ids shown above (format site#role). Each \`reason\` is
2-3 sentences about mood/layout/pacing — NEVER mention the source brand name.

Return ONLY the JSON.`;
}

export function buildRetryPrompt(previous: string, err: string): string {
  return `Your previous plan failed validation:
${err}

Previous output (truncated):
\`\`\`
${previous.substring(0, 2000)}
\`\`\`

Fix the issue and return ONLY a valid JSON plan.`;
}

export function parsePlanJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.substring(first, last + 1);
  return JSON.parse(s);
}
