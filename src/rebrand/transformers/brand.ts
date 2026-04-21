import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';

export function applyBrand(
  $: CheerioAPI,
  brand: { name: string; source_name: string }
): TransformerReport {
  let applied = 0;

  // Walk only text nodes inside <body> (or the whole doc if no body)
  const root: any = $('body').length ? $('body') : $.root();

  const walk = function (this: any) {
    const self = this as any;
    if (self.type === 'text') {
      const before = self.data as string;
      if (before.includes(brand.source_name)) {
        self.data = before.split(brand.source_name).join(brand.name);
        applied++;
      }
    } else if (self.type === 'tag') {
      $(self).contents().each(walk);
    }
  };

  root.contents().each(walk);

  return { name: 'brand', applied, skipped: 0, warnings: [] };
}
