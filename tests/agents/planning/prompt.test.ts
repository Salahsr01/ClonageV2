import { test } from 'node:test';
import assert from 'node:assert';
import {
  formatCandidates,
  buildPlanningPrompt,
  parsePlanJson,
} from '../../../src/agents/planning/prompt.js';
import { sampleFiche } from '../../../src/agents/grounding/prompt.js';
import type { AtlasHit } from '../../../src/atlas/index.js';

function mkHit(id: string, role: string): AtlasHit {
  return {
    score: 0.9,
    entry: {
      id,
      site: id.split('#')[0],
      role,
      source_html: '/tmp/x.html',
      fiche: sampleFiche(role),
      embedder_id: 'hash-trigram:256',
      vector: [0.1, 0.2],
    },
  };
}

test('formatCandidates renders one line per hit with id + mood + signature', () => {
  const text = formatCandidates({
    hero: [mkHit('mersi#hero', 'hero'), mkHit('icomat#hero', 'hero')],
    footer: [mkHit('ravik#footer', 'footer')],
  });
  assert.match(text, /## role: hero/);
  assert.match(text, /id=mersi#hero/);
  assert.match(text, /id=icomat#hero/);
  assert.match(text, /## role: footer/);
  assert.match(text, /id=ravik#footer/);
});

test('buildPlanningPrompt includes the brief as JSON and the candidate block', () => {
  const brief = { brandName: 'Nova', industry: 'aerospace' };
  const prompt = buildPlanningPrompt(brief, '## role: hero\n- id=a#hero');
  assert.match(prompt, /"brandName": "Nova"/);
  assert.match(prompt, /## role: hero/);
  assert.match(prompt, /site#role/);
});

test('parsePlanJson strips markdown fences', () => {
  const out = parsePlanJson('```json\n{"brand":"X","sections":[]}\n```');
  assert.deepStrictEqual(out, { brand: 'X', sections: [] });
});

test('parsePlanJson grabs balanced braces when LLM adds prose', () => {
  const out = parsePlanJson('Here is my plan:\n\n{"brand":"Y"}\n\nI hope this helps!');
  assert.deepStrictEqual(out, { brand: 'Y' });
});
