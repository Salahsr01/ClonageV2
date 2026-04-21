import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';

const FAMILY_PATTERN = /font-family:\s*([^;]+?)(?=;|$)/g;
const FONT_SIZE_PATTERN = /font-size:\s*(\d+(?:\.\d+)?)px/;
const DISPLAY_MIN_PX = 32;

export function applyTypography(
  $: CheerioAPI,
  typography: {
    primary?: { family: string; google?: boolean };
    display?: { family: string; google?: boolean };
  }
): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  // Step 1: count font-family occurrences to pick the "primary" (most-frequent)
  const familyCounts = new Map<string, number>();
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    let m: RegExpExecArray | null;
    const re = /font-family:\s*([^;]+?)(?=;|$)/g;
    while ((m = re.exec(style)) !== null) {
      const fam = m[1].trim();
      familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
    }
  });

  const primaryFamily = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Step 2: rewrite inline styles
  $('[style]').each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase?.() ?? '';
    const style = $(el).attr('style') || '';

    const rewritten = style.replace(FAMILY_PATTERN, (_match, fam: string) => {
      const current = fam.trim();

      // Display role: large heading tags
      if (typography.display && ['h1', 'h2', 'h3'].includes(tag)) {
        const sizeMatch = FONT_SIZE_PATTERN.exec(style);
        const size = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
        if (size >= DISPLAY_MIN_PX) {
          applied++;
          return `font-family: ${typography.display.family}`;
        }
      }

      // Primary role: most-frequent source family
      if (typography.primary && current === primaryFamily) {
        applied++;
        return `font-family: ${typography.primary.family}`;
      }

      return `font-family: ${current}`;
    });

    if (rewritten !== style) $(el).attr('style', rewritten);
  });

  // Step 3: Google Fonts link injection
  const googleFamilies: string[] = [];
  if (typography.primary?.google) googleFamilies.push(typography.primary.family);
  if (typography.display?.google) googleFamilies.push(typography.display.family);

  if (googleFamilies.length) {
    const href = 'https://fonts.googleapis.com/css2?'
      + googleFamilies.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')
      + '&display=swap';

    let head = $('head');
    if (!head.length) {
      $('html').prepend('<head></head>');
      head = $('head');
    }
    head.find('link[data-rebrand-google-fonts]').remove();
    head.append(`<link rel="stylesheet" data-rebrand-google-fonts href="${href}">`);
  }

  if (!primaryFamily && typography.primary) warnings.push('no font-family found in inline styles — primary not applied');

  return { name: 'typography', applied, skipped: 0, warnings };
}
