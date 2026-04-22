import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { findSectionCandidates } from './boundary.js';
import { classify } from './classifier.js';
import { inlineSection } from './inliner.js';
import { writeKB } from './kb-writer.js';
import type {
  DeepExtractOptions,
  DeepExtractResult,
  ExtractedSection,
  KBv2Index,
  SectionRole,
} from './types.js';

const GOOGLE_FONTS = new Set([
  'Inter', 'Roboto', 'Poppins', 'Open Sans', 'Lato', 'Montserrat', 'Oswald',
  'Playfair Display', 'Raleway', 'Nunito', 'Merriweather', 'PT Sans',
]);

function deriveSiteName(cloneDir: string): string {
  return path.basename(path.resolve(cloneDir)).split('_')[0];
}

function resolveCloneFiles(cloneDir: string): { htmlPath: string; cssPath: string | null } {
  const htmlCandidates = ['index.html'];
  let htmlPath: string | null = null;
  for (const name of htmlCandidates) {
    const p = path.join(cloneDir, name);
    if (fs.existsSync(p)) { htmlPath = p; break; }
  }
  if (!htmlPath) throw new Error(`index.html not found in ${cloneDir}`);

  const cssCandidates = ['styles.css', 'style.css', 'main.css'];
  let cssPath: string | null = null;
  for (const name of cssCandidates) {
    const p = path.join(cloneDir, name);
    if (fs.existsSync(p)) { cssPath = p; break; }
  }
  return { htmlPath, cssPath };
}

function extractPalette(css: string): KBv2Index['palette'] {
  const counts = new Map<string, number>();
  const hexRe = /#[0-9a-fA-F]{6}\b/g;
  const rgbRe = /rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)/g;
  for (const re of [hexRe, rgbRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) {
      const c = m[0].toLowerCase();
      counts.set(c, (counts.get(c) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return {
    primary: sorted[0],
    secondary: sorted[1],
    accent: sorted[2],
  };
}

function extractFonts(css: string): KBv2Index['fonts'] {
  const families = new Set<string>();
  const re = /font-family\s*:\s*([^;"}]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const first = m[1].split(',')[0].trim().replace(/['"]/g, '');
    if (first && !first.startsWith('var(') && !/^(sans-serif|serif|monospace|inherit|initial)$/i.test(first)) {
      families.add(first);
    }
  }
  const arr = [...families];
  const out: KBv2Index['fonts'] = {};
  if (arr[0]) out.primary = { family: arr[0], google: GOOGLE_FONTS.has(arr[0]) };
  if (arr[1]) out.display = { family: arr[1], google: GOOGLE_FONTS.has(arr[1]) };
  return out;
}

function inferTags(classList: string[], text: string): string[] {
  const tags: string[] = [];
  const haystack = (classList.join(' ') + ' ' + text).toLowerCase();
  const tagMap: Record<string, string> = {
    minimal: 'minimaliste',
    editorial: 'editorial',
    grid: 'grille',
    bold: 'bold',
    brut: 'brutaliste',
    brutalist: 'brutaliste',
    dark: 'sombre',
    serif: 'typographie-serif',
  };
  for (const k of Object.keys(tagMap)) {
    if (haystack.includes(k)) tags.push(tagMap[k]);
  }
  return tags;
}

export async function deepExtract(opts: DeepExtractOptions): Promise<DeepExtractResult> {
  const { cloneDir, kbRoot, force } = opts;
  const site = deriveSiteName(cloneDir);

  const { htmlPath, cssPath } = resolveCloneFiles(cloneDir);
  const html = fs.readFileSync(htmlPath, 'utf-8');
  const css = cssPath ? fs.readFileSync(cssPath, 'utf-8') : '';

  const $: CheerioAPI = load(html);
  const candidates = findSectionCandidates($);

  const seenRoles = new Map<string, number>();
  const sections: Array<{ role: SectionRole; html: string }> = [];
  const metas: ExtractedSection[] = [];

  candidates.forEach((cand, i) => {
    const baseRole = classify(cand, i, i === 0);
    const prevCount = seenRoles.get(baseRole) || 0;
    seenRoles.set(baseRole, prevCount + 1);
    const role: SectionRole = prevCount === 0 ? baseRole : (`${baseRole}-${prevCount + 1}` as SectionRole);

    const inlined = inlineSection(cand.el, css, cloneDir);
    sections.push({ role, html: inlined });

    const textExcerpt = cand.el.text().trim().replace(/\s+/g, ' ').slice(0, 180);
    const hasScript = cand.el.find('script').length > 0;

    metas.push({
      role,
      file: `${role}.html`,
      size_bytes: Buffer.byteLength(inlined, 'utf-8'),
      has_animation: hasScript,
      dominant_classes: cand.classList.slice(0, 3),
      text_excerpt: textExcerpt,
      tags: inferTags(cand.classList, textExcerpt),
    });
  });

  const index: KBv2Index = {
    site,
    source_clone: cloneDir,
    extracted_at: new Date().toISOString(),
    palette: extractPalette(css),
    fonts: extractFonts(css),
    sections: metas,
  };

  const assetsSource = path.join(cloneDir, 'assets');
  const { kbDir } = writeKB({
    siteName: site,
    index,
    sections,
    kbRoot,
    force,
    assetsSource: fs.existsSync(assetsSource) ? assetsSource : undefined,
  });

  return { site, kbDir, index };
}
