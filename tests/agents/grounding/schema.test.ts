import { test } from 'node:test';
import assert from 'node:assert';
import { GroundFicheSchema } from '../../../src/agents/grounding/schema.js';

test('GroundFicheSchema accepts a minimal valid fiche', () => {
  const fiche = {
    role: 'hero',
    mood: ['moody'],
    animations: [{ type: 'fade-in', library: 'gsap' }],
    palette_dominant: ['#000000', '#ffffff'],
    typo: { display: 'Inter', body: 'Inter', axes: [] },
    layout: { composition: 'fullscreen', density: 'airy' },
    signature: 'Hero fullscreen avec typographie brutale.',
    usable_as: ['hero'],
  };
  const parsed = GroundFicheSchema.parse(fiche);
  assert.strictEqual(parsed.role, 'hero');
  assert.ok(Array.isArray(parsed.mood));
});

test('GroundFicheSchema rejects empty mood', () => {
  assert.throws(() =>
    GroundFicheSchema.parse({
      role: 'hero',
      mood: [],
      animations: [],
      palette_dominant: ['#000'],
      typo: { display: 'Inter', body: 'Inter', axes: [] },
      layout: { composition: 'fullscreen', density: 'airy' },
      signature: 'Minimum length signature reached here.',
      usable_as: [],
    }),
  );
});

test('GroundFicheSchema rejects a too-short signature', () => {
  assert.throws(() =>
    GroundFicheSchema.parse({
      role: 'hero',
      mood: ['moody'],
      animations: [],
      palette_dominant: ['#000'],
      typo: { display: 'Inter', body: 'Inter', axes: [] },
      layout: { composition: 'fullscreen', density: 'airy' },
      signature: 'short',
      usable_as: [],
    }),
  );
});

test('GroundFicheSchema accepts 8 moods but rejects 9', () => {
  const base = {
    role: 'hero',
    animations: [],
    palette_dominant: ['#000'],
    typo: { display: 'Inter', body: 'Inter', axes: [] },
    layout: { composition: 'fullscreen', density: 'airy' },
    signature: 'Minimum length signature reached here.',
    usable_as: [],
  };
  assert.ok(GroundFicheSchema.parse({ ...base, mood: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }));
  assert.throws(() =>
    GroundFicheSchema.parse({ ...base, mood: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] }),
  );
});
