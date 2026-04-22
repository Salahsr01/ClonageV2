import { test } from 'node:test';
import assert from 'node:assert';
import { buildSectionPrompt, buildTextDiffPrompt } from '../../src/compose/prompt.js';

const BRIEF = {
  brandName: 'Atelier Noma',
  industry: 'studio de design minimaliste',
  tagline: 'Formes brutes',
};

test('buildSectionPrompt includes brand, industry, tagline', () => {
  const p = buildSectionPrompt({
    brief: BRIEF,
    sectionRole: 'hero',
    sectionHtml: '<html><body><h1>Old title</h1></body></html>',
    sourceSite: 'www.source.com',
  });
  assert.ok(p.includes('Atelier Noma'));
  assert.ok(p.includes('studio de design minimaliste'));
  assert.ok(p.includes('Formes brutes'));
  assert.ok(p.includes('hero'));
});

test('buildSectionPrompt includes the section html verbatim', () => {
  const html = '<html><body><h1>ORIGINAL</h1></body></html>';
  const p = buildSectionPrompt({ brief: BRIEF, sectionRole: 'hero', sectionHtml: html, sourceSite: 'x' });
  assert.ok(p.includes('ORIGINAL'));
});

test('buildSectionPrompt instructs to keep structure + classes + scripts', () => {
  const p = buildSectionPrompt({ brief: BRIEF, sectionRole: 'hero', sectionHtml: '<html></html>', sourceSite: 'x' });
  assert.ok(/structure|classes|scripts/i.test(p), 'prompt should mention structural preservation');
});

test('buildSectionPrompt includes sector hint when given', () => {
  const p = buildSectionPrompt({
    brief: BRIEF,
    sectionRole: 'services',
    sectionHtml: '<html></html>',
    sourceSite: 'x',
    sector: 'architecture',
  });
  assert.ok(p.includes('architecture'));
});

test('buildTextDiffPrompt includes JSON-only constraints and text payload', () => {
  const p = buildTextDiffPrompt({
    brief: BRIEF,
    sectionRole: 'hero',
    sourceSite: 'x',
    texts: [
      { id: 0, text: 'Old title' },
      { id: 1, text: 'Old subtitle' },
    ],
  });
  assert.ok(p.includes('JSON valide'));
  assert.ok(p.includes('"id": 0'));
  assert.ok(p.includes('Old subtitle'));
});
