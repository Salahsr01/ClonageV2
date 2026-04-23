import * as crypto from 'crypto';
import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export type CopyHint = 'heading' | 'body' | 'cta' | 'label' | 'text';

export interface CopyBlock {
  id: string;
  path: string;
  tag: string;
  hint: CopyHint;
  text: string;
  inline: boolean;
}

export interface AttrCopy {
  id: string;
  path: string;
  attr: string;
  text: string;
}

export type MetaKind = 'title' | 'description' | 'og:title' | 'og:description';

export interface MetaCopy {
  id: string;
  kind: MetaKind;
  text: string;
}

export interface Fingerprints {
  scripts: string[];
  keyframesCount: number;
  fontFaceCount: number;
  nodeCount: number;
  ids: string[];
  dataAttrs: string[];
  bytes: number;
}

export interface Inventory {
  copyBlocks: CopyBlock[];
  attrs: AttrCopy[];
  metaText: MetaCopy[];
  fingerprints: Fingerprints;
}

const INLINE_TAGS = new Set([
  'span', 'em', 'strong', 'i', 'b', 'br', 'a', 'u', 'small',
  'mark', 'code', 'sub', 'sup', 'q', 'abbr', 'time', 'cite', 's',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'iframe', 'svg']);
const ATTR_NAMES = ['alt', 'aria-label', 'title', 'placeholder'];

const KEYFRAMES_RE = /@(?:-webkit-|-moz-|-o-|-ms-)?keyframes\b/gi;
const FONTFACE_RE = /@font-face\b/gi;

function tagOf(node: any): string {
  return (node.tagName || node.name || '').toLowerCase();
}

function isInlineFormattingOnly(el: any): boolean {
  const stack: any[] = [...(el.children || [])];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'tag') {
      if (!INLINE_TAGS.has(tagOf(n))) return false;
      for (const k of n.children || []) stack.push(k);
    }
  }
  return true;
}

function hasNonWhitespaceText(el: any): boolean {
  const stack: any[] = [...(el.children || [])];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'text') {
      if (((n.data as string) || '').trim().length > 0) return true;
    } else if (n.type === 'tag') {
      for (const k of n.children || []) stack.push(k);
    }
  }
  return false;
}

function hasInlineChild(el: any): boolean {
  for (const k of el.children || []) {
    if (k.type === 'tag' && INLINE_TAGS.has(tagOf(k))) return true;
  }
  return false;
}

function innerText(el: any): string {
  const parts: string[] = [];
  const stack: any[] = [...(el.children || [])];
  const reverse: any[] = [];
  while (stack.length) reverse.push(stack.pop());
  const ordered = [...(el.children || [])];
  const walk = (n: any) => {
    if (n.type === 'text') parts.push((n.data as string) || '');
    else if (n.type === 'tag') {
      if (tagOf(n) === 'br') parts.push(' ');
      for (const k of n.children || []) walk(k);
    }
  };
  for (const n of ordered) walk(n);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

function hintFor(tag: string): CopyHint {
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'a' || tag === 'button') return 'cta';
  if (['p', 'li', 'blockquote', 'dd', 'figcaption'].includes(tag)) return 'body';
  if (tag === 'label' || tag === 'dt') return 'label';
  return 'text';
}

function pathTo(el: any): string {
  const chain: string[] = [];
  let cur = el;
  while (cur && cur.type === 'tag') {
    const tag = tagOf(cur);
    const parent = cur.parent;
    if (!parent || parent.type !== 'tag') {
      chain.unshift(tag);
      break;
    }
    const siblingsSame = (parent.children || []).filter(
      (c: any) => c.type === 'tag' && tagOf(c) === tag,
    );
    const idx = siblingsSame.indexOf(cur);
    chain.unshift(
      siblingsSame.length > 1 ? `${tag}:nth-of-type(${idx + 1})` : tag,
    );
    cur = parent;
  }
  return chain.join(' > ');
}

export function enumerateCopyBlocks(root: any): Array<{ el: any; inline: boolean }> {
  const acc: Array<{ el: any; inline: boolean }> = [];
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === 'root') {
      for (const k of node.children || []) walk(k);
      return;
    }
    if (node.type !== 'tag') return;
    const tag = tagOf(node);
    if (SKIP_TAGS.has(tag) || tag === 'head') return;

    if (isInlineFormattingOnly(node) && hasNonWhitespaceText(node)) {
      acc.push({ el: node, inline: hasInlineChild(node) });
      return;
    }
    for (const k of node.children || []) walk(k);
  };
  walk(root);
  return acc;
}

export function resolveWalkRoot($: CheerioAPI): any {
  const body = $('body').get(0) as any;
  return body || (($ as any).root().get(0) as any);
}

function collectAttrs($: CheerioAPI): AttrCopy[] {
  const out: AttrCopy[] = [];
  let seq = 0;
  $('*').each((_, el: any) => {
    if (el.type !== 'tag') return;
    if (SKIP_TAGS.has(tagOf(el))) return;
    const attribs = el.attribs || {};
    for (const name of ATTR_NAMES) {
      const v = attribs[name];
      if (typeof v === 'string' && v.trim().length > 0) {
        seq += 1;
        out.push({ id: `a${seq}`, path: pathTo(el), attr: name, text: v });
      }
    }
  });
  return out;
}

function collectMeta($: CheerioAPI): MetaCopy[] {
  const out: MetaCopy[] = [];
  let seq = 0;
  const push = (kind: MetaKind, text: string) => {
    if (!text || !text.trim()) return;
    seq += 1;
    out.push({ id: `m${seq}`, kind, text: text.trim() });
  };
  const title = $('head title').first();
  if (title.length) push('title', title.text());
  $('head meta').each((_, el: any) => {
    const name = (el.attribs?.name || '').toLowerCase();
    const prop = (el.attribs?.property || '').toLowerCase();
    const content = el.attribs?.content;
    if (!content) return;
    if (name === 'description') push('description', content);
    if (prop === 'og:title') push('og:title', content);
    if (prop === 'og:description') push('og:description', content);
  });
  return out;
}

function collectFingerprints($: CheerioAPI, html: string): Fingerprints {
  const scripts: string[] = [];
  $('script').each((_, el: any) => {
    const body = $(el).html() || '';
    scripts.push(crypto.createHash('sha1').update(body).digest('hex'));
  });

  let cssText = '';
  $('style').each((_, el: any) => {
    cssText += '\n' + ($(el).html() || '');
  });
  const keyframesCount = (cssText.match(KEYFRAMES_RE) || []).length;
  const fontFaceCount = (cssText.match(FONTFACE_RE) || []).length;

  const ids = new Set<string>();
  const dataAttrs = new Set<string>();
  let nodeCount = 0;
  $('*').each((_, el: any) => {
    if (el.type !== 'tag') return;
    nodeCount += 1;
    const a = el.attribs || {};
    if (typeof a.id === 'string' && a.id.trim()) ids.add(a.id.trim());
    for (const key of Object.keys(a)) {
      if (key.startsWith('data-')) dataAttrs.add(key);
    }
  });

  return {
    scripts,
    keyframesCount,
    fontFaceCount,
    nodeCount,
    ids: [...ids].sort(),
    dataAttrs: [...dataAttrs].sort(),
    bytes: html.length,
  };
}

export function buildInventory(html: string): Inventory {
  const $ = load(html);
  const walkRoot = resolveWalkRoot($);

  const blocks = enumerateCopyBlocks(walkRoot);
  const copyBlocks: CopyBlock[] = blocks.map((b, i) => {
    const tag = tagOf(b.el);
    const text = innerText(b.el);
    return {
      id: `c${i + 1}`,
      path: pathTo(b.el),
      tag,
      hint: hintFor(tag),
      text,
      inline: b.inline,
    };
  });

  return {
    copyBlocks,
    attrs: collectAttrs($),
    metaText: collectMeta($),
    fingerprints: collectFingerprints($, html),
  };
}
