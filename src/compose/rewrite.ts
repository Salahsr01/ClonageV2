import * as cheerio from 'cheerio';
import type { ComposeBrief, LoadedSection, RewrittenSection } from './types.js';
import { logger } from '../utils/logger.js';
import { buildTextDiffPrompt } from './prompt.js';

export type RawLLMCall = (prompt: string, section: LoadedSection) => Promise<string>;

function unwrapFenced(text: string): string {
  const fenced = text.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
  const fencedJson = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  if (fencedJson) return fencedJson[1].trim();
  return text.trim();
}

interface ExtractedTextNode {
  id: number;
  text: string;
  node: any;
}

interface ParsedReplacement {
  id: number;
  newText: string;
}

export function extractBodyContent(html: string): string {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) return bodyMatch[1].trim();
  const afterHead = html.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '');
  if (afterHead !== html) return afterHead.trim();
  return html.trim();
}

export function extractHeadStyle(html: string): string {
  const styleMatches = html.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
  if (!styleMatches) return '';
  return styleMatches.join('\n');
}

function shouldSkipNode(node: any): boolean {
  const parentName = node.parent?.name?.toLowerCase();
  if (!parentName) return false;
  return parentName === 'script' || parentName === 'style' || parentName === 'noscript' || parentName === 'template';
}

function extractTextNodes($: cheerio.CheerioAPI): ExtractedTextNode[] {
  const nodes: ExtractedTextNode[] = [];
  let id = 0;

  $('body')
    .find('*')
    .contents()
    .each((_idx, node) => {
      if (node.type !== 'text' || shouldSkipNode(node)) return;
      const value = (node.data || '').replace(/\s+/g, ' ').trim();
      if (!value) return;
      nodes.push({
        id,
        text: value,
        node,
      });
      id += 1;
    });

  return nodes;
}

function safeParseReplacements(raw: string): ParsedReplacement[] {
  if (!raw) return [];
  const unwrapped = unwrapFenced(raw);
  try {
    const parsed = JSON.parse(unwrapped);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && Number.isInteger(item.id) && typeof item.newText === 'string')
      .map((item) => ({ id: Number(item.id), newText: item.newText.trim() }))
      .filter((item) => item.newText.length > 0);
  } catch {
    return [];
  }
}

function countDomNodes(html: string): number {
  const $ = cheerio.load(html);
  return $('*').length;
}

function countScripts(html: string): number {
  const $ = cheerio.load(html);
  return $('script').length;
}

export async function rewriteSection(
  section: LoadedSection,
  brief: ComposeBrief,
  sourceSite: string,
  llm: RawLLMCall,
  sector?: string,
): Promise<RewrittenSection> {
  const originalNodeCount = countDomNodes(section.html);
  const originalScriptCount = countScripts(section.html);

  let usedLLM = false;
  let finalHtml = section.html;

  try {
    const $ = cheerio.load(section.html);
    const textNodes = extractTextNodes($);

    if (textNodes.length > 0) {
      const prompt = buildTextDiffPrompt({
        brief,
        sectionRole: section.meta.role,
        sourceSite,
        sector,
        texts: textNodes.map((t) => ({ id: t.id, text: t.text })),
      });

      const raw = await llm(prompt, section);
      const replacements = safeParseReplacements(raw);

      if (replacements.length > 0) {
        const replacementMap = new Map<number, string>();
        for (const rep of replacements) {
          replacementMap.set(rep.id, rep.newText);
        }

        let applied = 0;
        for (const textNode of textNodes) {
          const next = replacementMap.get(textNode.id);
          if (!next || next === textNode.text) continue;
          textNode.node.data = next;
          applied += 1;
        }

        if (applied > 0) {
          finalHtml = $.html();
          if (/<!doctype html>/i.test(section.html) && !/^<!doctype html>/i.test(finalHtml.trim())) {
            finalHtml = `<!DOCTYPE html>\n${finalHtml}`;
          }
          usedLLM = true;
        }
      }
    }
  } catch (err: any) {
    logger.warn(`LLM rewrite failed for section "${section.meta.role}": ${err?.message || String(err)}`);
    finalHtml = section.html;
    usedLLM = false;
  }

  const outputNodeCount = countDomNodes(finalHtml);
  const outputScriptCount = countScripts(finalHtml);
  const nodeRatio = originalNodeCount > 0 ? outputNodeCount / originalNodeCount : 1;

  if (nodeRatio < 0.9 || outputScriptCount < originalScriptCount) {
    logger.warn(
      `Validation failed for section "${section.meta.role}" (nodeRatio=${nodeRatio.toFixed(2)}, scripts ${outputScriptCount}/${originalScriptCount}). Keeping original section.`,
    );
    finalHtml = section.html;
    usedLLM = false;
  }

  const bodyHtml = extractBodyContent(finalHtml);

  return {
    role: section.meta.role,
    originalSize: section.html.length,
    rewrittenSize: bodyHtml.length,
    usedLLM,
    bodyHtml,
  };
}
