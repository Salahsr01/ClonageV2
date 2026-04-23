import { test } from 'node:test';
import assert from 'node:assert';
import { extractCopyBlocks, applyRewrites, textDiff } from '../../../src/agents/generation/text-diff.js';
import { FakeTextLLM } from '../../../src/agents/planning/llm.js';

test('extractCopyBlocks finds visible text, skips scripts and styles', () => {
  const html =
    '<section><h1>Hello</h1><p>World</p><script>var secret = 1</script><style>.a{color:red}</style></section>';
  const { blocks } = extractCopyBlocks(html);
  const texts = blocks.map((b) => b.original);
  assert.ok(texts.includes('Hello'));
  assert.ok(texts.includes('World'));
  assert.ok(!texts.some((t) => t.includes('secret')));
  assert.ok(!texts.some((t) => t.includes('color:red')));
});

test('extractCopyBlocks assigns stable incremental ids', () => {
  const html = '<section><h1>A</h1><p>B</p><p>C</p></section>';
  const { blocks } = extractCopyBlocks(html);
  assert.deepStrictEqual(
    blocks.map((b) => b.id),
    ['c0', 'c1', 'c2'],
  );
});

test('applyRewrites updates text nodes in place while preserving whitespace', () => {
  const html = '<p>  Hello  </p>';
  const ex = extractCopyBlocks(html);
  const applied = applyRewrites(ex, { c0: 'Bonjour' });
  assert.strictEqual(applied, 1);
  const out = ex.$.html();
  assert.match(out, /Bonjour/);
  assert.ok(!out.includes('Hello'));
});

test('applyRewrites skips empty strings', () => {
  const html = '<p>A</p><p>B</p>';
  const ex = extractCopyBlocks(html);
  const applied = applyRewrites(ex, { c0: '', c1: 'New' });
  assert.strictEqual(applied, 1);
  const out = ex.$.html();
  assert.match(out, /A/); // unchanged
  assert.match(out, /New/);
});

test('textDiff: FakeTextLLM returns a valid rewrite map', async () => {
  const llm = new FakeTextLLM((input) => {
    // Extract block ids and return a map that prepends "[NEW]" to each.
    const ids = Array.from(input.userPrompt.matchAll(/^(c\d+):/gm)).map((m) => m[1]);
    const out: Record<string, string> = {};
    for (const id of ids) out[id] = `[NEW] ${id}`;
    return JSON.stringify(out);
  });
  const res = await textDiff({
    html: '<p>One</p><p>Two</p>',
    brief: { brandName: 'X' },
    sectionRole: 'hero',
    llm,
  });
  assert.strictEqual(res.blocks, 2);
  assert.strictEqual(res.applied, 2);
  assert.match(res.html, /\[NEW\] c0/);
});

test('textDiff: no visible copy blocks returns html unchanged', async () => {
  const llm = new FakeTextLLM(() => '{}');
  const res = await textDiff({
    html: '<section><script>var s=1</script></section>',
    brief: {},
    sectionRole: 'hero',
    llm,
  });
  assert.strictEqual(res.blocks, 0);
  assert.strictEqual(res.applied, 0);
  assert.match(res.html, /var s=1/);
});

test('textDiff: retries on invalid JSON then succeeds', async () => {
  let count = 0;
  const llm = new FakeTextLLM((input) => {
    count++;
    if (count === 1) return 'not json';
    const ids = Array.from(input.userPrompt.matchAll(/^(c\d+):/gm)).map((m) => m[1]);
    return JSON.stringify(Object.fromEntries(ids.map((id) => [id, 'ok'])));
  });
  const res = await textDiff({
    html: '<p>A</p>',
    brief: {},
    sectionRole: 'hero',
    llm,
    maxRetries: 2,
  });
  assert.strictEqual(res.applied, 1);
  assert.strictEqual(count, 2);
});

test('textDiff: throws after maxRetries exceeded', async () => {
  const llm = new FakeTextLLM(() => 'not json');
  await assert.rejects(
    textDiff({
      html: '<p>A</p>',
      brief: {},
      sectionRole: 'hero',
      llm,
      maxRetries: 1,
    }),
    /text-diff failed/,
  );
});
