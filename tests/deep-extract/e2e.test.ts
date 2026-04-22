import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { deepExtract } from '../../src/deep-extract/index.js';

const CLONES = [
  { dir: 'output/www.mersi-architecture.com_2026-04-15', site: 'www.mersi-architecture.com' },
  { dir: 'output/www.icomat.co.uk_2026-04-15', site: 'www.icomat.co.uk' },
  { dir: 'output/www.raviklaassens.com_2026-04-15', site: 'www.raviklaassens.com' },
];

for (const clone of CLONES) {
  const abs = path.resolve(process.cwd(), clone.dir);
  test(`e2e: deepExtract on ${clone.site}`, async (t) => {
    if (!fs.existsSync(abs)) {
      t.skip(`${clone.site} not present`);
      return;
    }
    const kbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-e2e-'));
    const result = await deepExtract({ cloneDir: abs, kbRoot });

    assert.strictEqual(result.site, clone.site);
    assert.ok(result.index.sections.length >= 1, 'at least 1 section extracted');

    for (const sec of result.index.sections) {
      const full = path.join(result.kbDir, sec.file);
      const html = fs.readFileSync(full, 'utf-8');
      assert.ok(html.startsWith('<!DOCTYPE html>'), `${sec.file} must start with DOCTYPE`);
      assert.ok(html.includes('</html>'), `${sec.file} must close </html>`);
      const kb = sec.size_bytes / 1024;
      assert.ok(kb < 200, `${sec.file} is ${kb.toFixed(1)}KB, want <200KB`);
    }

    assert.ok(result.index.palette.primary || result.index.palette.secondary, 'palette extracted');
  });
}
