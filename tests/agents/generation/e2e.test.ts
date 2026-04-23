import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cheerio from 'cheerio';

import { generate } from '../../../src/agents/generation/index.js';
import { FakeTextLLM } from '../../../src/agents/planning/llm.js';
import { ground } from '../../../src/agents/grounding/index.js';
import { FakeVisionLLM } from '../../../src/agents/grounding/llm.js';
import { sampleFiche } from '../../../src/agents/grounding/prompt.js';
import { indexSite, HashEmbedding, MemoryAtlasStore } from '../../../src/atlas/index.js';
import type { Plan } from '../../../src/agents/planning/schema.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-e2e-'));
}

/**
 * Build a self-contained KB with 2 sites × 3 sections each, feeding the
 * .clonage-kb/sections/<site>/<role>.html layout that loadSectionBySourceId
 * expects.
 */
async function buildKB(
  kbRoot: string,
  site: string,
  sections: Record<string, string>,
): Promise<MemoryAtlasStore> {
  const sectionDir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(sectionDir, { recursive: true });
  for (const [role, html] of Object.entries(sections)) {
    fs.writeFileSync(path.join(sectionDir, `${role}.html`), html, 'utf-8');
  }
  const fakeLLM = new FakeVisionLLM((input) => {
    const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
    const role = m ? m[1] : 'other';
    return JSON.stringify(sampleFiche(role));
  });
  await ground({ kbSectionDir: sectionDir, site, llm: fakeLLM });
  const atlas = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: sectionDir, site, io: atlas, embedder });
  return atlas;
}

function makePlan(sources: Array<{ role: string; source: string }>, paletteRef: string): Plan {
  return {
    brand: 'Test',
    sections: sources.map((s) => ({
      role: s.role,
      source: s.source,
      reason: 'long enough reason for validation pass in schema test',
    })),
    design_constraints: {
      palette_reference: paletteRef,
      typo_reference: paletteRef,
      rhythm_reference: paletteRef,
    },
    coherence_notes:
      'A coherence notes string at least 30 chars long to pass validation cleanly.',
  };
}

test('generate: preserves ALL scripts across sections (§6 S5 criterion)', async () => {
  const kb = mkTmp();
  const atlas = await buildKB(kb, 'alpha', {
    hero: '<html><head><script>var h=1;</script><style>@keyframes f{from{opacity:0}to{opacity:1}}</style></head><body><section class="hero"><h1>Hero</h1></section></body></html>',
  });
  await buildKB(kb, 'beta', {
    footer:
      '<html><head><script>var g=2;</script></head><body><footer><script>var f=3;</script>Footer</footer></body></html>',
  });
  // Merge atlas indexes for both sites
  const atlas2 = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'alpha'), site: 'alpha', io: atlas2, embedder });
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'beta'), site: 'beta', io: atlas2, embedder });

  const outDir = mkTmp();
  const plan = makePlan(
    [
      { role: 'hero', source: 'alpha#hero' },
      { role: 'footer', source: 'beta#footer' },
    ],
    'alpha',
  );
  const res = await generate({
    plan,
    brief: { brandName: 'Test' },
    outputDir: outDir,
    kbRoot: kb,
    io: atlas2,
    rewriteText: false,
  });

  const html = fs.readFileSync(res.outputHtml, 'utf-8');
  assert.match(html, /var h=1/);
  assert.match(html, /var g=2/);
  assert.match(html, /var f=3/);
  assert.match(html, /@keyframes f/);
});

test('generate: output contains every section from the plan (§6 S5)', async () => {
  const kb = mkTmp();
  await buildKB(kb, 'x', {
    hero: '<html><body><section data-section="hero">HERO-BLOCK</section></body></html>',
    about: '<html><body><section data-section="about">ABOUT-BLOCK</section></body></html>',
    cta: '<html><body><section data-section="cta">CTA-BLOCK</section></body></html>',
  });
  const atlas = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'x'), site: 'x', io: atlas, embedder });

  const plan = makePlan(
    [
      { role: 'hero', source: 'x#hero' },
      { role: 'about', source: 'x#about' },
      { role: 'cta', source: 'x#cta' },
    ],
    'x',
  );
  const outDir = mkTmp();
  const res = await generate({
    plan,
    brief: { brandName: 'T' },
    outputDir: outDir,
    kbRoot: kb,
    io: atlas,
    rewriteText: false,
  });

  const html = fs.readFileSync(res.outputHtml, 'utf-8');
  assert.match(html, /HERO-BLOCK/);
  assert.match(html, /ABOUT-BLOCK/);
  assert.match(html, /CTA-BLOCK/);
});

test('generate: fingerprint DOM ±5% per section vs source (§6 S5)', async () => {
  const kb = mkTmp();
  const heroHtml =
    '<html><head></head><body><section class="hero">' +
    '<h1>Title</h1>' +
    '<p>Body paragraph</p>' +
    '<p>Another paragraph</p>' +
    '<button>Click</button>' +
    '</section></body></html>';
  await buildKB(kb, 'src', { hero: heroHtml });
  const atlas = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'src'), site: 'src', io: atlas, embedder });

  const sourceDom = cheerio.load(heroHtml);
  const sourceNodes = sourceDom('*').length;

  const plan = makePlan([{ role: 'hero', source: 'src#hero' }], 'src');
  const outDir = mkTmp();
  const res = await generate({
    plan,
    brief: { brandName: 'T' },
    outputDir: outDir,
    kbRoot: kb,
    io: atlas,
    rewriteText: false,
  });

  const fp = res.fingerprints.find((f) => f.role === 'hero');
  assert.ok(fp, 'hero fingerprint present');
  const ratio = Math.abs(fp!.nodes - sourceNodes) / sourceNodes;
  assert.ok(ratio <= 0.05, `fingerprint node delta should be ≤5%, got ${(ratio * 100).toFixed(1)}%`);
});

test('generate: rewriteText=true mutates text nodes via fake TextLLM', async () => {
  const kb = mkTmp();
  await buildKB(kb, 'src', {
    hero: '<html><body><h1>Welcome</h1><p>Great stuff</p></body></html>',
  });
  const atlas = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'src'), site: 'src', io: atlas, embedder });

  const llm = new FakeTextLLM((input) => {
    const ids = Array.from(input.userPrompt.matchAll(/^(c\d+):/gm)).map((m) => m[1]);
    return JSON.stringify(Object.fromEntries(ids.map((id) => [id, 'REWRITTEN'])));
  });

  const plan = makePlan([{ role: 'hero', source: 'src#hero' }], 'src');
  const outDir = mkTmp();
  const res = await generate({
    plan,
    brief: { brandName: 'Nova' },
    outputDir: outDir,
    kbRoot: kb,
    io: atlas,
    llm,
    rewriteText: true,
  });
  const html = fs.readFileSync(res.outputHtml, 'utf-8');
  assert.match(html, /REWRITTEN/);
  assert.doesNotMatch(html, /Welcome/);
  const td = res.report.textDiff.find((t) => t.role === 'hero');
  assert.ok(td);
  assert.ok(td!.applied >= 1);
});

test('generate: writes _generation.json report next to index.html', async () => {
  const kb = mkTmp();
  await buildKB(kb, 'src', { hero: '<html><body><h1>h</h1></body></html>' });
  const atlas = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'src'), site: 'src', io: atlas, embedder });

  const plan = makePlan([{ role: 'hero', source: 'src#hero' }], 'src');
  const outDir = mkTmp();
  await generate({
    plan,
    brief: { brandName: 'X' },
    outputDir: outDir,
    kbRoot: kb,
    io: atlas,
    rewriteText: false,
  });
  const reportPath = path.join(outDir, '_generation.json');
  assert.ok(fs.existsSync(reportPath));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  assert.strictEqual(report.plan.brand, 'Test');
  assert.ok(Array.isArray(report.fingerprints));
});
