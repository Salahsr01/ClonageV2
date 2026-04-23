// Agent ① — Grounding (REFACTOR_BRIEF.md §4.2)

import * as fs from 'fs';
import * as path from 'path';

import { LLMError } from '../../utils/llm.js';
import { simplifyDOM } from './dom-simplify.js';
import type { VisionLLM } from './llm.js';
import { loadDefaultVisionLLM } from './llm.js';
import { SYSTEM_PROMPT, buildUserPrompt, buildRetryPrompt, parseLLMJson } from './prompt.js';
import type { GroundFiche, GroundSidecar } from './schema.js';
import { GroundFicheSchema } from './schema.js';
import {
  hashSection,
  groundSidecarPath,
  readCachedSidecar,
  writeSidecar,
} from './cache.js';

export interface GroundingInput {
  /** A KB entry directory — typically `.clonage-kb/sections/<site>/`. */
  kbSectionDir: string;
  /** Site identifier written into each sidecar. */
  site: string;
  /** Override the LLM (tests inject FakeVisionLLM). If absent, uses env key. */
  llm?: VisionLLM;
  /** If true, ignore cached sidecars and re-ground everything. */
  force?: boolean;
  /** Max retries per section when JSON validation fails. Defaults to 2. */
  maxRetries?: number;
}

export interface GroundingResult {
  sections: Array<{
    role: string;
    htmlPath: string;
    sidecarPath: string;
    cached: boolean;
    fiche: GroundFiche;
  }>;
}

export async function ground(input: GroundingInput): Promise<GroundingResult> {
  const { kbSectionDir, site, force = false, maxRetries = 2 } = input;
  if (!fs.existsSync(kbSectionDir)) {
    throw new Error(`kbSectionDir does not exist: ${kbSectionDir}`);
  }

  const llm: VisionLLM = input.llm ?? loadDefaultVisionLLM();

  // Discover sections: every <role>.html in the KB section dir.
  const files = fs
    .readdirSync(kbSectionDir)
    .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
    .map((f) => path.join(kbSectionDir, f));

  const sections: GroundingResult['sections'] = [];
  for (const htmlPath of files) {
    const role = path.basename(htmlPath, '.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const screenshotPath = path.join(kbSectionDir, `${role}.png`);
    const hasScreenshot = fs.existsSync(screenshotPath);
    const hash = hashSection(html, hasScreenshot ? screenshotPath : undefined);

    const sidecarPath = groundSidecarPath(htmlPath);

    if (!force) {
      const cached = readCachedSidecar(sidecarPath);
      if (cached && cached.source_hash === hash) {
        sections.push({
          role: cached.fiche.role,
          htmlPath,
          sidecarPath,
          cached: true,
          fiche: cached.fiche,
        });
        continue;
      }
    }

    const fiche = await groundOneSection({
      role,
      html,
      screenshotPath: hasScreenshot ? screenshotPath : undefined,
      llm,
      maxRetries,
    });

    const sidecar: GroundSidecar = {
      site,
      role: fiche.role,
      source_hash: hash,
      grounded_at: new Date().toISOString(),
      fiche,
    };
    writeSidecar(sidecarPath, sidecar);

    sections.push({ role: fiche.role, htmlPath, sidecarPath, cached: false, fiche });
  }

  return { sections };
}

async function groundOneSection(params: {
  role: string;
  html: string;
  screenshotPath?: string;
  llm: VisionLLM;
  maxRetries: number;
}): Promise<GroundFiche> {
  const { role, html, screenshotPath, llm, maxRetries } = params;
  const simplified = simplifyDOM(html);

  let imageBase64: string | undefined;
  if (screenshotPath) {
    imageBase64 = fs.readFileSync(screenshotPath).toString('base64');
  }

  let lastResponse = '';
  let lastError = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const userPrompt =
      attempt === 0
        ? buildUserPrompt(role, simplified)
        : buildRetryPrompt(lastResponse, lastError);
    try {
      const raw = await llm.describe({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        imageBase64,
        imageMediaType: 'image/png',
        maxTokens: 2000,
      });
      lastResponse = raw;
      const parsed = parseLLMJson(raw);
      const fiche = GroundFicheSchema.parse(parsed);
      return fiche;
    } catch (err: any) {
      lastError = err?.message || String(err);
      if (err instanceof LLMError) {
        // LLM provider errors can't be fixed by re-prompting — bail.
        throw err;
      }
      if (attempt === maxRetries) {
        throw new Error(
          `grounding failed for role="${role}" after ${maxRetries + 1} attempts: ${lastError}`,
        );
      }
    }
  }

  // Unreachable — the loop always returns or throws.
  throw new Error('grounding: unexpected loop exit');
}
