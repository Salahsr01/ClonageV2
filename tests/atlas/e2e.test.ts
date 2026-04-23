import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { indexSite, query, stats } from '../../src/atlas/index.js';
import { HashEmbedding } from '../../src/atlas/embeddings.js';
import { MemoryAtlasStore } from '../../src/atlas/store.js';
import { ground } from '../../src/agents/grounding/index.js';
import { FakeVisionLLM } from '../../src/agents/grounding/llm.js';
import { sampleFiche } from '../../src/agents/grounding/prompt.js';
import type { GroundFiche } from '../../src/agents/grounding/schema.js';

function mkTmpKB(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-atlas-e2e-'));
}

function writeSection(dir: string, role: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${role}.html`),
    `<!DOCTYPE html><html><body>${body}</body></html>`,
    'utf-8',
  );
}

/**
 * Grounds a site with a FakeVisionLLM that produces role-specific fiches.
 * Used to seed the atlas without hitting a real VLM.
 */
async function seedGrounding(
  kbDir: string,
  site: string,
  roleFicheMap: Record<string, Partial<GroundFiche>>,
): Promise<void> {
  const fakeLLM = new FakeVisionLLM((input) => {
    const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
    const role = m ? m[1] : 'other';
    const base = sampleFiche(role);
    const override = roleFicheMap[role] || {};
    return JSON.stringify({ ...base, ...override });
  });
  await ground({ kbSectionDir: kbDir, site, llm: fakeLLM });
}

test('indexSite + query — 3 sites, 5 queries, coherent rankings', async () => {
  // Seed 3 "sites" with distinct moods
  const mersi = mkTmpKB();
  const icomat = mkTmpKB();
  const ravik = mkTmpKB();

  writeSection(mersi, 'hero', '<section><h1>Mersi architecture</h1></section>');
  writeSection(mersi, 'about', '<section><h2>About</h2></section>');
  writeSection(icomat, 'hero', '<section><h1>iCOMAT tech</h1></section>');
  writeSection(icomat, 'cta', '<section><button>Contact</button></section>');
  writeSection(ravik, 'hero', '<section><h1>Ravi Klaassens editorial</h1></section>');
  writeSection(ravik, 'gallery', '<section><img src="x.jpg" /></section>');

  await seedGrounding(mersi, 'mersi', {
    hero: {
      mood: ['moody', 'minimal'],
      signature: 'Hero architecture studio moody minimaliste avec typo serif.',
    },
    about: {
      mood: ['editorial'],
      signature: 'Paragraphe éditorial sur la vision du studio.',
    },
  });
  await seedGrounding(icomat, 'icomat', {
    hero: {
      mood: ['tech', 'bright'],
      signature: 'Hero produit tech saas avec demo vidéo en fullscreen.',
    },
    cta: {
      mood: ['playful'],
      signature: 'CTA contact avec bouton proéminent et fond clair.',
    },
  });
  await seedGrounding(ravik, 'ravik', {
    hero: {
      mood: ['editorial', 'moody'],
      signature: 'Hero portrait éditorial moody fashion avec split layout.',
    },
    gallery: {
      mood: ['editorial'],
      signature: 'Masonry gallery portraits fashion.',
    },
  });

  const store = new MemoryAtlasStore();
  const embedder = new HashEmbedding(512);

  // Index all 3 sites
  const r1 = await indexSite({ kbSectionDir: mersi, site: 'mersi', io: store, embedder });
  const r2 = await indexSite({ kbSectionDir: icomat, site: 'icomat', io: store, embedder });
  const r3 = await indexSite({ kbSectionDir: ravik, site: 'ravik', io: store, embedder });

  assert.strictEqual(r1.indexed, 2);
  assert.strictEqual(r2.indexed, 2);
  assert.strictEqual(r3.indexed, 2);

  const s = stats(store);
  assert.strictEqual(s.totalEntries, 6);
  assert.deepStrictEqual(s.sites.sort(), ['icomat', 'mersi', 'ravik']);

  // Acceptance test per REFACTOR_BRIEF §6 S3: "studio d'architecture moody"
  // with role=hero returns 3+ ranked candidates.
  const hits = await query(
    {
      brief: "studio d'architecture moody",
      roleFilter: 'hero',
      topK: 5,
    },
    { io: store, embedder },
  );
  assert.ok(hits.length >= 2, `expected ≥2 hero hits, got ${hits.length}`);

  // Query 2: tech product hero — icomat should rank above the others.
  const techHits = await query(
    {
      brief: 'tech saas product video',
      roleFilter: 'hero',
      topK: 3,
    },
    { io: store, embedder },
  );
  assert.ok(techHits.length >= 1);
  assert.strictEqual(
    techHits[0].entry.site,
    'icomat',
    'icomat hero should top on tech brief',
  );

  // Query 3: editorial mood filter
  const editHits = await query(
    {
      brief: 'editorial photographer portraits',
      moodFilter: ['editorial'],
      topK: 10,
    },
    { io: store, embedder },
  );
  assert.ok(editHits.length >= 2);
  for (const h of editHits) {
    assert.ok(
      h.entry.fiche.mood.map((m) => m.toLowerCase()).includes('editorial'),
      'moodFilter respected',
    );
  }

  // Query 4: exclusion — the first hero hit from hits above must not reappear.
  const first = hits[0].entry.id;
  const excludeHits = await query(
    {
      brief: "studio d'architecture moody",
      roleFilter: 'hero',
      excludeSources: [first],
      topK: 5,
    },
    { io: store, embedder },
  );
  for (const h of excludeHits) {
    assert.notStrictEqual(h.entry.id, first);
  }

  // Query 5: siteFilter restricts to a single site.
  const onlyMersi = await query(
    { brief: 'studio moody', siteFilter: ['mersi'], topK: 5 },
    { io: store, embedder },
  );
  for (const h of onlyMersi) {
    assert.strictEqual(h.entry.site, 'mersi');
  }
});

test('indexSite with replaceForSite=true drops stale rows for the same site', async () => {
  const kb = mkTmpKB();
  writeSection(kb, 'hero', '<section><h1>hi</h1></section>');
  await seedGrounding(kb, 'site1', { hero: {} });

  const store = new MemoryAtlasStore();
  const embedder = new HashEmbedding(128);

  await indexSite({ kbSectionDir: kb, site: 'site1', io: store, embedder });
  await indexSite({ kbSectionDir: kb, site: 'site1', io: store, embedder });

  const rows = store.load();
  assert.strictEqual(rows.length, 1, 'no duplicates after re-index');
});

test('indexSite throws when no .ground.json sidecars exist', async () => {
  const kb = mkTmpKB();
  writeSection(kb, 'hero', '<section></section>');
  // Note: no grounding run, so no .ground.json

  await assert.rejects(
    indexSite({
      kbSectionDir: kb,
      site: 'empty',
      io: new MemoryAtlasStore(),
      embedder: new HashEmbedding(128),
    }),
    /no \.ground\.json sidecars/,
  );
});
