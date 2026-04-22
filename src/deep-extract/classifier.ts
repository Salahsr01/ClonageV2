import type { SectionCandidate, SectionRole } from './types.js';

export function classify(c: SectionCandidate, index: number, isFirst: boolean): SectionRole {
  const cls = c.classList.join(' ').toLowerCase();
  const tag = c.tag;
  const $el = c.el;

  if (tag === 'footer' || /\bfooter\b/.test(cls)) return 'footer';
  if (tag === 'nav' || /\bnav\b|\bnavbar\b|\bmenu\b/.test(cls)) return 'nav';

  const hasForm = $el.find('form').length > 0;
  const hasMailto = $el.find('a[href^="mailto:"]').length > 0;
  if (hasForm || hasMailto || /\bcontact\b/.test(cls)) return 'contact';

  const hasH1 = $el.find('h1').length > 0;
  if (isFirst && (hasH1 || /\bhero\b|\bbanner\b/.test(cls))) return 'hero';
  if (/\bhero\b|\bbanner\b/.test(cls)) return 'hero';

  if (/\bportfolio\b|\bprojects?\b|\bwork\b/.test(cls)) return 'portfolio';

  const imageChildren = $el.find('> a > img, > div > img, > img').length;
  if (imageChildren >= 3 && $el.find('h2, h3').length >= 3) return 'portfolio';

  if ($el.find('blockquote').length > 0 || /\btestimonial/.test(cls)) return 'testimonials';

  const directBlocks = $el.children();
  if (directBlocks.length >= 3) {
    const classes = directBlocks.map((_, el) => {
      const ce = (el as any).attribs?.class || '';
      return ce.split(/\s+/)[0] || '';
    }).get();
    const nonEmpty = classes.filter(Boolean);
    if (nonEmpty.length >= 3) {
      const first = nonEmpty[0];
      const sameCount = nonEmpty.filter((x) => x === first).length;
      if (sameCount >= 3) return 'services';
    }
  }

  const longParagraph = $el.find('p').toArray().some((p: any) => {
    const t = ((p.children || []).map((c: any) => c.data || '').join('') || '').trim();
    return t.length > 400;
  });
  if (/\babout\b|\bstudio\b/.test(cls) || (longParagraph && $el.find('img').length > 0)) return 'about';

  if (/\bcta\b/.test(cls) || ($el.find('a.button, a.btn, button').length > 0 && $el.text().length < 200)) return 'cta';

  return `section-${index}` as SectionRole;
}
