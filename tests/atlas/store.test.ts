import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { JsonlAtlasStore, MemoryAtlasStore, type AtlasEntry } from '../../src/atlas/store.js';
import { sampleFiche } from '../../src/agents/grounding/prompt.js';

function mkEntry(id: string): AtlasEntry {
  return {
    id,
    site: id.split('#')[0],
    role: id.split('#')[1],
    source_html: `/tmp/${id}.html`,
    fiche: sampleFiche(id.split('#')[1]),
    embedder_id: 'hash-trigram:256',
    vector: [0.1, 0.2, 0.3],
  };
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-atlas-'));
}

test('JsonlAtlasStore appends and reloads entries', () => {
  const tmp = mkTmp();
  const storePath = path.join(tmp, 'atlas.jsonl');
  const store = new JsonlAtlasStore(storePath);
  store.append(mkEntry('mersi#hero'));
  store.append(mkEntry('mersi#navbar'));
  const loaded = store.load();
  assert.strictEqual(loaded.length, 2);
  assert.strictEqual(loaded[0].id, 'mersi#hero');
  assert.strictEqual(loaded[1].id, 'mersi#navbar');
});

test('JsonlAtlasStore.replace rewrites whole file', () => {
  const tmp = mkTmp();
  const store = new JsonlAtlasStore(path.join(tmp, 'atlas.jsonl'));
  store.append(mkEntry('a#hero'));
  store.append(mkEntry('b#hero'));
  store.replace([mkEntry('c#hero')]);
  const loaded = store.load();
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, 'c#hero');
});

test('JsonlAtlasStore.load tolerates malformed lines', () => {
  const tmp = mkTmp();
  const p = path.join(tmp, 'atlas.jsonl');
  fs.writeFileSync(p, JSON.stringify({ garbage: true }) + '\n' + JSON.stringify(mkEntry('ok#hero')) + '\n', 'utf-8');
  const store = new JsonlAtlasStore(p);
  const loaded = store.load();
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, 'ok#hero');
});

test('JsonlAtlasStore.load returns empty when file missing', () => {
  const store = new JsonlAtlasStore('/tmp/does-not-exist-' + Date.now() + '.jsonl');
  assert.deepStrictEqual(store.load(), []);
});

test('MemoryAtlasStore mirrors the JSONL contract', () => {
  const mem = new MemoryAtlasStore();
  mem.append(mkEntry('mersi#hero'));
  mem.replace([mkEntry('icomat#hero'), mkEntry('icomat#cta')]);
  const loaded = mem.load();
  assert.strictEqual(loaded.length, 2);
});
