import type { ExtractedSignals } from './extract.js';

export const SYSTEM_PROMPT = `You are an art director drafting a rebrand plan.

You receive :
  (1) A screenshot of a live website.
  (2) A list of visible text strings captured from the site's HTML (already deduped).
  (3) The site's dominant colour tokens (hex + rgb).
  (4) A short brief describing the NEW brand we want the site to carry.

You MUST output a JSON object with shape :

{
  "brand": { "source_name": string, "name": string },
  "copy":  [ { "from": string, "to": string }, ... ]
}

Rules :
  - "source_name" is the OLD brand as typed on the site (match the casing).
  - "name" is the NEW brand.
  - "copy" must pick every text where the old brand positioning appears
    (tagline, industry label, contact city, main pitch sentence) and rewrite
    it for the new brief. Keep original spelling EXACTLY in "from" (casing
    matters — the downstream rebrander does a byte-level string swap).
  - Also include the 3-5 most impactful colour tokens as "copy" entries
    (from="#hex", to="#hex"). Remap palette to fit the new brand mood.
  - DO NOT invent strings that do not appear in the source list. DO NOT
    translate text unless the new brief explicitly asks for a different
    language.
  - NEVER add a field other than "brand" and "copy". Return STRICT JSON,
    no markdown fences.`;

export function buildUserPrompt(signals: ExtractedSignals, targetDescription: string): string {
  const textsBlock = signals.texts.map((t) => `  - ${JSON.stringify(t)}`).join('\n');
  const hexBlock = signals.colors.hex.join(' ');
  const rgbBlock = signals.colors.rgb.join(' ; ');
  return `## Source brand guess
${signals.brandGuess ?? '(unknown — infer from texts)'}

## Source visible texts (top ${signals.texts.length})
${textsBlock || '  (none)'}

## Source colour tokens
hex: ${hexBlock}
rgb: ${rgbBlock}

## Target brief
${targetDescription}

Return the JSON brief now.`;
}

export function parseBriefJson(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.substring(i, j + 1);
  return JSON.parse(s);
}
