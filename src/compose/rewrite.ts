import type { ComposeBrief, LoadedSection, RewrittenSection } from './types.js';
import { buildSectionPrompt } from './prompt.js';

export type RawLLMCall = (prompt: string, section: LoadedSection) => Promise<string>;

function unwrapFenced(text: string): string {
  const fenced = text.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
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

export async function rewriteSection(
  section: LoadedSection,
  brief: ComposeBrief,
  sourceSite: string,
  llm: RawLLMCall,
  sector?: string,
): Promise<RewrittenSection> {
  const prompt = buildSectionPrompt({
    brief,
    sectionRole: section.meta.role,
    sectionHtml: section.html,
    sourceSite,
    sector,
  });

  let usedLLM = false;
  let finalHtml = section.html;
  try {
    const raw = await llm(prompt, section);
    if (raw && raw.trim().length > 0) {
      const unwrapped = unwrapFenced(raw);
      if (unwrapped.length > 50) {
        finalHtml = unwrapped;
        usedLLM = true;
      }
    }
  } catch {
    // Keep original on LLM error
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
