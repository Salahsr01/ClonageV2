import type { CheerioAPI, Cheerio } from 'cheerio';
import type { SectionCandidate } from './types.js';

const STRUCTURAL = 'section, article, header, footer, nav';
const SECTION_CLASS_RE = /section|hero|wrap|block/i;

function toCandidate($el: Cheerio<any>): SectionCandidate {
  const node = $el.get(0) as any;
  const tag = (node?.tagName || '').toLowerCase();
  const classAttr = $el.attr('class') || '';
  const classList = classAttr.split(/\s+/).filter(Boolean);
  let depth = 0;
  let p: any = node?.parent;
  while (p) { depth++; p = p.parent; }
  return {
    el: $el,
    depth,
    textLength: $el.text().trim().length,
    childCount: $el.children().length,
    tag,
    classList,
  };
}

function dedupeByNode(list: any[]): any[] {
  const seen = new Set<any>();
  const out: any[] = [];
  for (const el of list) {
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

function removeDescendantsOf(els: any[]): any[] {
  const set = new Set(els);
  return els.filter((el) => {
    let p: any = el.parent;
    while (p) {
      if (set.has(p)) return false;
      p = p.parent;
    }
    return true;
  });
}

export function findSectionCandidates($: CheerioAPI): SectionCandidate[] {
  const structural = $(STRUCTURAL).toArray();

  const topLevelStructural = structural.filter((el) => {
    let p: any = (el as any).parent;
    while (p) {
      const t = (p.tagName || '').toLowerCase();
      if (t === 'section' || t === 'article' || t === 'header' || t === 'footer' || t === 'nav') {
        return false;
      }
      p = p.parent;
    }
    return true;
  });

  function drillSingleWrapper($node: Cheerio<any>): Cheerio<any> {
    let cur = $node;
    for (let i = 0; i < 5; i++) {
      const kids = cur.children().toArray().filter((el) => {
        const tag = ((el as any).tagName || '').toLowerCase();
        return tag !== 'script' && tag !== 'style' && tag !== 'link';
      });
      if (kids.length !== 1) return cur;
      cur = $(kids[0]);
    }
    return cur;
  }

  const $main = $('main').first();
  const $body = $('body').first();

  const contentRoots: any[] = [];
  for (const $parent of [$main, $body]) {
    if ($parent.length === 0) continue;
    const effective = drillSingleWrapper($parent);
    const kids = effective.children().toArray().filter((el) => {
      const $el = $(el);
      const tag = ((el as any).tagName || '').toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta') return false;
      if (tag === 'section' || tag === 'article' || tag === 'header' || tag === 'footer' || tag === 'nav') return true;
      if ($el.find('h1, h2').length > 0) return true;
      const cls = ($el.attr('class') || '').toLowerCase();
      return SECTION_CLASS_RE.test(cls) || /page|view|wrapper|slider|home|content|panel/.test(cls);
    });
    if (kids.length > 0) {
      contentRoots.push(...kids);
      break;
    }
  }

  let merged = dedupeByNode([...topLevelStructural, ...contentRoots]);

  const contentOnly = merged.filter((el) => {
    const tag = (el.tagName || '').toLowerCase();
    return tag !== 'nav' && tag !== 'header' && tag !== 'footer';
  });

  if (contentOnly.length === 1) {
    const onlyContent = contentOnly[0];
    const onlyTag = (onlyContent.tagName || '').toLowerCase();
    if (onlyTag !== 'section' && onlyTag !== 'article') {
      const $only = $(onlyContent);
      const drilled = expandWrapper($, $only);
      if (drilled.length >= 2) {
        const shellParts = merged.filter((el) => {
          const tag = (el.tagName || '').toLowerCase();
          return tag === 'nav' || tag === 'header' || tag === 'footer';
        });
        merged = [...shellParts, ...drilled];
      }
    }
  }

  merged = removeDescendantsOf(merged);
  return merged.map((el) => toCandidate($(el)));
}

function expandWrapper($: CheerioAPI, $node: Cheerio<any>, budget = 4): any[] {
  if (budget <= 0) return [$node.get(0)];
  const kids = $node.children().toArray().filter((el) => {
    const tag = (el.tagName || '').toLowerCase();
    return tag !== 'script' && tag !== 'style' && tag !== 'link';
  });
  if (kids.length <= 1) {
    if (kids.length === 1) return expandWrapper($, $(kids[0]), budget - 1);
    return [$node.get(0)];
  }
  const sectionLike = kids.filter((el) => {
    const $el = $(el);
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'section' || tag === 'article' || tag === 'header' || tag === 'footer' || tag === 'nav') return true;
    if ($el.find('h1, h2, h3').length > 0) return true;
    const cls = ($el.attr('class') || '').toLowerCase();
    return SECTION_CLASS_RE.test(cls) || /page|view|wrapper|home|slider|content|panel|module|block/.test(cls);
  });
  if (sectionLike.length >= 2) return sectionLike;
  return kids;
}
