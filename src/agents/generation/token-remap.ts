/**
 * Token remap pass for Generation (S5 / §4.5).
 *
 * Goal: carry through the `design_constraints` from the plan — pick which
 * source site imposes the palette / typo / rhythm — and apply a light-touch
 * rewrite on each non-reference section so they visually anchor to the chosen
 * references.
 *
 * For now this is a minimal scaffolding: palette + typo substitution based on
 * CSS variable definitions or inline color/font-family rules. A full pass
 * would extract tokens from the reference site's KB and rewrite each other
 * section's tokens to match. That can be incrementally improved without
 * changing callers.
 */

import * as cheerio from 'cheerio';
import type { AtlasEntry } from '../../atlas/index.js';

export interface TokenRemapInput {
  html: string;
  /** The atlas entry of THIS section. */
  self: AtlasEntry;
  /** Reference palette site. */
  paletteRef?: AtlasEntry;
  /** Reference typography site. */
  typoRef?: AtlasEntry;
}

/**
 * Replace the dominant palette of `html` with that of the palette reference.
 * Simple color-by-color swap: N source colors → N ref colors, ordered.
 * If the sets differ in size, we map the smaller to the larger by cycling.
 */
export function remapPalette(html: string, fromColors: string[], toColors: string[]): string {
  if (fromColors.length === 0 || toColors.length === 0) return html;
  let out = html;
  for (let i = 0; i < fromColors.length; i++) {
    const src = fromColors[i];
    const dst = toColors[i % toColors.length];
    if (!src || !dst || src.toLowerCase() === dst.toLowerCase()) continue;
    out = swapColor(out, src, dst);
  }
  return out;
}

function swapColor(html: string, from: string, to: string): string {
  const re = new RegExp(escapeForRegex(from), 'gi');
  return html.replace(re, to);
}

/**
 * Swap `font-family` declarations from source to target.
 */
export function remapFont(html: string, fromFamily: string, toFamily: string): string {
  if (!fromFamily || !toFamily || fromFamily === toFamily || fromFamily === 'unknown') return html;
  const $ = cheerio.load(html, { xml: false });
  // In <style> tags
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    const re = new RegExp(`font-family\\s*:\\s*([^;}]*${escapeForRegex(fromFamily)}[^;}]*)`, 'gi');
    const replaced = css.replace(re, (_, decl) => `font-family: ${toFamily}`);
    $(el).text(replaced);
  });
  // In inline style attributes
  $('[style]').each((_, el) => {
    const cur = $(el).attr('style') || '';
    if (!cur.toLowerCase().includes('font-family')) return;
    const re = new RegExp(`font-family\\s*:\\s*([^;]*${escapeForRegex(fromFamily)}[^;]*)`, 'gi');
    const replaced = cur.replace(re, `font-family: ${toFamily}`);
    $(el).attr('style', replaced);
  });
  return $.html();
}

export function remapTokens(input: TokenRemapInput): string {
  let out = input.html;
  if (input.paletteRef) {
    out = remapPalette(out, input.self.fiche.palette_dominant, input.paletteRef.fiche.palette_dominant);
  }
  if (input.typoRef) {
    const from = input.self.fiche.typo.display;
    const to = input.typoRef.fiche.typo.display;
    out = remapFont(out, from, to);
  }
  return out;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
