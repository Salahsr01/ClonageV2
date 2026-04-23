// Ground + index every site present in .clonage-kb/sections/
import * as fs from 'fs';
import * as path from 'path';
import { ground } from '../dist/agents/grounding/index.js';
import { FakeVisionLLM } from '../dist/agents/grounding/llm.js';
import { sampleFiche } from '../dist/agents/grounding/prompt.js';
import { indexSite, JsonlAtlasStore, HashEmbedding } from '../dist/atlas/index.js';

const kbRoot = '.clonage-kb/sections';
const sites = fs.readdirSync(kbRoot).filter((d) => fs.statSync(path.join(kbRoot, d)).isDirectory());

const llm = new FakeVisionLLM((input) => {
  const m = input.userPrompt.match(/tentative role "([^"]+)"/);
  const role = m ? m[1] : 'other';
  const fiche = sampleFiche(role);
  // Deterministic per-site mood overrides so planning picks differentiated sources.
  const siteFromPrompt = '';
  const lowered = role.toLowerCase();
  if (lowered.includes('nav') || lowered.includes('header')) fiche.mood = ['minimal'];
  else if (lowered.includes('footer')) fiche.mood = ['minimal', 'tech'];
  else if (lowered.includes('hero') || lowered === 'section-1') fiche.mood = ['bold', 'editorial'];
  else if (lowered.includes('contact') || lowered.includes('cta')) fiche.mood = ['playful'];
  return JSON.stringify(fiche);
});

const atlas = new JsonlAtlasStore('.clonage-kb/atlas.jsonl');
const embedder = new HashEmbedding(512);

let totalGrounded = 0;
let totalIndexed = 0;
for (const site of sites) {
  const dir = path.join(kbRoot, site);
  const sectionCount = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_')).length;
  if (sectionCount === 0) continue;
  console.log(`\n[ground] ${site} (${sectionCount} sections)`);
  const result = await ground({ kbSectionDir: dir, site, llm, force: true });
  totalGrounded += result.sections.length;
  console.log(`[index] ${site}`);
  const r = await indexSite({ kbSectionDir: dir, site, io: atlas, embedder, replaceForSite: true });
  totalIndexed += r.indexed;
}

console.log(`\n=== DONE: ${totalGrounded} grounded, ${totalIndexed} indexed across ${sites.length} sites ===`);
