import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { deepExtract } from '../../src/deep-extract/index.js';

const CLONE_DIR = path.resolve(process.cwd(), 'tests/deep-extract/fixtures/minimal-clone');

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-dx-test-'));
}

test('deepExtract on minimal fixture produces 5 sections with expected roles', async () => {
  const kbRoot = mkTmp();
  const result = await deepExtract({ cloneDir: CLONE_DIR, kbRoot });
  assert.strictEqual(result.site, 'minimal-clone');
  assert.strictEqual(result.index.sections.length, 5);
  const roles = result.index.sections.map((s) => s.role);
  assert.ok(roles.includes('hero'));
  assert.ok(roles.includes('services'));
  assert.ok(roles.includes('portfolio'));
  assert.ok(roles.includes('contact'));
  assert.ok(roles.includes('footer'));
});

test('deepExtract writes standalone HTML files that start with DOCTYPE', async () => {
  const kbRoot = mkTmp();
  const result = await deepExtract({ cloneDir: CLONE_DIR, kbRoot });
  for (const sec of result.index.sections) {
    const full = path.join(result.kbDir, sec.file);
    const html = fs.readFileSync(full, 'utf-8');
    assert.ok(html.startsWith('<!DOCTYPE html>'), `${sec.file} must start with DOCTYPE`);
    assert.ok(html.includes('</html>'), `${sec.file} must close </html>`);
  }
});

test('deepExtract extracts palette and fonts from styles.css', async () => {
  const kbRoot = mkTmp();
  const result = await deepExtract({ cloneDir: CLONE_DIR, kbRoot });
  assert.ok(result.index.palette.primary || result.index.palette.secondary, 'at least one palette color');
  assert.ok(result.index.fonts.primary, 'primary font extracted');
});

test('deepExtract reports has_animation=true for section with <script>', async () => {
  const kbRoot = mkTmp();
  const result = await deepExtract({ cloneDir: CLONE_DIR, kbRoot });
  const contact = result.index.sections.find((s) => s.role === 'contact');
  assert.ok(contact);
  assert.strictEqual(contact!.has_animation, true);
});
