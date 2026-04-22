import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { compose } from '../../src/compose/index.js';
import type { KBv2Index } from '../../src/deep-extract/types.js';

function seedKB(kbRoot: string, site: string) {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  const idx: KBv2Index = {
    site,
    source_clone: '/tmp/source',
    extracted_at: '2026-04-22T00:00:00Z',
    palette: { primary: '#111' },
    fonts: { primary: { family: 'Inter', google: true } },
    sections: [
      {
        role: 'hero',
        file: 'hero.html',
        size_bytes: 200,
        has_animation: false,
        dominant_classes: ['hero'],
        text_excerpt: 'Old hero',
        tags: [],
      },
      {
        role: 'footer',
        file: 'footer.html',
        size_bytes: 100,
        has_animation: false,
        dominant_classes: ['footer'],
        text_excerpt: 'Old footer',
        tags: [],
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx, null, 2));
  fs.writeFileSync(
    path.join(dir, 'hero.html'),
    '<!DOCTYPE html><html><head><style>.hero{padding:40px}</style></head><body><section class="hero"><h1>Old Brand Hero</h1></section></body></html>',
  );
  fs.writeFileSync(
    path.join(dir, 'footer.html'),
    '<!DOCTYPE html><html><head><style>.footer{color:#111}</style></head><body><footer><p>&copy; Old Brand</p></footer></body></html>',
  );
  return dir;
}

const BRIEF = { brandName: 'Nova', industry: 'aerospace', tagline: 'Lift off' };

test('compose with mock LLM produces an index.html + manifest', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-out-'));

  const mockLLM = async (_prompt: string, sec: any) => {
    const role = sec.meta.role;
    return JSON.stringify([{ id: 0, newText: `NOVA-${role}` }]);
  };

  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm: mockLLM,
    launchServer: false,
  });

  assert.ok(fs.existsSync(result.indexPath));
  assert.ok(fs.existsSync(result.manifestPath));
  const html = fs.readFileSync(result.indexPath, 'utf-8');
  assert.ok(html.includes('NOVA-hero'));
  assert.ok(html.includes('NOVA-footer'));
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('</html>'));
  assert.strictEqual(result.sections.length, 2);
  assert.ok(result.sections.every((s) => s.usedLLM));
});

test('compose keeps original section when LLM returns empty', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-out-'));

  const emptyLLM = async () => '';
  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm: emptyLLM,
    launchServer: false,
  });
  const html = fs.readFileSync(result.indexPath, 'utf-8');
  assert.ok(html.includes('Old Brand Hero'), 'original hero text preserved');
  assert.ok(result.sections.every((s) => !s.usedLLM));
});

test('compose manifest records per-section metadata', async () => {
  const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'));
  seedKB(kbRoot, 'source.com');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-out-'));

  const llm = async () => JSON.stringify([{ id: 0, newText: 'X' }]);
  const result = await compose({
    baseSite: 'source.com',
    brief: BRIEF,
    outputDir,
    kbRoot,
    llm,
    launchServer: false,
  });

  const manifest = JSON.parse(fs.readFileSync(result.manifestPath, 'utf-8'));
  assert.strictEqual(manifest.base_site, 'source.com');
  assert.strictEqual(manifest.brand_name, 'Nova');
  assert.strictEqual(manifest.sections.length, 2);
});
