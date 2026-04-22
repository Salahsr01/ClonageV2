import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadKB } from '../../src/compose/kb-loader.js';
import type { KBv2Index } from '../../src/deep-extract/types.js';

function seedKB(kbRoot: string, site: string, index: KBv2Index, files: Record<string, string>) {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf-8');
  }
  return dir;
}

function makeIndex(site = 'example.com'): KBv2Index {
  return {
    site,
    source_clone: '/tmp/example',
    extracted_at: '2026-04-22T00:00:00Z',
    palette: { primary: '#000' },
    fonts: { primary: { family: 'Inter', google: true } },
    sections: [
      {
        role: 'hero',
        file: 'hero.html',
        size_bytes: 100,
        has_animation: false,
        dominant_classes: ['hero'],
        text_excerpt: 'Welcome',
        tags: [],
      },
      {
        role: 'footer',
        file: 'footer.html',
        size_bytes: 50,
        has_animation: false,
        dominant_classes: ['footer'],
        text_excerpt: 'copyright',
        tags: [],
      },
    ],
  };
}

test('loadKB parses index.json and loads each section html', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-kb-'));
  seedKB(tmp, 'example.com', makeIndex(), {
    'hero.html': '<!DOCTYPE html><html><body>hello</body></html>',
    'footer.html': '<!DOCTYPE html><html><body>bye</body></html>',
  });
  const loaded = loadKB('example.com', tmp);
  assert.strictEqual(loaded.index.site, 'example.com');
  assert.strictEqual(loaded.sections.length, 2);
  assert.strictEqual(loaded.sections[0].meta.role, 'hero');
  assert.ok(loaded.sections[0].html.includes('hello'));
  assert.ok(loaded.sections[1].html.includes('bye'));
});

test('loadKB throws when the site is not in the KB', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-kb-'));
  assert.throws(() => loadKB('missing.com', tmp), /not found/i);
});

test('loadKB throws when a section file is missing on disk', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-kb-'));
  seedKB(tmp, 'example.com', makeIndex(), {
    'hero.html': '<!DOCTYPE html><html><body>hello</body></html>',
  });
  assert.throws(() => loadKB('example.com', tmp), /footer\.html/);
});
