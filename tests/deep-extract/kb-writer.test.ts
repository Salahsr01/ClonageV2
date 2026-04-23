import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { writeKB } from '../../src/deep-extract/kb-writer.js';
import type { KBv2Index } from '../../src/deep-extract/types.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-kb-test-'));
}

function makeIndex(site = 'example.com'): KBv2Index {
  return {
    site,
    source_clone: 'output/example.com_2026-04-22',
    extracted_at: '2026-04-22T09:00:00Z',
    palette: { primary: '#f5f0e6', secondary: '#1a1a1a' },
    fonts: { primary: { family: 'Inter', google: true } },
    sections: [
      {
        role: 'hero',
        file: 'hero.html',
        size_bytes: 1234,
        has_animation: false,
        dominant_classes: ['hero-wrap'],
        text_excerpt: 'Welcome...',
        tags: ['minimal'],
      },
    ],
  };
}

test('writeKB creates .clonage-kb/sections/<site>/ with index.json + section files', () => {
  const tmp = mkTmp();
  const result = writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [{ role: 'hero', html: '<!DOCTYPE html><html></html>' }],
    kbRoot: tmp,
  });
  assert.strictEqual(result.kbDir, path.join(tmp, 'sections', 'example.com'));
  assert.ok(fs.existsSync(path.join(result.kbDir, 'index.json')));
  assert.ok(fs.existsSync(path.join(result.kbDir, 'hero.html')));
});

test('writeKB emits a <role>.inv.json sidecar with copyBlocks + fingerprints', () => {
  const tmp = mkTmp();
  const result = writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [
      {
        role: 'hero',
        html: '<!DOCTYPE html><html><head><title>t</title></head><body><section><h1>Hi</h1><script>var x=1;</script></section></body></html>',
      },
    ],
    kbRoot: tmp,
  });
  const invPath = path.join(result.kbDir, 'hero.inv.json');
  assert.ok(fs.existsSync(invPath), 'hero.inv.json not written');
  const inv = JSON.parse(fs.readFileSync(invPath, 'utf-8'));
  assert.strictEqual(inv.role, 'hero');
  assert.ok(Array.isArray(inv.copyBlocks));
  assert.ok(inv.copyBlocks.some((b: any) => b.text === 'Hi'));
  assert.strictEqual(inv.fingerprints.scripts.length, 1);
});

test('writeKB with writeInventory: false skips sidecar', () => {
  const tmp = mkTmp();
  const result = writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [{ role: 'hero', html: '<section><h1>Hi</h1></section>' }],
    kbRoot: tmp,
    writeInventory: false,
  });
  assert.ok(!fs.existsSync(path.join(result.kbDir, 'hero.inv.json')));
});

test('writeKB writes parseable JSON identical to input', () => {
  const tmp = mkTmp();
  const input = makeIndex();
  const result = writeKB({
    siteName: 'example.com',
    index: input,
    sections: [{ role: 'hero', html: '<html></html>' }],
    kbRoot: tmp,
  });
  const parsed = JSON.parse(fs.readFileSync(path.join(result.kbDir, 'index.json'), 'utf-8'));
  assert.deepStrictEqual(parsed, input);
});

test('writeKB throws when force=false and target exists', () => {
  const tmp = mkTmp();
  writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [{ role: 'hero', html: '<html></html>' }],
    kbRoot: tmp,
  });
  assert.throws(() => {
    writeKB({
      siteName: 'example.com',
      index: makeIndex(),
      sections: [{ role: 'hero', html: '<html></html>' }],
      kbRoot: tmp,
      force: false,
    });
  }, /already exists/i);
});

test('writeKB overwrites when force=true', () => {
  const tmp = mkTmp();
  writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [{ role: 'hero', html: '<html>OLD</html>' }],
    kbRoot: tmp,
  });
  const result = writeKB({
    siteName: 'example.com',
    index: makeIndex(),
    sections: [{ role: 'hero', html: '<html>NEW</html>' }],
    kbRoot: tmp,
    force: true,
  });
  const hero = fs.readFileSync(path.join(result.kbDir, 'hero.html'), 'utf-8');
  assert.ok(hero.includes('NEW'));
});
