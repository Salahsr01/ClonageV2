// brief-gen — derive a RebrandHarBrief from a recorded clone + a target description.
//
// Uses a VisionLLM (same interface as agents/grounding/llm.ts) so the caller
// can inject a FakeVisionLLM in tests.

import * as fs from 'fs';
import * as path from 'path';

import type { VisionLLM } from '../agents/grounding/llm.js';
import { loadDefaultVisionLLM } from '../agents/grounding/llm.js';
import { RebrandHarBriefSchema, type RebrandHarBrief } from '../rebrand-har/index.js';
import { extractFromHar, type ExtractedSignals } from './extract.js';
import { SYSTEM_PROMPT, buildUserPrompt, parseBriefJson } from './prompt.js';

export type { ExtractedSignals } from './extract.js';
export { extractFromHar } from './extract.js';

export interface BriefGenInput {
  /** Clone directory from `clonage record` (must contain recording.har). */
  cloneDir: string;
  /** Target brief description (language of the new brand + what they do). */
  targetDescription: string;
  /** LLM impl. If absent, uses ANTHROPIC_API_KEY from env. */
  llm?: VisionLLM;
  /** Path to a screenshot to attach. Defaults to `_screenshots/initial.png` */
  screenshotPath?: string;
  /** Max LLM retries on invalid JSON. Default 2. */
  maxRetries?: number;
}

export interface BriefGenResult {
  brief: RebrandHarBrief;
  signals: ExtractedSignals;
  rawResponse: string;
}

export async function generateBrief(input: BriefGenInput): Promise<BriefGenResult> {
  const { cloneDir, targetDescription, maxRetries = 2 } = input;
  const harPath = path.join(cloneDir, 'recording.har');
  if (!fs.existsSync(harPath)) {
    throw new Error(`brief-gen: recording.har not found at ${harPath}`);
  }

  const signals = extractFromHar(harPath);
  const llm = input.llm ?? loadDefaultVisionLLM();

  const screenshotPath = input.screenshotPath ?? firstScreenshot(cloneDir);
  let imageBase64: string | undefined;
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    imageBase64 = fs.readFileSync(screenshotPath).toString('base64');
  }

  const userPrompt = buildUserPrompt(signals, targetDescription);

  let lastResponse = '';
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt =
      attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nYour previous response failed validation: ${lastError}\n\nReturn corrected JSON only.`;
    try {
      lastResponse = await llm.describe({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: prompt,
        imageBase64,
        imageMediaType: 'image/png',
        maxTokens: 2000,
      });
      const parsed = parseBriefJson(lastResponse);
      const brief = RebrandHarBriefSchema.parse(parsed);
      return { brief, signals, rawResponse: lastResponse };
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (attempt === maxRetries) {
        throw new Error(`brief-gen failed after ${maxRetries + 1} attempts: ${lastError}`);
      }
    }
  }
  throw new Error('brief-gen: unreachable');
}

function firstScreenshot(cloneDir: string): string | null {
  const screenshotsDir = path.join(cloneDir, '_screenshots');
  if (fs.existsSync(screenshotsDir)) {
    const files = fs.readdirSync(screenshotsDir).filter((f) => f.endsWith('.png'));
    if (files.length > 0) return path.join(screenshotsDir, files[0]);
  }
  const altDir = path.join(cloneDir, 'screenshots');
  if (fs.existsSync(altDir)) {
    const files = fs.readdirSync(altDir).filter((f) => f.endsWith('.png'));
    if (files.length > 0) return path.join(altDir, files[0]);
  }
  return null;
}

export function writeBrief(brief: RebrandHarBrief, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(brief, null, 2), 'utf-8');
}
