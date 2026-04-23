import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { compose } from '../../src/pipeline-compose.js';
import { FakeTextLLM } from '../../src/agents/planning/llm.js';
import { ground } from '../../src/agents/grounding/index.js';
import { FakeVisionLLM } from '../../src/agents/grounding/llm.js';
import { sampleFiche } from '../../src/agents/grounding/prompt.js';
import { indexSite, MemoryAtlasStore, HashEmbedding } from '../../src/atlas/index.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
}

async function seedKB(kbRoot: string, site: string, sections: Record<string, string>) {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  for (const [role, html] of Object.entries(sections)) {
    fs.writeFileSync(path.join(dir, `${role}.html`), html, 'utf-8');
  }
  const fakeVLM = new FakeVisionLLM((input) => {
    const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
    const role = m ? m[1] : 'other';
    return JSON.stringify(sampleFiche(role));
  });
  await ground({ kbSectionDir: dir, site, llm: fakeVLM });
  return dir;
}

function makePlannerLLM(paletteSite = 'alpha'): FakeTextLLM {
  return new FakeTextLLM((input) => {
    const ids = Array.from(new Set(Array.from(input.userPrompt.matchAll(/id=([^ ]+)/g)).map((m) => m[1])));
    if (input.userPrompt.includes('Copy blocks to rewrite')) {
      // text-diff phase — return identity map
      const blockIds = Array.from(input.userPrompt.matchAll(/^(c\d+):/gm)).map((m) => m[1]);
      return JSON.stringify(Object.fromEntries(blockIds.map((id) => [id, 'rebranded copy'])));
    }
    // Planning phase — return a plan from the first available ids.
    const pick = (role: string) => ids.find((id) => id.endsWith(`#${role}`)) ?? ids[0];
    return JSON.stringify({
      brand: 'ComposeTest',
      sections: [
        { role: 'hero', source: pick('hero'), reason: 'Hero choisi pour son rythme vertical adapté.' },
        { role: 'about', source: pick('about') ?? pick('hero'), reason: 'About cohérent avec le propos central.' },
        { role: 'footer', source: pick('footer'), reason: 'Footer sobre cohérent avec le propos final.' },
      ],
      design_constraints: {
        palette_reference: paletteSite,
        typo_reference: paletteSite,
        rhythm_reference: paletteSite,
      },
      coherence_notes:
        'La combinaison tient par la typographie consistante et le rythme respirant des sections.',
    });
  });
}

test('compose: happy path (1 attempt, validator passes)', async () => {
  const kb = mkTmp();
  const heroHtml =
    '<html><head><script>var a=1;</script></head><body><section class="h"><h1>H</h1></section></body></html>';
  const footerHtml = '<html><body><footer>F</footer></body></html>';
  const aboutHtml = '<html><body><section class="a"><h2>About</h2></section></body></html>';
  await seedKB(kb, 'alpha', { hero: heroHtml, about: aboutHtml, footer: footerHtml });

  const store = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'alpha'), site: 'alpha', io: store, embedder });

  const llm = makePlannerLLM('alpha');
  const outDir = mkTmp();
  const res = await compose({
    brief: { brandName: 'ComposeTest' },
    outputDir: outDir,
    kbRoot: kb,
    io: store,
    embedder,
    textLLM: llm,
    maxRetries: 2,
  });

  assert.strictEqual(res.passed, true);
  assert.strictEqual(res.attempts, 1);
  assert.ok(res.outputHtml && fs.existsSync(res.outputHtml));
  const html = fs.readFileSync(res.outputHtml!, 'utf-8');
  assert.match(html, /var a=1/);
});

test('compose: planOnly stops after Planning', async () => {
  const kb = mkTmp();
  await seedKB(kb, 'a', {
    hero: '<html><body><h1>h</h1></body></html>',
    about: '<html><body><h2>a</h2></body></html>',
    footer: '<html><body><footer>f</footer></body></html>',
  });
  const store = new MemoryAtlasStore();
  const embedder = new HashEmbedding(256);
  await indexSite({ kbSectionDir: path.join(kb, 'sections', 'a'), site: 'a', io: store, embedder });

  const outDir = mkTmp();
  const res = await compose({
    brief: { brandName: 'P' },
    outputDir: outDir,
    kbRoot: kb,
    io: store,
    embedder,
    textLLM: makePlannerLLM('a'),
    planOnly: true,
  });
  assert.strictEqual(res.passed, true);
  assert.strictEqual(res.attempts, 1);
  assert.strictEqual(res.outputHtml, undefined);
  assert.ok(fs.existsSync(path.join(outDir, '_plan.json')));
});
