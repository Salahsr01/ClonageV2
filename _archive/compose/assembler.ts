import * as crypto from 'crypto';
import { load } from 'cheerio';

export interface ScriptEntry {
  src?: string;
  content?: string;
  attrs?: Record<string, string>;
  inBody?: boolean;
}

export interface LinkEntry {
  attrs: Record<string, string>;
}

export interface MetaEntry {
  attrs: Record<string, string>;
}

export interface AssembleOptions {
  title: string;
  lang: string;
  bodySections: Array<{ role: string; bodyHtml: string; site?: string }>;
  styles: string[];
  scripts?: ScriptEntry[];
  links?: LinkEntry[];
  metas?: MetaEntry[];
  extraHeadHtml?: string;
  googleFonts?: string[];
}

export interface HeadMaterial {
  bodyHtml: string;
  styles: string[];
  scripts: ScriptEntry[];
  links: LinkEntry[];
  metas: MetaEntry[];
  titleText?: string;
}

/**
 * Parse a section's full HTML into its reusable head + body parts.
 * Used by the compose orchestrator to strip per-section <head> material
 * into deduped top-level arrays before calling assembleHtml.
 */
export function extractHeadMaterial(fullHtml: string): HeadMaterial {
  const $ = load(fullHtml);
  const styles: string[] = [];
  const scripts: ScriptEntry[] = [];
  const links: LinkEntry[] = [];
  const metas: MetaEntry[] = [];

  $('head style').each((_, el: any) => {
    const text = $(el).html();
    if (text) styles.push(text);
  });
  $('head script').each((_, el: any) => {
    scripts.push(readScript($, el, false));
  });
  $('body script').each((_, el: any) => {
    scripts.push(readScript($, el, true));
  });
  $('head link').each((_, el: any) => {
    const attrs = { ...(el.attribs || {}) };
    if (Object.keys(attrs).length) links.push({ attrs });
  });
  $('head meta').each((_, el: any) => {
    const attrs = { ...(el.attribs || {}) };
    if (!attrs.charset && !attrs.name && !attrs.property && !attrs['http-equiv']) return;
    metas.push({ attrs });
  });

  // Body: also remove <script> so assembler can emit them separately
  $('body script').remove();
  const body = $('body').first();
  const bodyHtml = body.length ? body.html() || '' : $.html();
  const title = $('head title').first().text() || undefined;

  return { bodyHtml, styles, scripts, links, metas, titleText: title };
}

function readScript($: any, el: any, inBody: boolean): ScriptEntry {
  const attrs = { ...(el.attribs || {}) };
  const src = attrs.src;
  delete attrs.src;
  const content = $(el).html() || undefined;
  return { src, content: content || undefined, attrs, inBody };
}

function hashString(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function dedupStyles(styles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of styles) {
    const key = hashString(s.trim());
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function dedupScripts(scripts: ScriptEntry[]): ScriptEntry[] {
  const seen = new Set<string>();
  const out: ScriptEntry[] = [];
  for (const s of scripts) {
    const key = s.src ? `src:${s.src}` : `inline:${hashString(s.content || '')}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}

function dedupLinks(links: LinkEntry[]): LinkEntry[] {
  const seen = new Set<string>();
  const out: LinkEntry[] = [];
  for (const l of links) {
    const key = `${l.attrs.rel || ''}|${l.attrs.href || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(l);
    }
  }
  return out;
}

function dedupMetas(metas: MetaEntry[]): MetaEntry[] {
  const seen = new Set<string>();
  const out: MetaEntry[] = [];
  for (const m of metas) {
    const key = m.attrs.name
      ? `name:${m.attrs.name}`
      : m.attrs.property
        ? `prop:${m.attrs.property}`
        : m.attrs['http-equiv']
          ? `eq:${m.attrs['http-equiv']}`
          : m.attrs.charset
            ? 'charset'
            : Math.random().toString();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

function renderAttrs(attrs: Record<string, string>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (v === '') parts.push(k);
    else parts.push(`${k}="${escapeAttr(v)}"`);
  }
  return parts.join(' ');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderScript(s: ScriptEntry): string {
  const attrs = renderAttrs(s.attrs || {});
  if (s.src) {
    return `<script src="${escapeAttr(s.src)}"${attrs ? ' ' + attrs : ''}></script>`;
  }
  return `<script${attrs ? ' ' + attrs : ''}>${s.content || ''}</script>`;
}

function renderLink(l: LinkEntry): string {
  return `<link ${renderAttrs(l.attrs)}>`;
}

function renderMeta(m: MetaEntry): string {
  return `<meta ${renderAttrs(m.attrs)}>`;
}

function renderGoogleFontsLinks(fonts?: string[]): string {
  if (!fonts || fonts.length === 0) return '';
  const families = fonts
    .map((f) => encodeURIComponent(f.trim()).replace(/%20/g, '+'))
    .join('|');
  return [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=${families}&display=swap">`,
  ].join('\n');
}

export function assembleHtml(opts: AssembleOptions): string {
  const styles = dedupStyles(opts.styles || []);
  const scripts = dedupScripts(opts.scripts || []);
  const links = dedupLinks(opts.links || []);
  const metas = dedupMetas(opts.metas || []);

  const headMetas = metas
    .filter((m) => !m.attrs.name || m.attrs.name.toLowerCase() !== 'viewport')
    .map(renderMeta)
    .join('\n');
  const headLinks = links.map(renderLink).join('\n');
  const styleBlock = styles.length ? `<style>\n${styles.join('\n')}\n</style>` : '';
  const headScripts = scripts
    .filter((s) => !s.inBody)
    .map(renderScript)
    .join('\n');
  const bodyScripts = scripts
    .filter((s) => s.inBody)
    .map(renderScript)
    .join('\n');

  const bodies = opts.bodySections
    .map(
      (s) =>
        `<!-- compose:${s.role}${s.site ? ` src=${s.site}` : ''} -->\n${s.bodyHtml}\n<!-- /compose:${s.role} -->`,
    )
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
${headMetas}
${headLinks}
${renderGoogleFontsLinks(opts.googleFonts)}
${opts.extraHeadHtml || ''}
${styleBlock}
${headScripts}
</head>
<body>
${bodies}
${bodyScripts}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
