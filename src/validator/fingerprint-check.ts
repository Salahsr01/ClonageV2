import * as cheerio from 'cheerio';

export interface Fingerprint {
  nodes: number;
  scripts: number;
  keyframes: number;
  linkStylesheets: number;
  fonts: number;
}

export function fingerprintHtml(html: string): Fingerprint {
  const $ = cheerio.load(html, { xml: false });
  let keyframes = 0;
  $('style').each((_, el) => {
    const css = $(el).html() || '';
    const m = css.match(/@keyframes\s+[\w-]+/g);
    if (m) keyframes += m.length;
  });
  return {
    nodes: $('*').length,
    scripts: $('script').length,
    keyframes,
    linkStylesheets: $('link[rel="stylesheet"]').length,
    fonts: $('link[rel="preload"][as="font"], link[href*="fonts.googleapis"]').length,
  };
}

export interface FingerprintCheck {
  /** Per-metric percent deltas (actual - expected) / expected. Negative = missing. */
  nodeDelta: number;
  scriptsDelta: number;
  keyframesDelta: number;
  /** True if all deltas are within tolerance (default 5% for nodes, 0 missing scripts/keyframes). */
  ok: boolean;
  /** Free-form report lines for the failure report. */
  report: string[];
}

export function compareFingerprints(
  expected: Fingerprint,
  actual: Fingerprint,
  opts: { nodeTolerance?: number } = {},
): FingerprintCheck {
  const tol = opts.nodeTolerance ?? 0.05;
  const report: string[] = [];
  const nodeDelta = expected.nodes === 0 ? 0 : (actual.nodes - expected.nodes) / expected.nodes;
  const scriptsDelta = expected.scripts === 0 ? 0 : (actual.scripts - expected.scripts) / expected.scripts;
  const keyframesDelta =
    expected.keyframes === 0 ? 0 : (actual.keyframes - expected.keyframes) / expected.keyframes;

  let ok = true;
  if (Math.abs(nodeDelta) > tol) {
    ok = false;
    report.push(`nodes: ${(nodeDelta * 100).toFixed(1)}% delta (expected=${expected.nodes}, actual=${actual.nodes})`);
  }
  if (actual.scripts < expected.scripts) {
    ok = false;
    report.push(`scripts: missing ${expected.scripts - actual.scripts} (expected=${expected.scripts}, actual=${actual.scripts})`);
  }
  if (actual.keyframes < expected.keyframes) {
    ok = false;
    report.push(`keyframes: missing ${expected.keyframes - actual.keyframes} (expected=${expected.keyframes}, actual=${actual.keyframes})`);
  }

  return { nodeDelta, scriptsDelta, keyframesDelta, ok, report };
}
