// Run the Grounding agent with FakeVisionLLM (no API key needed).
// Usage: node scripts/ground-fake.mjs <kbSectionDir> <siteName>

import { ground } from '../dist/agents/grounding/index.js';
import { FakeVisionLLM } from '../dist/agents/grounding/llm.js';
import { sampleFiche } from '../dist/agents/grounding/prompt.js';

const [, , kbSectionDir, site] = process.argv;
if (!kbSectionDir || !site) {
  console.error('usage: ground-fake.mjs <kbSectionDir> <siteName>');
  process.exit(1);
}

const llm = new FakeVisionLLM((input) => {
  const m = input.userPrompt.match(/tentative role "([^"]+)"/);
  const role = m ? m[1] : 'other';
  const fiche = sampleFiche(role);
  // Give more realistic-looking moods per role inferred from path.
  if (role.startsWith('nav')) fiche.mood = ['minimal', 'tech'];
  if (role.startsWith('section')) fiche.mood = ['bold', 'editorial'];
  return JSON.stringify(fiche);
});

const result = await ground({ kbSectionDir, site, llm, force: true });
console.log(`Grounded ${result.sections.length} section(s):`);
for (const s of result.sections) {
  console.log(`  ${s.role.padEnd(16)} → ${s.sidecarPath}`);
}
