import * as fs from 'fs';
import * as path from 'path';
import type { CheerioAPI } from 'cheerio';
import { TransformerReport, ImageEntry } from '../types.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function applyImages($: CheerioAPI, entries: ImageEntry[]): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const resolvedTo = resolveTarget(entry.to, warnings, i);
    if (resolvedTo === null) continue;

    if ('from' in entry) {
      const matches = $('img').filter((_, el) => {
        const src = $(el).attr('src') || '';
        return src.endsWith(entry.from);
      });
      if (!matches.length) {
        warnings.push(`images[${i}]: no <img> ends with "${entry.from}"`);
      } else {
        matches.each((_, el) => { $(el).attr('src', resolvedTo); applied++; });
      }
    } else {
      // Scope selector to <img> so ".hero-img" becomes "img.hero-img".
      const scoped = entry.selector.match(/^\s*img\b/) ? entry.selector : `img${entry.selector}`;
      const els = $(scoped);
      if (!els.length) {
        warnings.push(`images[${i}]: selector "${entry.selector}" matched 0 <img>`);
      } else {
        els.each((_, el) => { $(el).attr('src', resolvedTo); applied++; });
      }
    }
  }

  return { name: 'images', applied, skipped: 0, warnings };
}

function resolveTarget(to: string, warnings: string[], idx: number): string | null {
  if (/^https?:\/\//.test(to)) return to;
  if (to.startsWith('data:')) return to;

  const absolute = path.isAbsolute(to) ? to : path.resolve(process.cwd(), to);
  if (!fs.existsSync(absolute)) {
    warnings.push(`images[${idx}]: local file not found: ${absolute}`);
    return null;
  }
  const buf = fs.readFileSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}
