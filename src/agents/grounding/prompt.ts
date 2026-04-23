import type { GroundFiche } from './schema.js';

export const SYSTEM_PROMPT = `You are an expert visual designer and code reader. You analyse a single section of a web page and produce a structured JSON description of what makes the section distinctive.

You will receive:
1. A screenshot of the section.
2. A simplified DOM representation (tags + classes only, no text).

You will produce ONLY a JSON object matching the schema described in the user prompt. No markdown fences, no commentary. Pure JSON.

Constraints:
- "role" must be one of: navbar, hero, about, works, services, cta, contact, footer, testimonials, pricing, features, gallery, stats, team, faq, logo-wall, other. If unsure, pick "other".
- "mood" is an array of 1-4 adjectives (English). Examples: moody, editorial, brutalist, minimal, playful, elegant, tech, warm, cold, monochrome, high-contrast.
- "animations": one entry per visible animation behavior. If none, return [{ "type": "none", "library": "none" }].
- "palette_dominant": 2-6 dominant colors as hex strings (e.g. "#0a1628"). Infer from the screenshot.
- "typo.display" / "typo.body": family names you can infer. If unknown, use "unknown".
- "layout.composition": one of fullscreen, split, masonry, centered, asymmetric, stacked, grid, hero-copy, other.
- "layout.density": one of tight, airy, spacious.
- "signature": ONE short sentence in French describing what the section does that is specific. Max 280 chars.
- "usable_as": roles this section layout could fill in another site. Subset of the role enum.

Return STRICT JSON only.`;

export function buildUserPrompt(role: string, simplifiedDOM: string): string {
  return `Analyze the attached section screenshot.

The section was detected by a static classifier with the tentative role "${role}". Verify or correct it.

Simplified DOM (structure only, text removed):
\`\`\`
${simplifiedDOM}
\`\`\`

Return a JSON object matching this TypeScript interface:

interface GroundFiche {
  role: string;
  mood: string[];
  animations: { type: string; library: string }[];
  palette_dominant: string[];
  typo: { display: string; body: string; axes: string[] };
  layout: { composition: string; density: string };
  signature: string;
  usable_as: string[];
}

Return ONLY the JSON. No markdown fences. No commentary.`;
}

/**
 * When validation fails, build a retry prompt that includes the error
 * feedback so the LLM can correct itself. Called from the orchestrator.
 */
export function buildRetryPrompt(
  previousResponse: string,
  validationError: string,
): string {
  return `Your previous response failed validation:

${validationError}

Your previous output was:
\`\`\`
${previousResponse.substring(0, 2000)}
\`\`\`

Please output a corrected JSON object that matches the schema. Return ONLY the JSON.`;
}

/**
 * Very defensive JSON parser. The LLM sometimes wraps output in \`\`\`json fences
 * despite instructions; strip them and try to parse.
 */
export function parseLLMJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  // Sometimes leading/trailing prose — grab the first {...} balanced span.
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    s = s.substring(firstBrace, lastBrace + 1);
  }
  return JSON.parse(s);
}

/**
 * Sample fiche factory used by tests. Returns a deterministic GroundFiche
 * matching the schema, parameterised by role so each section looks different.
 */
export function sampleFiche(role: string): GroundFiche {
  return {
    role,
    mood: role === 'hero' ? ['moody', 'editorial'] : ['minimal', 'elegant'],
    animations: [{ type: 'fade-in', library: 'gsap' }],
    palette_dominant: ['#0a1628', '#e5c07b', '#ffffff'],
    typo: { display: 'Inter', body: 'Inter', axes: ['wght'] },
    layout: { composition: 'centered', density: 'airy' },
    signature: `Section ${role} minimaliste, typographie sobre, image hero centrée.`,
    usable_as: [role],
  };
}
