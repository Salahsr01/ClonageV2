import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { compose, fallbackBrandSwap } from '../../src/compose/index.js';
import type { LLMCall } from '../../src/compose/types.js';
import type { KBv2Index } from '../../src/deep-extract/types.js';

function seedKB(kbRoot: string, site: string) {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  const idx: KBv2Index = {
    site,
    source_clone: '/tmp/source',
    extracted_at: '2026-04-22T00:00:00Z',
    palette: { primary: '#111' },
    fonts: { primary: { family: 'Inter', google: true } },
    sections: [
      {
        role: 'hero',
        file: 'hero.html',
        size_bytes: 250,
        has_animation: false,
        dominant_classes: ['hero'],
        text_excerpt: 'Old hero headline',
        tags: [],
      },
      {
        role: 'footer',
        file: 'footer.html',
        size_bytes: 120,
        has_animation: false,
        dominant_classes: ['footer'],
        text_excerpt: 'Old footer',
        tags: [],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 2));
  fs.writeFileSync(
    path.join(dir, 'hero.html'),
    '<!DOCTYPE html><html lang="en"><head><title>Old Brand</title><style>.hero{padding:40px}</style></head><body><section class="hero"><h1>Old Brand Hero</h1><p>Old body text</p></section></body></html>',
  );
  fs.writeFileSync(
    path.join(dir, 'footer.html'),
    '<!DOCTYPE html><html lang="en"><head><style>.footer{color:#111}</style></head><body><footer><p>Old Brand footer</p></footer></body></html>',
  );
  return dir;
}

const BRIEF = { brandName: 'Nova', industry: 'aerospace', tagline: 'Lift off' };

/** Mock LLM that patches every copy-block with a marker derived from the brand name. */
function makeRewriteLLM(): LLMCall {
  return async ({ prompt }) => {
    if (/CANDIDATS\s*:/i.test(prompt)) {
      // Select phase: keep original order
      return '[{"idx": 0, "reason": "hero"}, {"idx": 1, "reason": "footer"}]';
    }
    const m = prompt.match(/"copyBlocks":\s*(\[[\s\S]*?\])/);
    if (!m) return '{"copy":{}}';
    const blocks = JSON.parse(m[1]) as Array<{ id: string }>;
    const copy: Record<string, string> = {};
    for (const b of blocks) copy[b.id] = `NOVA-${b.id}`;
    return JSON.stringify({ copy });
  };
}

test('compose rewrites every section via LLM and writes index+manifest', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-orch-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-orch-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm: makeRewriteLLM(),
    launchServer: false,
  });

  assert.ok(fs.existsSync(result.indexPath));
  assert.ok(fs.existsSync(result.manifestPath));
  const html = fs.readFileSync(result.indexPath, 'utf-8');
  assert.ok(html.includes('NOVA-'), 'no NOVA-* marker — rewrite did not apply');
  assert.ok(html.includes('</html>'));
  assert.strictEqual(result.sections.length, 2);
  assert.ok(result.sections.every((s) => s.outcome === 'llm'));
});

test('compose falls back to deterministic brand swap when LLM throws every retry', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-fb-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-fb-out-'));

  const failingLLM: LLMCall = async () => {
    throw new Error('boom');
  };

  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm: failingLLM,
    launchServer: false,
    maxRetries: 2,
  });

  assert.strictEqual(result.sections.length, 2);
  assert.ok(result.sections.every((s) => s.outcome === 'fallback-rebrand'));
  for (const s of result.sections) {
    assert.ok(s.llmErrors.length >= 2, 'each failure attempt should be recorded');
  }
});

test('compose manifest records outcome, attempts, size, and validation', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-mf-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-mf-out-'));

  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm: makeRewriteLLM(),
    launchServer: false,
  });

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8'));
  assert.strictEqual(manifest.base_site, 'source.com');
  assert.strictEqual(manifest.brand_name, 'Nova');
  assert.strictEqual(manifest.sections.length, 2);
  for (const s of manifest.sections) {
    assert.ok(['llm', 'fallback-rebrand', 'unchanged'].includes(s.outcome));
    assert.strictEqual(typeof s.attempts, 'number');
    assert.strictEqual(typeof s.original_size, 'number');
    assert.ok(Array.isArray(s.llm_errors));
  }
});

test('compose skipSelect uses deterministic fallback selection', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-skip-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-skip-out-'));

  // LLM that throws on select; we use skipSelect to bypass it.
  let selectCalled = false;
  const llm: LLMCall = async ({ prompt }) => {
    if (/CANDIDATS\s*:/i.test(prompt)) {
      selectCalled = true;
      throw new Error('should not be called');
    }
    const m = prompt.match(/"copyBlocks":\s*(\[[\s\S]*?\])/);
    if (!m) return '{"copy":{}}';
    const blocks = JSON.parse(m[1]) as Array<{ id: string }>;
    return JSON.stringify({ copy: Object.fromEntries(blocks.map((b) => [b.id, 'N'])) });
  };

  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm,
    skipSelect: true,
    launchServer: false,
  });

  assert.strictEqual(selectCalled, false);
  assert.strictEqual(result.sections.length, 2);
});

test('fallbackBrandSwap replaces repeated source tokens with brandName', () => {
  const html =
    '<html><head><title>Acme — industry</title></head><body><h1>Acme is great</h1><p>About Acme.</p><script>var Acme = 1;</script></body></html>';
  const out = fallbackBrandSwap(html, 'Nova', 'hero');
  assert.ok(out.includes('Nova is great'));
  assert.ok(out.includes('About Nova'));
  assert.ok(out.includes('<title>Nova'));
  // Script content NEVER rewritten
  assert.ok(out.includes('var Acme = 1'));
});
