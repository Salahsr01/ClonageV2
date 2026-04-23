import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { enumerateCopyBlocks, resolveWalkRoot } from './inventory.js';
import type { Inventory } from './inventory.js';

export interface Patches {
  copy?: Record<string, string>;
  attrs?: Record<string, string>;
  meta?: Record<string, string>;
}

export interface ReinjectReport {
  copyApplied: number;
  copySkipped: number;
  attrsApplied: number;
  metaApplied: number;
  warnings: string[];
}

export interface ReinjectResult {
  html: string;
  report: ReinjectReport;
}

function setTextContent(el: any, text: string): void {
  el.children = [{ type: 'text', data: text, parent: el, prev: null, next: null }];
}

function collectTextNodes(el: any): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === 'text') out.push(n);
    else if (n.type === 'tag') for (const k of n.children || []) walk(k);
  };
  for (const k of el.children || []) walk(k);
  return out;
}

function applyInlineText(el: any, text: string): void {
  const nodes = collectTextNodes(el);
  const firstIdx = nodes.findIndex((n) => ((n.data as string) || '').trim().length > 0);
  if (firstIdx === -1) {
    setTextContent(el, text);
    return;
  }
  nodes[firstIdx].data = text;
  for (let i = 0; i < nodes.length; i += 1) {
    if (i !== firstIdx) nodes[i].data = '';
  }
}

function applyAttrs(inv: Inventory, $: CheerioAPI, patches: Patches['attrs'], report: ReinjectReport) {
  if (!patches) return;
  const byPath = new Map<string, { attr: string; text: string }>();
  for (const a of inv.attrs) {
    const v = patches[a.id];
    if (typeof v === 'string') byPath.set(a.path + '::' + a.attr, { attr: a.attr, text: v });
  }
  if (byPath.size === 0) return;

  let seen = 0;
  const pathToAttrs = new Map<string, Array<{ attr: string; text: string }>>();
  for (const a of inv.attrs) {
    const v = patches[a.id];
    if (typeof v !== 'string') continue;
    const arr = pathToAttrs.get(a.path) || [];
    arr.push({ attr: a.attr, text: v });
    pathToAttrs.set(a.path, arr);
    seen += 1;
  }
  if (seen === 0) return;

  const known = new Set(Object.keys(patches));
  const applied = new Set<string>();
  $('*').each((_, el: any) => {
    if (el.type !== 'tag') return;
    const attribs = el.attribs || {};
    for (const a of inv.attrs) {
      if (!known.has(a.id) || applied.has(a.id)) continue;
      if (attribs[a.attr] === a.text) {
        el.attribs[a.attr] = patches[a.id];
        applied.add(a.id);
        report.attrsApplied += 1;
      }
    }
  });
  for (const id of known) {
    if (!applied.has(id)) report.warnings.push(`attrs: id "${id}" not applied (no match)`);
  }
}

function applyMeta($: CheerioAPI, inv: Inventory, patches: Patches['meta'], report: ReinjectReport) {
  if (!patches) return;
  for (const m of inv.metaText) {
    const v = patches[m.id];
    if (typeof v !== 'string') continue;
    if (m.kind === 'title') {
      const t = $('head title').first();
      if (t.length) {
        t.text(v);
        report.metaApplied += 1;
      } else {
        report.warnings.push(`meta: no <title> to patch for ${m.id}`);
      }
    } else {
      const selectors: Record<string, string> = {
        description: 'head meta[name="description"]',
        'og:title': 'head meta[property="og:title"]',
        'og:description': 'head meta[property="og:description"]',
      };
      const el = $(selectors[m.kind]).first();
      if (el.length) {
        el.attr('content', v);
        report.metaApplied += 1;
      } else {
        report.warnings.push(`meta: no ${m.kind} tag to patch for ${m.id}`);
      }
    }
  }
}

export function applyPatches(html: string, inv: Inventory, patches: Patches): ReinjectResult {
  const $ = load(html);
  const walkRoot = resolveWalkRoot($);
  const blocks = enumerateCopyBlocks(walkRoot);

  const report: ReinjectReport = {
    copyApplied: 0,
    copySkipped: 0,
    attrsApplied: 0,
    metaApplied: 0,
    warnings: [],
  };

  if (blocks.length !== inv.copyBlocks.length) {
    report.warnings.push(
      `reinject: copy-block count drift (inv=${inv.copyBlocks.length}, live=${blocks.length})`,
    );
  }

  const copyPatches = patches.copy || {};
  const knownIds = new Set(Object.keys(copyPatches));
  const appliedIds = new Set<string>();

  const limit = Math.min(blocks.length, inv.copyBlocks.length);
  for (let i = 0; i < limit; i += 1) {
    const meta = inv.copyBlocks[i];
    const live = blocks[i];
    const newText = copyPatches[meta.id];
    if (typeof newText !== 'string') {
      report.copySkipped += 1;
      continue;
    }
    if (meta.inline) {
      applyInlineText(live.el, newText);
    } else {
      setTextContent(live.el, newText);
    }
    appliedIds.add(meta.id);
    report.copyApplied += 1;
  }

  for (const id of knownIds) {
    if (!appliedIds.has(id)) {
      report.warnings.push(`copy: id "${id}" unknown or out-of-range`);
    }
  }

  applyAttrs(inv, $, patches.attrs, report);
  applyMeta($, inv, patches.meta, report);

  return { html: $.html(), report };
}
