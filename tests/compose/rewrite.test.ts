import { test } from 'node:test';
import assert from 'node:assert';
import { rewriteSection, extractBodyContent } from '../../src/compose/rewrite.js';
import type { LoadedSection } from '../../src/compose/types.js';

function section(role: string, html: string, size = html.length): LoadedSection {
  return {
    meta: {
      role: role as any,
      file: `${role}.html`,
      size_bytes: size,
      has_animation: false,
      dominant_classes: [],
      text_excerpt: '',
      tags: [],
    },
    html,
    path: `/tmp/${role}.html`,
  };
}

const BRIEF = { brandName: 'Kuro', industry: 'design' };

test('rewriteSection returns original when LLM returns empty', async () => {
  const sec = section('hero', '<!DOCTYPE html><html><body><h1>Hi</h1></body></html>');
  const result = await rewriteSection(sec, BRIEF, 'source.com', async () => '');
  assert.strictEqual(result.usedLLM, false);
  assert.ok(result.bodyHtml.includes('<h1>Hi</h1>'));
});

test('rewriteSection applies JSON text-diff replacements', async () => {
  const sec = section('hero', '<!DOCTYPE html><html><body><h1>Old</h1></body></html>');
  const fake = async () => JSON.stringify([{ id: 0, newText: 'NEW' }]);
  const result = await rewriteSection(sec, BRIEF, 's', fake);
  assert.strictEqual(result.usedLLM, true);
  assert.ok(result.bodyHtml.includes('<h1>NEW</h1>'));
});

test('rewriteSection keeps original when JSON is invalid', async () => {
  const sec = section('hero', '<!DOCTYPE html><html><body><h1>X</h1></body></html>');
  const fake = async () => 'NOT JSON';
  const result = await rewriteSection(sec, BRIEF, 's', fake);
  assert.strictEqual(result.usedLLM, false);
  assert.ok(result.bodyHtml.includes('<h1>X</h1>'));
});

test('rewriteSection keeps script tags intact after rewrite', async () => {
  const sec = section(
    'hero',
    '<!DOCTYPE html><html><body><section><h1>Old</h1><script>window.__x=1</script></section></body></html>',
  );
  const fake = async () => JSON.stringify([{ id: 0, newText: 'Nova' }]);
  const result = await rewriteSection(sec, BRIEF, 's', fake);
  assert.strictEqual(result.usedLLM, true);
  assert.ok(result.bodyHtml.includes('window.__x=1'));
  assert.ok(result.bodyHtml.includes('<h1>Nova</h1>'));
});

test('extractBodyContent returns body inner when full document given', () => {
  const html = '<!DOCTYPE html><html><head><title>T</title></head><body><div>A</div><div>B</div></body></html>';
  const body = extractBodyContent(html);
  assert.ok(body.includes('<div>A</div>'));
  assert.ok(body.includes('<div>B</div>'));
  assert.ok(!body.includes('<title>'));
});

test('extractBodyContent returns the input when no body tag is present', () => {
  const fragment = '<section><h1>X</h1></section>';
  assert.strictEqual(extractBodyContent(fragment).trim(), fragment);
});
