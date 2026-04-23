import { test } from 'node:test';
import assert from 'node:assert';
import {
  selectSections,
  selectSectionsFallback,
  SelectParseError,
} from '../../src/compose/select.js';
import type { SelectCandidate } from '../../src/compose/select.js';

const BRIEF = { brandName: 'Nova', industry: 'aerospace' };

const CANDIDATES: SelectCandidate[] = [
  { site: 'a.com', role: 'hero', text_excerpt: 'Big hero', has_animation: true },
  { site: 'a.com', role: 'footer', text_excerpt: 'Small footer' },
  { site: 'b.com', role: 'cta', text_excerpt: 'Call now', has_animation: true },
  { site: 'b.com', role: 'about', text_excerpt: 'Our story' },
];

test('selectSections parses LLM JSON array into ordered selections', async () => {
  const llm = async () => JSON.stringify([
    { idx: 0, reason: 'animated hero' },
    { idx: 2, reason: 'CTA matches brand voice' },
  ]);
  const sel = await selectSections(BRIEF, CANDIDATES, llm);
  assert.strictEqual(sel.length, 2);
  assert.strictEqual(sel[0].role, 'hero');
  assert.strictEqual(sel[1].role, 'cta');
  assert.strictEqual(sel[0].site, 'a.com');
});

test('selectSections silently drops out-of-range idx', async () => {
  const llm = async () => JSON.stringify([
    { idx: 99, reason: 'bogus' },
    { idx: 1, reason: 'footer' },
  ]);
  const sel = await selectSections(BRIEF, CANDIDATES, llm);
  assert.strictEqual(sel.length, 1);
  assert.strictEqual(sel[0].role, 'footer');
});

test('selectSections throws on unparseable response', async () => {
  const llm = async () => 'not json';
  await assert.rejects(selectSections(BRIEF, CANDIDATES, llm), SelectParseError);
});

test('selectSections with empty candidate list is a no-op', async () => {
  const llm = async () => 'will not be called';
  const sel = await selectSections(BRIEF, [], llm);
  assert.deepStrictEqual(sel, []);
});

test('selectSectionsFallback orders by narrative heuristic', () => {
  const sel = selectSectionsFallback(CANDIDATES, 6);
  // hero before cta before about before footer
  const order = sel.map((s) => s.role);
  assert.strictEqual(order[0], 'hero');
  assert.ok(order.indexOf('cta') < order.indexOf('footer'));
  assert.ok(order.indexOf('about') < order.indexOf('footer'));
});

test('selectSectionsFallback respects targetCount', () => {
  const sel = selectSectionsFallback(CANDIDATES, 2);
  assert.strictEqual(sel.length, 2);
});
