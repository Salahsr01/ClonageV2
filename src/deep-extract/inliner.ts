import * as fs from 'fs';
import * as path from 'path';
import type { Cheerio } from 'cheerio';

const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const MAX_INLINE_BYTES = 15 * 1024;

function mimeFromPath(p: string): string {
  const dot = p.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_BY_EXT[p.slice(dot).toLowerCase()] || 'application/octet-stream';
}

function collectClassAndTagTokens(section: Cheerio<any>): Set<string> {
  const tokens = new Set<string>();
  const rootNode: any = section.get(0);
  const visit = (node: any) => {
    if (!node) return;
    const tag = (node.tagName || '').toLowerCase();
    if (tag) tokens.add(tag);
    const cls = node.attribs?.class;
    if (cls) {
      for (const c of String(cls).split(/\s+/)) if (c) tokens.add(c);
    }
    const children = node.children || [];
    for (const child of children) visit(child);
  };
  visit(rootNode);
  return tokens;
}

function splitCssRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        rules.push(css.slice(start, i + 1));
        start = i + 1;
      }
    }
  }
  return rules.map((r) => r.trim()).filter(Boolean);
}

function ruleSelectorMatchesTokens(rule: string, tokens: Set<string>): boolean {
  const braceIdx = rule.indexOf('{');
  if (braceIdx < 0) return false;
  const selector = rule.slice(0, braceIdx).toLowerCase();

  if (selector.startsWith('@')) return false;
  if (selector.includes(':root') || /^\s*(html|body)\s*[,{]/.test(selector + '{')) return true;

  const parts = selector.split(',').map((p) => p.trim());
  for (const part of parts) {
    const classMatches = part.match(/\.([a-z0-9_-]+)/gi) || [];
    for (const cm of classMatches) {
      if (tokens.has(cm.slice(1))) return true;
    }
    const tagMatches = part.match(/(^|[\s>+~])([a-z][a-z0-9-]*)/gi) || [];
    for (const tm of tagMatches) {
      const tag = tm.trim().replace(/^[>+~]/, '').trim();
      if (tag && tokens.has(tag.toLowerCase())) return true;
    }
  }
  return false;
}

function filterCss(css: string, tokens: Set<string>): string {
  const rules = splitCssRules(css);
  const kept: string[] = [];
  for (const rule of rules) {
    const trimmed = rule.trim();
    if (trimmed.startsWith('@font-face') || trimmed.startsWith('@keyframes')) {
      kept.push(rule);
      continue;
    }
    if (trimmed.startsWith('@media') || trimmed.startsWith('@supports')) {
      kept.push(rule);
      continue;
    }
    const selector = trimmed.slice(0, trimmed.indexOf('{')).trim().toLowerCase();
    if (selector === ':root' || selector.includes(':root')) {
      kept.push(rule);
      continue;
    }
    if (/^(html|body)\s*[,{]/.test(selector + '{')) {
      kept.push(rule);
      continue;
    }
    if (ruleSelectorMatchesTokens(rule, tokens)) {
      kept.push(rule);
    }
  }
  return kept.join('\n');
}

function inlineImagesInHtml(html: string, cloneDir: string): string {
  return html.replace(/(<img[^>]*\bsrc=["'])(\.?\/?[^"']+)(["'])/gi, (full, prefix, src, suffix) => {
    if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('//')) return full;
    const rel = src.replace(/^\.\//, '');
    const abs = path.resolve(cloneDir, rel);
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_INLINE_BYTES) return full;
      const buf = fs.readFileSync(abs);
      const mime = mimeFromPath(abs);
      return `${prefix}data:${mime};base64,${buf.toString('base64')}${suffix}`;
    } catch {
      return full;
    }
  });
}

export function inlineSection(
  section: Cheerio<any>,
  fullCss: string,
  cloneDir: string,
): string {
  const tokens = collectClassAndTagTokens(section);
  const filteredCss = filterCss(fullCss, tokens);
  const rawHtml = String(section.toString() || '');
  const withImages = inlineImagesInHtml(rawHtml, cloneDir);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
${filteredCss}
</style>
</head>
<body>
${withImages}
</body>
</html>`;
}
