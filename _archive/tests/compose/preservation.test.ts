import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { compose } from '../../src/compose/index.js';
import type { LLMCall } from '../../src/compose/types.js';
import type { KBv2Index } from '../../src/deep-extract/types.js';
import { buildInventory } from '../../src/compose/inventory.js';

/**
 * Anti-regression E2E: seed a KB section that carries every structural invariant
 * the LLM pipeline has historically destroyed (scripts, @keyframes, @font-face,
 * data-attributes, image assets) and verify that after a full compose() run,
 * every one of those invariants is preserved byte-for-byte / rule-for-rule.
 *
 * The mock LLM is strictly text-only: it receives no HTML in the prompt and
 * returns JSON text patches — exactly the contract we're enforcing.
 */

const GSAP_SCRIPT_BODY = [
  '(function(){',
  '  gsap.to(".hero-title", { opacity: 1, y: 0, duration: 1.2, ease: "power2.out" });',
  '  ScrollTrigger.create({ trigger: ".hero", pin: true, start: "top top", end: "+=2000" });',
  '})();',
].join('\n');

const KEYFRAMES_CSS = `
  @keyframes pulse {
    0% { transform: scale(1); opacity: 0.8; }
    50% { transform: scale(1.05); opacity: 1; }
    100% { transform: scale(1); opacity: 0.8; }
  }
  @-webkit-keyframes fadein {
    from { opacity: 0 }
    to   { opacity: 1 }
  }
`.trim();

const FONT_FACE_CSS = `
  @font-face {
    font-family: 'NeueDisplay';
    src: url('/assets/neue.woff2') format('woff2');
    font-weight: 400 900;
    font-display: swap;
  }
  @font-face {
    font-family: 'NeueMono';
    src: url('/assets/neue-mono.woff2') format('woff2');
  }
`.trim();

const SECTION_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>iCOMAT — Engineering</title>
  <meta name="description" content="A composites engineering company">
  <style>
    ${KEYFRAMES_CSS}
    ${FONT_FACE_CSS}
    .hero { background: #000; color: #fff; }
    .hero-title { opacity: 0; transform: translateY(32px); }
  </style>
</head>
<body>
  <section id="hero" class="hero" data-scroll data-gsap="hero">
    <h1 class="hero-title">iCOMAT engineers the future of composites.</h1>
    <p>We build what others can't.</p>
    <div class="hero-media" data-speed="0.8">
      <img src="/assets/panel.jpg" alt="Composite panel detail" data-src="/assets/panel-hd.jpg" />
    </div>
    <a href="#cta" class="cta">Start a conversation</a>
  </section>
  <script>${GSAP_SCRIPT_BODY}</script>
</body>
</html>`;

function seedKB(kbRoot: string, site: string) {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  const idx: KBv2Index = {
    site,
    source_clone: '/tmp/source',
    extracted_at: '2026-04-22T00:00:00Z',
    palette: { primary: '#000' },
    fonts: { primary: { family: 'NeueDisplay', google: false } },
    sections: [
      {
        role: 'hero',
        file: 'hero.html',
        size_bytes: SECTION_HTML.length,
        has_animation: true,
        dominant_classes: ['hero', 'hero-title'],
        text_excerpt: 'iCOMAT engineers the future',
        tags: ['gsap', 'scroll'],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 2));
  fs.writeFileSync(path.join(dir, 'hero.html'), SECTION_HTML);
  return dir;
}

/**
 * Mock LLM that behaves exactly like the contract demands:
 *   - Refuses to respond if the prompt contains raw HTML tags.
 *   - Reads the inventory's copyBlocks from the JSON payload in the prompt.
 *   - Produces text-only replacements that mention the new brand name.
 */
function makeMockLLM(): LLMCall {
  return async ({ prompt }) => {
    assert.ok(!/<h1|<p>|<section|<script|<style|<!DOCTYPE/i.test(prompt),
      'mock LLM refuses: prompt must not contain HTML');

    // Select phase returns index 0 (only one section).
    if (/compose:select/.test(prompt) || /CANDIDATS\s*:/i.test(prompt)) {
      return JSON.stringify([{ idx: 0, reason: 'only hero available' }]);
    }

    // Rewrite phase: extract the JSON payload from the prompt and produce patches.
    const m = prompt.match(/"copyBlocks":\s*(\[[\s\S]*?\])/);
    if (!m) throw new Error('mock LLM: could not find copyBlocks in prompt');
    const copyBlocks = JSON.parse(m[1]) as Array<{ id: string; hint: string; text: string }>;
    const copy: Record<string, string> = {};
    for (const b of copyBlocks) {
      if (b.hint === 'heading') copy[b.id] = 'Nova builds silent propulsion for flight.';
      else if (b.hint === 'cta') copy[b.id] = 'Contact Nova';
      else if (b.hint === 'body') copy[b.id] = 'Silence, range, precision — by design.';
      else copy[b.id] = 'Nova Aerospace';
    }

    const attrsMatch = prompt.match(/"attrs":\s*(\[[\s\S]*?\])/);
    const attrs: Record<string, string> = {};
    if (attrsMatch) {
      const a = JSON.parse(attrsMatch[1]) as Array<{ id: string; attr: string }>;
      for (const at of a) attrs[at.id] = at.attr === 'alt' ? 'Propulsion module' : 'Nova';
    }

    const metaMatch = prompt.match(/"metaText":\s*(\[[\s\S]*?\])/);
    const meta: Record<string, string> = {};
    if (metaMatch) {
      const m2 = JSON.parse(metaMatch[1]) as Array<{ id: string; kind: string }>;
      for (const me of m2) {
        meta[me.id] = me.kind === 'title' ? 'Nova Aerospace' : 'Silent propulsion for aviation.';
      }
    }

    return JSON.stringify({ copy, attrs, meta });
  };
}

function hash(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function countMatches(re: RegExp, s: string): number {
  return (s.match(re) || []).length;
}

test('PRESERVATION: script body survives byte-for-byte through compose()', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova Aerospace', industry: 'aerospace', tagline: 'Silence' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });

  const html = fs.readFileSync(result.indexPath, 'utf-8');

  // The script body must appear verbatim — not re-encoded, not stripped.
  assert.ok(
    html.includes(GSAP_SCRIPT_BODY),
    'GSAP script body missing or mutated — LLM or assembler has dropped content',
  );

  // Stronger check: fingerprints should include the same script hash.
  const originalHash = hash(GSAP_SCRIPT_BODY);
  const outFp = buildInventory(html).fingerprints;
  assert.ok(
    outFp.scripts.includes(originalHash),
    `script SHA-1 ${originalHash} not found in output (found: ${outFp.scripts.join(', ')})`,
  );
});

test('PRESERVATION: @keyframes rules survive rule-for-rule', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');

  // Both @keyframes rules present (standard + -webkit-)
  assert.strictEqual(countMatches(/@keyframes\s+pulse\b/g, html), 1, '@keyframes pulse missing');
  assert.strictEqual(countMatches(/@-webkit-keyframes\s+fadein\b/g, html), 1, '@-webkit-keyframes fadein missing');

  // Structure of the pulse keyframe (percentage stops + transform) preserved
  assert.match(html, /50%\s*\{\s*transform:\s*scale\(1\.05\)/);
});

test('PRESERVATION: @font-face rules survive with real font-family names', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');

  // Both @font-face blocks, with their actual font-family names (never 'unknown').
  assert.strictEqual(countMatches(/@font-face/g, html), 2);
  assert.match(html, /font-family:\s*['"]NeueDisplay['"]/);
  assert.match(html, /font-family:\s*['"]NeueMono['"]/);
  assert.ok(!/font-family:\s*['"]?unknown['"]?/i.test(html),
    'font-family "unknown" leaked — typography transformer bug resurfaced');
});

test('PRESERVATION: data-attributes survive on every element', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');

  assert.match(html, /data-scroll/);
  assert.match(html, /data-gsap="hero"/);
  assert.match(html, /data-speed="0\.8"/);
  assert.match(html, /data-src="\/assets\/panel-hd\.jpg"/);
});

test('PRESERVATION: DOM hierarchy and ids survive', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');

  assert.match(html, /id="hero"/);
  assert.match(html, /class="hero-title"/);
  assert.match(html, /class="hero-media"/);
  assert.match(html, /<img[^>]+src="\/assets\/panel\.jpg"/);
});

test('PRESERVATION: LLM outcome + size ratio ≥ 0.9 in manifest', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });

  assert.strictEqual(result.sections.length, 1);
  assert.strictEqual(result.sections[0].outcome, 'llm',
    `expected 'llm' outcome, got '${result.sections[0].outcome}'; errors: ${result.sections[0].llmErrors.join(' | ')}`);
  assert.ok(result.sections[0].validation?.ok);
  const ratio = result.sections[0].rewrittenSize / result.sections[0].originalSize;
  assert.ok(ratio >= 0.9, `size ratio ${ratio} below 0.9`);
});

test('PRESERVATION: source brand "iCOMAT" never leaks into output', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-pres-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: { brandName: 'Nova', industry: 'x' },
    outputDir,
    kbRoot,
    llm: makeMockLLM(),
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');

  // Strip the compose:* marker comments first — they are allowed to contain the source role name.
  const stripped = html.replace(/<!--\s*\/?compose:[^>]*-->/g, '');
  assert.ok(!/iCOMAT/i.test(stripped), 'iCOMAT brand leaked into user-visible content');
});
