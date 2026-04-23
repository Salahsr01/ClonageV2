import * as cheerio from 'cheerio';
import { z } from 'zod';
import type { TextLLM } from '../planning/llm.js';

/**
 * Rewrite the visible text nodes of a section HTML to match a brand brief.
 *
 * This is the TEXT-ONLY pass required by REFACTOR_BRIEF §4.5: zero structural
 * change. Only `#text` content inside the body is touched. Scripts, styles,
 * attributes, and classes are untouched.
 *
 * Strategy:
 *   1. Walk the DOM, collect non-whitespace text nodes, index them by id.
 *   2. Send the LLM a compact "copy block list" + the brief.
 *   3. LLM returns a `{ "<id>": "<new text>", ... }` map.
 *   4. Swap each text node with the matching output (or leave original if no match).
 */

const RewriteMapSchema = z.record(z.string(), z.string());

export interface CopyBlock {
  id: string;
  original: string;
}

export interface ExtractedCopy {
  blocks: CopyBlock[];
  /** Array of cheerio nodes keyed by id for re-injection. */
  nodesById: Record<string, any>;
  /** The cheerio doc itself — callers re-serialize after applyRewrites. */
  $: cheerio.CheerioAPI;
}

export function extractCopyBlocks(html: string, maxBlocks = 80): ExtractedCopy {
  const $ = cheerio.load(html, { xml: false });
  const blocks: CopyBlock[] = [];
  const nodesById: Record<string, any> = {};
  let counter = 0;

  const isSkipTag = (tag: string): boolean =>
    tag === 'script' ||
    tag === 'style' ||
    tag === 'noscript' ||
    tag === 'template' ||
    tag === 'code' ||
    tag === 'pre';

  const walk = (node: any, parentTag: string): void => {
    if (!node) return;
    if (node.type === 'text') {
      const text = (node.data || '').trim();
      if (!text) return;
      if (blocks.length >= maxBlocks) return;
      const id = `c${counter++}`;
      blocks.push({ id, original: text });
      nodesById[id] = node;
      return;
    }
    const tag = (node.name || '').toLowerCase();
    if (node.type === 'tag' && isSkipTag(tag)) return;
    if (node.type === 'script' || node.type === 'style') return;
    const children = node.children || [];
    for (const c of children) walk(c, tag || parentTag);
  };

  const body = $('body')[0];
  const root: any = body ?? $.root()[0];
  for (const c of root.children) walk(c, '');

  return { blocks, nodesById, $ };
}

/**
 * Apply the rewrites by mutating the DOM text nodes in place. Returns the
 * count of successful substitutions.
 */
export function applyRewrites(extracted: ExtractedCopy, rewrites: Record<string, string>): number {
  let applied = 0;
  for (const [id, newText] of Object.entries(rewrites)) {
    const node = extracted.nodesById[id];
    if (!node) continue;
    if (typeof newText !== 'string' || !newText.trim()) continue;
    // Preserve leading/trailing whitespace of the original text node.
    const original: string = node.data || '';
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    node.data = `${leading}${newText.trim()}${trailing}`;
    applied++;
  }
  return applied;
}

export interface TextDiffInput {
  html: string;
  brief: Record<string, unknown>;
  sectionRole: string;
  llm: TextLLM;
  sector?: string;
  maxRetries?: number;
  maxBlocks?: number;
}

const SYSTEM_PROMPT = `You rewrite the copy of one section of a website to match a new brand brief.
You NEVER touch HTML, CSS, scripts, or image URLs. You only produce a JSON map.
The map has ONE entry per copy block given in the input — key = block id, value = the rewritten text in the brand's language and tone.
Keep the same approximate length for each block (± 30%). Keep the same type of content (button label stays a button label, heading stays a heading).
Return STRICT JSON only — no markdown fences, no commentary.`;

function buildPrompt(blocks: CopyBlock[], brief: unknown, sectionRole: string, sector?: string): string {
  const briefJson = JSON.stringify(brief, null, 2);
  const blocksText = blocks.map((b) => `${b.id}: ${JSON.stringify(b.original)}`).join('\n');
  return `Brand brief:
\`\`\`json
${briefJson}
\`\`\`

${sector ? `Sector context: ${sector}\n` : ''}Section role: ${sectionRole}

Copy blocks to rewrite (one per line: "<id>: <original>"):
${blocksText}

Return a JSON object of shape:
{ "${blocks[0]?.id ?? 'c0'}": "new text", "${blocks[1]?.id ?? 'c1'}": "new text", ... }

Return ONLY the JSON.`;
}

function parseRewriteMap(text: string): Record<string, string> {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  }
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.substring(first, last + 1);
  return RewriteMapSchema.parse(JSON.parse(s));
}

export async function textDiff(input: TextDiffInput): Promise<{ html: string; applied: number; blocks: number }> {
  const { html, brief, sectionRole, llm, sector, maxRetries = 2, maxBlocks = 80 } = input;
  const extracted = extractCopyBlocks(html, maxBlocks);
  if (extracted.blocks.length === 0) {
    return { html, applied: 0, blocks: 0 };
  }

  let applied = 0;
  let lastErr = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const userPrompt = buildPrompt(extracted.blocks, brief, sectionRole, sector);
      const raw = await llm.complete({ systemPrompt: SYSTEM_PROMPT, userPrompt, maxTokens: 4000 });
      const rewrites = parseRewriteMap(raw);
      applied = applyRewrites(extracted, rewrites);
      return { html: extracted.$.html(), applied, blocks: extracted.blocks.length };
    } catch (err: any) {
      lastErr = err?.message || String(err);
      if (attempt === maxRetries) {
        throw new Error(`text-diff failed after ${maxRetries + 1} attempts: ${lastErr}`);
      }
    }
  }

  return { html: extracted.$.html(), applied, blocks: extracted.blocks.length };
}
