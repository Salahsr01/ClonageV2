import type { CheerioAPI } from 'cheerio';
import { TransformerReport, CopyEntry } from '../types.js';

export function applyCopy($: CheerioAPI, entries: CopyEntry[]): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let matched = 0;
    let originalLen = 0;

    if ('from' in entry) {
      const rootSel = $('body').length ? 'body' : undefined;
      const root: any = rootSel ? $(rootSel) : $.root();
      const walk = function(this: any) {
        const self: any = this;
        if (self.type === 'text') {
          if ((self.data as string).includes(entry.from)) {
            self.data = (self.data as string).split(entry.from).join(entry.to);
            matched++;
            applied++;
          }
        } else if (self.type === 'tag') {
          $(self).contents().each(walk);
        }
      };
      root.contents().each(walk);
      originalLen = entry.from.length;
      if (matched === 0) warnings.push(`copy[${i}]: no match for "${entry.from}"`);
    } else {
      const els = $(entry.selector);
      if (!els.length) {
        warnings.push(`copy[${i}]: selector "${entry.selector}" matched 0 elements`);
      } else {
        els.each((_, el) => {
          originalLen = Math.max(originalLen, $(el).text().length);
          $(el).text(entry.to);
          matched++;
          applied++;
        });
      }
    }

    if (originalLen > 0 && entry.to.length > originalLen * 1.5) {
      warnings.push(`copy[${i}]: new text ${(entry.to.length / originalLen).toFixed(1)}× longer than original (>1.5× threshold)`);
    }
  }

  return { name: 'copy', applied, skipped: 0, warnings };
}
