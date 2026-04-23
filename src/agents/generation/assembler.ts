import * as cheerio from 'cheerio';
import * as crypto from 'crypto';

/**
 * Assemble multiple section HTMLs into one page. Contract (§4.5):
 *  - HTML of each section comes from a real file. Scripts and animations
 *    are preserved by construction.
 *  - No LLM touches HTML structure here.
 *  - If two sections share a CSS class name, prefix with a per-section hash.
 *
 * Strategy:
 *  1. For each section, parse with cheerio.
 *  2. Collect <head> children, dedupe by content hash.
 *  3. Detect CSS class collisions across sections. If a class appears in
 *     multiple sections, prefix it with `.s-<hash>-` in both the <style>
 *     content and the section body.
 *  4. Concatenate <body> children in order.
 */

export interface AssemblyInput {
  sections: Array<{
    role: string;
    site: string;
    html: string;
  }>;
  /** Document <title>. Defaults to first section's site. */
  title?: string;
  /** If true, also emit the design_constraints as a JSON script tag for debugging. */
  designConstraintsJson?: string;
}

export interface AssemblyResult {
  html: string;
  fingerprints: Array<{
    role: string;
    site: string;
    scripts: number;
    keyframes: number;
    nodes: number;
  }>;
}

function sectionHash(site: string, role: string): string {
  return crypto.createHash('sha1').update(`${site}#${role}`).digest('hex').substring(0, 6);
}

function isDocDuplicate(seen: Set<string>, html: string): boolean {
  const key = crypto.createHash('sha1').update(html).digest('hex');
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

function rewriteClassNamesInCss(css: string, classMap: Record<string, string>): string {
  // Very targeted swap: `.<cls>` → `.<prefixed>`. Safer than a full CSS parse.
  let out = css;
  for (const [from, to] of Object.entries(classMap)) {
    const re = new RegExp(`\\.${escapeForRegex(from)}(?![\\w-])`, 'g');
    out = out.replace(re, `.${to}`);
  }
  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk the section DOM and rename class attributes using classMap. Returns
 * the count of edits for visibility in the fingerprint.
 */
function rewriteClassesInDom($: cheerio.CheerioAPI, classMap: Record<string, string>): number {
  let edits = 0;
  $('[class]').each((_, el) => {
    const cur = $(el).attr('class');
    if (!cur) return;
    const parts = cur.split(/\s+/).filter(Boolean);
    let changed = false;
    const next = parts.map((p) => {
      const mapped = classMap[p];
      if (mapped && mapped !== p) {
        changed = true;
        return mapped;
      }
      return p;
    });
    if (changed) {
      $(el).attr('class', next.join(' '));
      edits++;
    }
  });
  return edits;
}

/**
 * Build the class collision map for a batch of sections. Returns, per section
 * index, a `classMap` that renames its conflicting classes to a unique prefix.
 *
 * Algorithm: first pass counts class occurrences across sections; any class
 * that appears in more than one section is renamed to `s-<hash>-<class>` in
 * every section where it appears (so the CSS and DOM stay in sync).
 */
function buildPrefixMaps(sections: AssemblyInput['sections'], classesPerSection: Array<Set<string>>): Array<Record<string, string>> {
  const classToSections: Record<string, Set<number>> = {};
  classesPerSection.forEach((set, i) => {
    for (const cls of set) {
      classToSections[cls] ??= new Set();
      classToSections[cls].add(i);
    }
  });

  const maps: Array<Record<string, string>> = sections.map(() => ({}));
  for (const [cls, idxs] of Object.entries(classToSections)) {
    if (idxs.size < 2) continue; // no collision
    for (const i of idxs) {
      const hash = sectionHash(sections[i].site, sections[i].role);
      maps[i][cls] = `s-${hash}-${cls}`;
    }
  }
  return maps;
}

function collectClassesFromCss(css: string): Set<string> {
  // naive: grab `.foo` where foo is a class-name-like token
  const out = new Set<string>();
  const re = /\.([A-Za-z_][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

function collectClassesFromDom($: cheerio.CheerioAPI): Set<string> {
  const out = new Set<string>();
  $('[class]').each((_, el) => {
    const cur = $(el).attr('class');
    if (!cur) return;
    for (const p of cur.split(/\s+/).filter(Boolean)) out.add(p);
  });
  return out;
}

function countScripts($: cheerio.CheerioAPI): number {
  return $('script').length;
}

function countKeyframes($: cheerio.CheerioAPI): number {
  let n = 0;
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    const matches = css.match(/@keyframes\s+[\w-]+/g);
    if (matches) n += matches.length;
  });
  return n;
}

function countNodes($: cheerio.CheerioAPI): number {
  return $('*').length;
}

export function assemble(input: AssemblyInput): AssemblyResult {
  // Phase 1: parse each section, collect per-section class sets.
  const parsed = input.sections.map((s) => ({
    section: s,
    $: cheerio.load(s.html, { xml: false }),
  }));
  const classesPerSection = parsed.map((p) => {
    const classes = collectClassesFromDom(p.$);
    p.$('style').each((_, el) => {
      const css = p.$(el).html() || '';
      for (const c of collectClassesFromCss(css)) classes.add(c);
    });
    return classes;
  });

  const classMaps = buildPrefixMaps(input.sections, classesPerSection);

  // Phase 2: apply class prefixing in each section (both style + DOM).
  const fingerprints: AssemblyResult['fingerprints'] = [];
  parsed.forEach((p, i) => {
    const map = classMaps[i];
    if (Object.keys(map).length > 0) {
      rewriteClassesInDom(p.$, map);
      p.$('style').each((_, el) => {
        const css = p.$(el).html() || '';
        p.$(el).text(rewriteClassNamesInCss(css, map));
      });
    }
    fingerprints.push({
      role: p.section.role,
      site: p.section.site,
      scripts: countScripts(p.$),
      keyframes: countKeyframes(p.$),
      nodes: countNodes(p.$),
    });
  });

  // Phase 3: build the combined document.
  const outDoc = cheerio.load(
    '<!DOCTYPE html><html><head></head><body></body></html>',
    { xml: false },
  );
  const $out = outDoc;
  const outHead = $out('head');
  const outBody = $out('body');

  if (input.title) {
    outHead.append(`<title>${escapeHtml(input.title)}</title>`);
  }

  const seenHeadItems = new Set<string>();

  for (const p of parsed) {
    const $$ = p.$;
    // Move <head> children (styles, links, scripts in head, meta) into the combined head.
    $$('head')
      .children()
      .each((_, el) => {
        const serialized = $$.html(el);
        if (!serialized) return;
        if (isDocDuplicate(seenHeadItems, serialized)) return;
        outHead.append(serialized + '\n');
      });
    // Append body children as a section wrapper (role-aware for debugging).
    const bodyEl = $$('body')[0];
    if (bodyEl) {
      const inner = $$(bodyEl).html() || '';
      outBody.append(
        `<!-- section: ${p.section.role} from ${p.section.site} -->\n` +
          inner +
          '\n',
      );
    } else {
      // No <body> — treat the whole doc as body content.
      outBody.append(p.section.html);
    }
  }

  if (input.designConstraintsJson) {
    outHead.append(
      `<script type="application/json" id="__clonage_design_constraints">${input.designConstraintsJson}</script>\n`,
    );
  }

  return { html: outDoc.html() ?? '', fingerprints };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}
