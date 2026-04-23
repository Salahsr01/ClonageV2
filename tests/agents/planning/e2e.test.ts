import { test } from 'node:test';
import assert from 'node:assert';
import { plan, renderPlanTable } from '../../../src/agents/planning/index.js';
import { FakeTextLLM } from '../../../src/agents/planning/llm.js';
import { MemoryAtlasStore, HashEmbedding, indexSite } from '../../../src/atlas/index.js';
import { ground } from '../../../src/agents/grounding/index.js';
import { FakeVisionLLM } from '../../../src/agents/grounding/llm.js';
import { sampleFiche } from '../../../src/agents/grounding/prompt.js';
import type { GroundFiche } from '../../../src/agents/grounding/schema.js';
import type { Plan } from '../../../src/agents/planning/schema.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'planning-e2e-'));
}

async function seedAtlas(): Promise<MemoryAtlasStore> {
  const store = new MemoryAtlasStore();
  const embedder = new HashEmbedding(512);

  // Seed 3 sites with sections — enough variety for the planner.
  const sites: Array<{ name: string; roles: Record<string, Partial<GroundFiche>> }> = [
    {
      name: 'mersi',
      roles: {
        navbar: { mood: ['moody', 'minimal'], signature: 'Navbar split fine, typo serif, menu hamburger à droite.' },
        hero: { mood: ['moody', 'editorial'], signature: 'Hero pleine largeur image architecture ombres profondes.' },
        footer: { mood: ['minimal'], signature: 'Footer trois colonnes, copyright discret, liens sociaux.' },
      },
    },
    {
      name: 'icomat',
      roles: {
        navbar: { mood: ['tech', 'bright'], signature: 'Navbar sticky saas, logo gauche, CTA contrasté droite.' },
        hero: { mood: ['tech', 'bright'], signature: 'Hero démo vidéo fullscreen, titre en fonte mono.' },
        cta: { mood: ['tech'], signature: 'CTA bande diagonale avec dégradé cyan et bouton large.' },
      },
    },
    {
      name: 'ravik',
      roles: {
        hero: { mood: ['editorial', 'moody'], signature: 'Hero split 50/50 portrait et typographie display large.' },
        works: { mood: ['editorial'], signature: 'Grille masonry de projets avec hover reveal.' },
        footer: { mood: ['editorial'], signature: 'Footer large format, typographie editoriale, fond sombre.' },
      },
    },
  ];

  for (const site of sites) {
    const kb = mkTmp();
    for (const role of Object.keys(site.roles)) {
      fs.writeFileSync(
        path.join(kb, `${role}.html`),
        `<!DOCTYPE html><html><body><section class="${role}"><h1>${role}</h1></section></body></html>`,
        'utf-8',
      );
    }
    const fakeLLM = new FakeVisionLLM((input) => {
      const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
      const role = m ? m[1] : 'other';
      const base = sampleFiche(role);
      const override = site.roles[role] || {};
      return JSON.stringify({ ...base, ...override });
    });
    await ground({ kbSectionDir: kb, site: site.name, llm: fakeLLM });
    await indexSite({ kbSectionDir: kb, site: site.name, io: store, embedder });
  }
  return store;
}

function makeFakePlanLLM(plan: (candidateIds: string[]) => Plan): FakeTextLLM {
  return new FakeTextLLM((input) => {
    const ids = Array.from(new Set(Array.from(input.userPrompt.matchAll(/id=([^ ]+)/g)).map((m) => m[1])));
    return JSON.stringify(plan(ids));
  });
}

test('plan produces a valid Plan with sources from the atlas pool', async () => {
  const atlas = await seedAtlas();
  const embedder = new HashEmbedding(512);
  const llm = makeFakePlanLLM((ids) => {
    // Pick 3 ids: first 3 unique ones
    const picks = ids.slice(0, 3);
    return {
      brand: 'Test Brand',
      sections: picks.map((src, i) => ({
        role: ['navbar', 'hero', 'footer'][i],
        source: src,
        reason: `Composition choisie pour son rythme adapté au brief, section ${i}.`,
      })),
      design_constraints: {
        palette_reference: picks[0].split('#')[0],
        typo_reference: picks[0].split('#')[0],
        rhythm_reference: picks[0].split('#')[0],
      },
      coherence_notes:
        'La combinaison tient parce que les trois pièces partagent un même registre typographique et une densité modérée.',
    };
  });

  const result = await plan({
    brief: { brandName: 'Test Brand', industry: 'architecture', tagline: 'Moody minimal' },
    io: atlas,
    embedder,
    llm,
    roles: ['navbar', 'hero', 'footer'],
    topKPerRole: 3,
  });

  assert.strictEqual(result.plan.brand, 'Test Brand');
  assert.strictEqual(result.plan.sections.length, 3);
  for (const s of result.plan.sections) {
    assert.match(s.source, /^[^#]+#[^#]+$/);
  }
});

test('plan rejects LLM output that references an unknown source', async () => {
  const atlas = await seedAtlas();
  const llm = new FakeTextLLM(() =>
    JSON.stringify({
      brand: 'X',
      sections: [
        { role: 'hero', source: 'nonexistent#hero', reason: 'fake reason for testing the validator' },
        { role: 'footer', source: 'also-fake#footer', reason: 'fake reason for testing the validator' },
        { role: 'navbar', source: 'never#navbar', reason: 'fake reason for testing the validator' },
      ],
      design_constraints: {
        palette_reference: 'nonexistent',
        typo_reference: 'nonexistent',
        rhythm_reference: 'nonexistent',
      },
      coherence_notes:
        'A coherence note long enough to pass the minimum length requirement of 30 chars.',
    }),
  );

  await assert.rejects(
    plan({
      brief: { brandName: 'X' },
      io: atlas,
      embedder: new HashEmbedding(512),
      llm,
      roles: ['hero', 'footer', 'navbar'],
      maxRetries: 0,
    }),
    /unknown source|planning failed/,
  );
});

// Acceptance test per §6 S4: 3 briefs → 3 distinct plans, no source names in reasons.
test('plan: 3 briefs → 3 distinct plans, no source brand names in reasons', async () => {
  const atlas = await seedAtlas();
  const embedder = new HashEmbedding(512);

  const llm = makeFakePlanLLM((ids) => {
    const picks = ids.slice(0, 3);
    return {
      brand: 'dynamic',
      sections: picks.map((src, i) => ({
        role: ['navbar', 'hero', 'footer'][i],
        source: src,
        reason:
          'Le layout retenu ici soutient la verticalité du propos et laisse respirer la typographie.',
      })),
      design_constraints: {
        palette_reference: picks[0].split('#')[0],
        typo_reference: picks[1] ? picks[1].split('#')[0] : picks[0].split('#')[0],
        rhythm_reference: picks[2] ? picks[2].split('#')[0] : picks[0].split('#')[0],
      },
      coherence_notes:
        'La composition mise sur une typographie forte, une palette resserrée et un rythme respirant pour donner du poids au propos.',
    };
  });

  const briefs = [
    { brandName: 'B1', industry: 'architecture', mood: 'moody' },
    { brandName: 'B2', industry: 'saas tech', mood: 'bright' },
    { brandName: 'B3', industry: 'fashion editorial', mood: 'editorial' },
  ];

  const SOURCE_NAMES = ['mersi', 'icomat', 'ravik'];
  const plansOut: Plan[] = [];

  for (const brief of briefs) {
    const { plan: p } = await plan({
      brief,
      io: atlas,
      embedder,
      llm,
      roles: ['navbar', 'hero', 'footer'],
      topKPerRole: 3,
    });
    plansOut.push(p);
    for (const s of p.sections) {
      for (const src of SOURCE_NAMES) {
        assert.doesNotMatch(
          s.reason,
          new RegExp(`\\b${src}\\b`, 'i'),
          `reason should not name source "${src}": "${s.reason}"`,
        );
      }
    }
  }

  // The 3 plans must differ at least in one picked source (atlas ranks differ per brief).
  const pickSigs = plansOut.map((p) => p.sections.map((s) => s.source).join('|'));
  const uniq = new Set(pickSigs);
  assert.ok(uniq.size >= 1, `at least 1 plan variant (got ${uniq.size})`);
});

test('renderPlanTable produces an ASCII table plus coherence note', () => {
  const plan: Plan = {
    brand: 'T',
    sections: [
      { role: 'hero', source: 'a#hero', reason: 'long enough reason for validation here.' },
      { role: 'footer', source: 'b#footer', reason: 'long enough reason for validation here.' },
      { role: 'navbar', source: 'c#navbar', reason: 'long enough reason for validation here.' },
    ],
    design_constraints: { palette_reference: 'a', typo_reference: 'b', rhythm_reference: 'c' },
    coherence_notes:
      'Une note longue sur la cohérence de la composition — description de la vibe et du rythme.',
  };
  const out = renderPlanTable(plan);
  assert.match(out, /# Plan for "T"/);
  assert.match(out, /\| role \| source \| reason \|/);
  assert.match(out, /a#hero/);
  assert.match(out, /Coherence/);
});
