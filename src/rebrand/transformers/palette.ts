import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';
import { normalizeColor } from '../color-normalize.js';

// Matches color values in CSS: hex, rgb(), rgba(), named colors.
const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|\b(?:black|white|red|green|blue|yellow|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|transparent)\b/g;

export function applyPalette(
  $: CheerioAPI,
  palette: { map: Record<string, string> }
): TransformerReport {
  // Build normalized lookup: normalized source → user-provided target
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(palette.map)) {
    const n = normalizeColor(k);
    if (n) lookup.set(n, v);
  }

  let applied = 0;
  const unmappedCounts = new Map<string, number>();
  const warnings: string[] = [];

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const rewritten = style.replace(COLOR_PATTERN, (match) => {
      const norm = normalizeColor(match);
      if (!norm) return match;
      const target = lookup.get(norm);
      if (target) {
        applied++;
        return target;
      }
      unmappedCounts.set(norm, (unmappedCounts.get(norm) || 0) + 1);
      return match;
    });
    if (rewritten !== style) $(el).attr('style', rewritten);
  });

  const topUnmapped = [...unmappedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (Object.keys(palette.map).length === 0) {
    warnings.push('palette.map is empty — no substitutions made. See topUnmapped for discovery.');
  }

  return {
    name: 'palette',
    applied,
    skipped: 0,
    warnings,
    info: { topUnmapped },
  };
}
