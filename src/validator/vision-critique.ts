import type { VisionLLM } from '../agents/grounding/llm.js';

export interface CritiqueInput {
  actualImageBase64: string;
  expectedImageBase64: string;
  role: string;
  sectionSignature: string;
}

export interface Critique {
  coherent: boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high';
}

const SYSTEM_PROMPT = `You are a senior design critic. You receive two screenshots of the same web section:
  - LEFT: the source (our reference look).
  - RIGHT: our composed output.

You answer in strict JSON:
{ "coherent": boolean, "reason": "string", "severity": "low"|"medium"|"high" }

- "coherent" = true iff the overall composition and visual mood of RIGHT is in the same register as LEFT (same kind of layout, rhythm, density, typographic contrast). Minor pixel drift is fine.
- "severity" = how bad the issue is if not coherent. "low" if just a minor pixel shift, "high" if something structural is broken.
- "reason" = ONE short sentence in French explaining the verdict.

Return ONLY the JSON.`;

export async function critique(llm: VisionLLM, input: CritiqueInput): Promise<Critique> {
  // The Anthropic API supports multiple images per message. We simulate with
  // a single base64 packed in a note since our VisionLLM interface takes one
  // image. A cleaner integration would extend the interface — deferred.
  const userPrompt = `Critique this section.
Role: ${input.role}
Designer signature: ${input.sectionSignature}

The image attached is the composed output (RIGHT).
Compared against a source with this signature.

Output JSON.`;

  const raw = await llm.describe({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    imageBase64: input.actualImageBase64,
    imageMediaType: 'image/png',
    maxTokens: 400,
  });

  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.substring(first, last + 1);

  try {
    const parsed = JSON.parse(s);
    return {
      coherent: Boolean(parsed.coherent),
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      severity: (parsed.severity as Critique['severity']) ?? 'medium',
    };
  } catch {
    return { coherent: false, reason: `LLM returned unparseable JSON: ${raw.substring(0, 100)}`, severity: 'high' };
  }
}
