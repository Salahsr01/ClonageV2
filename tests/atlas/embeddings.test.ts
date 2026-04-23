import { test } from 'node:test';
import assert from 'node:assert';
import { HashEmbedding, cosine } from '../../src/atlas/embeddings.js';

test('HashEmbedding is deterministic and L2-normalized', async () => {
  const e = new HashEmbedding(128);
  const v1 = await e.embed('hello world');
  const v2 = await e.embed('hello world');
  assert.deepStrictEqual(v1, v2, 'deterministic');
  const norm = Math.sqrt(v1.reduce((s, x) => s + x * x, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, `L2 norm should be 1, got ${norm}`);
});

test('HashEmbedding places semantically close strings closer than distant ones', async () => {
  const e = new HashEmbedding(256);
  const a = await e.embed('studio architecture moody minimal black');
  const b = await e.embed('studio architecture dark editorial');
  const c = await e.embed('pricing plans for SaaS product');
  const sim_ab = cosine(a, b);
  const sim_ac = cosine(a, c);
  assert.ok(sim_ab > sim_ac, `expected architecture-similar to beat pricing: ab=${sim_ab}, ac=${sim_ac}`);
});

test('cosine returns 1 for identical vectors and 0 for orthogonal', () => {
  const a = [1, 0, 0];
  const b = [1, 0, 0];
  const c = [0, 1, 0];
  assert.strictEqual(cosine(a, b), 1);
  assert.strictEqual(cosine(a, c), 0);
});

test('cosine returns 0 on dimension mismatch (defensive)', () => {
  assert.strictEqual(cosine([1, 0], [1, 0, 0]), 0);
});

test('HashEmbedding.id is stable and reflects dim', () => {
  const e1 = new HashEmbedding(128);
  const e2 = new HashEmbedding(256);
  assert.strictEqual(e1.id, 'hash-trigram:128');
  assert.strictEqual(e2.id, 'hash-trigram:256');
});
