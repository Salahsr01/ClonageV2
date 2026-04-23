import { test } from 'node:test';
import assert from 'node:assert';
import { buildInventory } from '../../src/compose/inventory.js';
import { rewriteCopyBlocks, RewriteParseError } from '../../src/compose/rewrite-text.js';

const BRIEF = { brandName: 'Nova', industry: 'aerospace', tagline: 'Silence' };

test('rewriteCopyBlocks parses a clean JSON response into Patches', async () => {
  const inv = buildInventory('<section><h1>Old</h1><p>body</p></section>');
  const [c1, c2] = inv.copyBlocks.map((b) => b.id);

  const llm = async (args: any) => {
    // Assert prompt never contains raw HTML tags (text-only contract)
    assert.ok(!/<h1>|<p>|<!DOCTYPE/i.test(args.prompt), 'prompt must not contain HTML');
    return JSON.stringify({
      copy: { [c1]: 'New Heading', [c2]: 'New body' },
      attrs: {},
      meta: {},
    });
  };

  const patches = await rewriteCopyBlocks(inv, BRIEF, llm, {
    sectionRole: 'hero',
    sourceSite: 'source.com',
  });
  assert.deepStrictEqual(patches.copy, { [c1]: 'New Heading', [c2]: 'New body' });
});

test('rewriteCopyBlocks tolerates ```json fenced response', async () => {
  const inv = buildInventory('<section><h1>Old</h1></section>');
  const c1 = inv.copyBlocks[0].id;
  const llm = async () => '```json\n{"copy":{"' + c1 + '":"Fenced"}}\n```';
  const patches = await rewriteCopyBlocks(inv, BRIEF, llm, {
    sectionRole: 'hero',
    sourceSite: 's',
  });
  assert.strictEqual(patches.copy?.[c1], 'Fenced');
});

test('rewriteCopyBlocks recovers from prose wrapper around JSON', async () => {
  const inv = buildInventory('<section><h1>Old</h1></section>');
  const c1 = inv.copyBlocks[0].id;
  const llm = async () =>
    'Voici la réponse:\n\n{"copy":{"' + c1 + '":"Recovered"},"attrs":{},"meta":{}}\n\nFin.';
  const patches = await rewriteCopyBlocks(inv, BRIEF, llm, {
    sectionRole: 'hero',
    sourceSite: 's',
  });
  assert.strictEqual(patches.copy?.[c1], 'Recovered');
});

test('rewriteCopyBlocks throws RewriteParseError on empty LLM response', async () => {
  const inv = buildInventory('<section><h1>x</h1></section>');
  const llm = async () => '';
  await assert.rejects(
    rewriteCopyBlocks(inv, BRIEF, llm, { sectionRole: 'hero', sourceSite: 's' }),
    RewriteParseError,
  );
});

test('rewriteCopyBlocks throws RewriteParseError on unparseable response', async () => {
  const inv = buildInventory('<section><h1>x</h1></section>');
  const llm = async () => 'Not JSON at all, sorry.';
  await assert.rejects(
    rewriteCopyBlocks(inv, BRIEF, llm, { sectionRole: 'hero', sourceSite: 's' }),
    RewriteParseError,
  );
});

test('rewriteCopyBlocks coerces non-string values away', async () => {
  const inv = buildInventory('<section><h1>Old</h1></section>');
  const c1 = inv.copyBlocks[0].id;
  const llm = async () => JSON.stringify({ copy: { [c1]: 42, c2: 'kept' } });
  const patches = await rewriteCopyBlocks(inv, BRIEF, llm, {
    sectionRole: 'hero',
    sourceSite: 's',
  });
  assert.strictEqual(patches.copy?.[c1], undefined);
  assert.strictEqual(patches.copy?.['c2'], 'kept');
});

test('retryFeedback appears in the prompt', async () => {
  const inv = buildInventory('<section><h1>x</h1></section>');
  let seenPrompt = '';
  const llm = async (args: any) => {
    seenPrompt = args.prompt;
    return JSON.stringify({ copy: {} });
  };
  await rewriteCopyBlocks(inv, BRIEF, llm, {
    sectionRole: 'hero',
    sourceSite: 's',
    retryFeedback: 'ids manquants: c1, c3',
  });
  assert.ok(seenPrompt.includes('ids manquants: c1, c3'));
});
