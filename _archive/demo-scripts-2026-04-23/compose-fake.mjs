// Full compose pipeline with Fake text LLM (no API key needed).
import * as fs from 'fs';
import { compose } from '../dist/pipeline-compose.js';
import { FakeTextLLM } from '../dist/agents/planning/llm.js';
import { JsonlAtlasStore, HashEmbedding } from '../dist/atlas/index.js';

const [, , briefPath, outputDir] = process.argv;
if (!briefPath || !outputDir) {
  console.error('usage: compose-fake.mjs <briefPath> <outputDir>');
  process.exit(1);
}

const brief = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));

// Fake Planning LLM: picks one id per role from the candidate pool, trying to
// diversify the palette/typo references across different sites.
const planner = new FakeTextLLM((input) => {
  // Text-diff phase detection: skip gracefully (we use rewriteText=false anyway).
  if (input.userPrompt.includes('Copy blocks to rewrite')) {
    const blockIds = Array.from(input.userPrompt.matchAll(/^(c\d+):/gm)).map((m) => m[1]);
    return JSON.stringify(Object.fromEntries(blockIds.map((id) => [id, 'Lumen Studio rebranded copy'])));
  }
  // Planning phase: parse candidates section by section.
  const roleBlocks = input.userPrompt.split(/## role: /).slice(1);
  const candidatesByRole = {};
  for (const block of roleBlocks) {
    const role = block.split('\n')[0].trim();
    const ids = Array.from(block.matchAll(/id=([^ ]+)/g)).map((m) => m[1]);
    if (ids.length > 0) candidatesByRole[role] = ids;
  }

  const chosen = [];
  const sitesUsed = new Set();
  for (const [role, ids] of Object.entries(candidatesByRole)) {
    // Prefer a source from a new site for diversity.
    const pick = ids.find((id) => !sitesUsed.has(id.split('#')[0])) ?? ids[0];
    sitesUsed.add(pick.split('#')[0]);
    chosen.push({
      role,
      source: pick,
      reason:
        `Choisi pour son rythme adapté et sa densité cohérente avec le brief. Les contrastes typographiques servent le propos moody.`,
    });
  }

  const siteList = [...sitesUsed];
  const designRefs = {
    palette_reference: siteList[0] ?? 'unknown',
    typo_reference: siteList[1] ?? siteList[0] ?? 'unknown',
    rhythm_reference: siteList[2] ?? siteList[0] ?? 'unknown',
  };

  return JSON.stringify({
    brand: brief.brandName,
    sections: chosen,
    design_constraints: designRefs,
    coherence_notes:
      "La composition fait dialoguer des sections aux moods proches mais issues de contextes différents. L'atmosphère reste homogène grâce à un même registre typographique et à une palette sobre verrouillée sur la référence. Le rythme vertical alterne respirations larges et blocs plus denses.",
  });
});

const embedder = new HashEmbedding(512);
const io = new JsonlAtlasStore('.clonage-kb/atlas.jsonl');

const res = await compose({
  brief,
  outputDir,
  io,
  embedder,
  textLLM: planner,
  maxRetries: 3,
});

console.log(`\n=== COMPOSE ${res.passed ? 'OK' : 'FAILED'} after ${res.attempts} attempt(s) ===`);
if (res.outputHtml) console.log(`Output: ${res.outputHtml}`);
if (res.failureReportPath) console.log(`Failure report: ${res.failureReportPath}`);
console.log(`Plan sections: ${res.plan.sections.map((s) => s.role + '←' + s.source).join(', ')}`);
