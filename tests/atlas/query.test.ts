import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryAtlasStore, type AtlasEntry } from '../../src/atlas/store.js';
import { queryAtlas, buildSectionEmbedText } from '../../src/atlas/query.js';
import { HashEmbedding } from '../../src/atlas/embeddings.js';
import { sampleFiche } from '../../src/agents/grounding/prompt.js';

function mkEntry(
  id: string,
  role: string,
  moods: string[],
  sig: string,
  vector: number[],
): AtlasEntry {
  const f = sampleFiche(role);
  f.mood = moods;
  f.signature = sig;
  return {
    id,
    site: id.split('#')[0],
    role,
    source_html: '/tmp/x.html',
    fiche: f,
    embedder_id: 'hash-trigram:256',
    vector,
  };
}

test('queryAtlas ranks by cosine similarity to the brief', async () => {
  const embedder = new HashEmbedding(256);
  const store = new MemoryAtlasStore();

  const a = await embedder.embed('studio architecture moody minimal');
  const b = await embedder.embed('studio architecture dark editorial');
  const c = await embedder.embed('pricing plans SaaS product');

  store.append(mkEntry('x#hero', 'hero', ['moody'], 'archi moody', a));
  store.append(mkEntry('y#hero', 'hero', ['editorial'], 'archi editorial', b));
  store.append(mkEntry('z#hero', 'hero', ['bright'], 'saas pricing', c));

  const hits = await queryAtlas(store, embedder, {
    brief: 'studio architecture moody dark',
    topK: 3,
  });
  assert.strictEqual(hits.length, 3);
  assert.notStrictEqual(hits[0].entry.id, 'z#hero', 'SaaS section should not rank first');
});

test('queryAtlas roleFilter restricts by role, ficheRole, or usable_as', async () => {
  const embedder = new HashEmbedding(256);
  const store = new MemoryAtlasStore();
  const v = await embedder.embed('hero');

  store.append(mkEntry('a#hero', 'hero', ['m'], 'a hero section for testing', v));
  store.append(mkEntry('b#about', 'about', ['m'], 'an about section for testing', v));
  const entryC = mkEntry('c#cta', 'cta', ['m'], 'a cta section usable as hero', v);
  entryC.fiche.usable_as = ['hero'];
  store.append(entryC);

  const hits = await queryAtlas(store, embedder, {
    brief: 'hero',
    roleFilter: 'hero',
  });
  const ids = hits.map((h) => h.entry.id).sort();
  assert.deepStrictEqual(ids, ['a#hero', 'c#cta']);
});

test('queryAtlas moodFilter ORs against entry moods (case-insensitive)', async () => {
  const embedder = new HashEmbedding(256);
  const store = new MemoryAtlasStore();
  const v = await embedder.embed('test');

  store.append(mkEntry('a#hero', 'hero', ['Moody', 'Editorial'], 'test signature minimum length ok', v));
  store.append(mkEntry('b#hero', 'hero', ['bright', 'playful'], 'test signature minimum length ok', v));
  store.append(mkEntry('c#hero', 'hero', ['tech', 'minimal'], 'test signature minimum length ok', v));

  const hits = await queryAtlas(store, embedder, {
    brief: 'test',
    moodFilter: ['moody'],
  });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].entry.id, 'a#hero');
});

test('queryAtlas excludeSources blocks specific ids (S6 retry use case)', async () => {
  const embedder = new HashEmbedding(256);
  const store = new MemoryAtlasStore();
  const v = await embedder.embed('test');
  store.append(mkEntry('a#hero', 'hero', ['m'], 'test signature minimum length ok', v));
  store.append(mkEntry('b#hero', 'hero', ['m'], 'test signature minimum length ok', v));

  const hits = await queryAtlas(store, embedder, {
    brief: 'test',
    excludeSources: ['a#hero'],
  });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].entry.id, 'b#hero');
});

test('queryAtlas throws on embedder_id mismatch', async () => {
  const store = new MemoryAtlasStore();
  const v = [0.1, 0.2];
  store.append({
    id: 'a#hero',
    site: 'a',
    role: 'hero',
    source_html: '/x',
    fiche: sampleFiche('hero'),
    embedder_id: 'openai:text-embedding-3-small:1536',
    vector: v,
  });

  await assert.rejects(
    queryAtlas(store, new HashEmbedding(256), { brief: 't' }),
    /embedder mismatch/,
  );
});

test('buildSectionEmbedText includes role, mood, signature, usable_as', () => {
  const text = buildSectionEmbedText({
    role: 'hero',
    fiche: sampleFiche('hero'),
  });
  assert.match(text, /role: hero/);
  assert.match(text, /mood:/);
  assert.match(text, /signature:/);
  assert.match(text, /usable_as:/);
});
