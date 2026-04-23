import { test } from 'node:test';
import assert from 'node:assert';
import { PlanSchema } from '../../../src/agents/planning/schema.js';

const validPlan = {
  brand: 'Nova Aerospace',
  sections: [
    { role: 'navbar', source: 'mersi#nav', reason: 'Navigation minimaliste et pleine largeur matche le ton aérospatial.' },
    { role: 'hero', source: 'icomat#hero', reason: 'Hero vidéo fullscreen établit l échelle de la mission dès l ouverture.' },
    { role: 'footer', source: 'ravik#footer', reason: 'Footer éditorial rappelle le positionnement haut de gamme.' },
  ],
  design_constraints: {
    palette_reference: 'mersi',
    typo_reference: 'icomat',
    rhythm_reference: 'ravik',
  },
  coherence_notes: 'La combinaison joue sur un contraste palette sobre / typo technique / rythme éditorial, sans dissonance.',
};

test('PlanSchema accepts a valid plan', () => {
  const parsed = PlanSchema.parse(validPlan);
  assert.strictEqual(parsed.sections.length, 3);
});

test('PlanSchema rejects source without site#role format', () => {
  const bad = structuredClone(validPlan);
  bad.sections[0].source = 'mersi-nav';
  assert.throws(() => PlanSchema.parse(bad));
});

test('PlanSchema rejects fewer than 3 sections', () => {
  const bad = structuredClone(validPlan);
  bad.sections = bad.sections.slice(0, 2);
  assert.throws(() => PlanSchema.parse(bad));
});

test('PlanSchema rejects too-short coherence_notes', () => {
  const bad = structuredClone(validPlan);
  bad.coherence_notes = 'too short';
  assert.throws(() => PlanSchema.parse(bad));
});
