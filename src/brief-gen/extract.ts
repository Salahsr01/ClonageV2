import * as fs from 'fs';
import * as cheerio from 'cheerio';

/**
 * Pull rebrand-able signals out of a recording.har :
 *  - visible text strings that look like brand/heading/nav content
 *  - dominant color codes (hex + rgb)
 *  - a canonical brand name guess
 *
 * Used as input context for the LLM that drafts a rebrand brief.
 */

export interface ExtractedSignals {
  brandGuess: string | null;
  texts: string[];
  colors: { hex: string[]; rgb: string[] };
  url: string | null;
}

const TEXT_MIMES = new Set(['text/html', 'application/javascript', 'text/javascript', 'text/css']);

export function extractFromHar(harPath: string): ExtractedSignals {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf-8'));
  const entries: any[] = har?.log?.entries ?? [];

  const texts = new Set<string>();
  const hex = new Map<string, number>();
  const rgb = new Map<string, number>();
  let url: string | null = null;

  for (const e of entries) {
    const mime = String(e?.response?.content?.mimeType ?? '').split(';')[0].trim();
    const body = e.response?.content?.text;
    const encoding = e.response?.content?.encoding;
    if (!TEXT_MIMES.has(mime) || typeof body !== 'string') continue;
    let decoded = body;
    if (encoding === 'base64') {
      try {
        decoded = Buffer.from(body, 'base64').toString('utf-8');
      } catch {
        continue;
      }
    }
    if (!url && String(e.request?.url ?? '').endsWith('/')) url = e.request.url;

    if (mime === 'text/html') {
      harvestVisibleText(decoded, texts);
    }
    harvestColors(decoded, hex, rgb);
  }

  const brandGuess = guessBrand([...texts]);

  return {
    brandGuess,
    texts: [...texts].slice(0, 80),
    colors: {
      hex: topN(hex, 12),
      rgb: topN(rgb, 8),
    },
    url,
  };
}

function harvestVisibleText(html: string, out: Set<string>): void {
  try {
    const $ = cheerio.load(html, { xml: false });
    $('script, style, noscript').remove();
    $('*').each((_, el) => {
      for (const child of (el as any).children || []) {
        if (child.type === 'text') {
          const t = (child.data || '').trim();
          if (!t) continue;
          if (t.length > 120) continue;
          out.add(t);
        }
      }
    });
  } catch {
    // Body may not be valid HTML (JS bundle etc.) — ignore.
  }
}

function harvestColors(body: string, hex: Map<string, number>, rgb: Map<string, number>): void {
  const hexMatches = body.match(/#[0-9a-fA-F]{6}\b/g) || [];
  for (const m of hexMatches) {
    const k = m.toLowerCase();
    hex.set(k, (hex.get(k) || 0) + 1);
  }
  // Tailwind / CSS use space-separated rgb: rgb(240 240 240 / 1) and comma: rgb(240, 240, 240)
  const rgbMatches = body.match(/rgb\((?:\d{1,3}\s*,?\s*){3}/g) || [];
  for (const m of rgbMatches) {
    const normalised = m.replace(/\s+/g, ' ').replace(/,\s*/g, ', ').trim();
    rgb.set(normalised, (rgb.get(normalised) || 0) + 1);
  }
}

function topN(m: Map<string, number>, n: number): string[] {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

/** Lightweight brand-name heuristic: shortest all-caps token followed by © */
function guessBrand(texts: string[]): string | null {
  const copyrighted = texts.filter((t) => /^[A-Z][\w]*©$/.test(t));
  if (copyrighted.length > 0) {
    copyrighted.sort((a, b) => a.length - b.length);
    return copyrighted[0].replace('©', '');
  }
  // Fallback: the shortest all-uppercase word.
  const upper = texts.filter((t) => /^[A-Z]{3,}$/.test(t));
  upper.sort((a, b) => a.length - b.length);
  return upper[0]?.replace(/[^A-Z]/g, '') ?? null;
}
