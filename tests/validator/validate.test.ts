import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { validate } from '../../src/validator/index.js';
import { assemble } from '../../src/agents/generation/assembler.js';
import type { Plan } from '../../src/agents/planning/schema.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'validate-'));
}

/**
 * Build a tmp .clonage-kb/sections/<site>/<role>.html structure so the
 * validator's kb-loader can find the reference sections.
 */
function mkKB(kbRoot: string, site: string, sections: Record<string, string>): void {
  const dir = path.join(kbRoot, 'sections', site);
  fs.mkdirSync(dir, { recursive: true });
  for (const [role, html] of Object.entries(sections)) {
    fs.writeFileSync(path.join(dir, `${role}.html`), html, 'utf-8');
  }
}

function makePlan(sources: Array<{ role: string; source: string }>, paletteRef = 'x'): Plan {
  return {
    brand: 'T',
    sections: sources.map((s) => ({
      role: s.role,
      source: s.source,
      reason: 'long enough reason to pass validation schema',
    })),
    design_constraints: { palette_reference: paletteRef, typo_reference: paletteRef, rhythm_reference: paletteRef },
    coherence_notes:
      'A coherence notes string long enough for validation, written plainly.',
  };
}

test('validate: passes when generated mirrors source fingerprints', async () => {
  const kb = mkTmp();
  const sectionHtml =
    '<html><head><script>a</script></head><body><section><h1>h</h1><p>p</p></section></body></html>';
  mkKB(kb, 'x', { hero: sectionHtml });

  const assembled = assemble({
    sections: [{ role: 'hero', site: 'x', html: sectionHtml }],
  });
  const outDir = mkTmp();
  const genHtml = path.join(outDir, 'index.html');
  fs.writeFileSync(genHtml, assembled.html);

  const plan = makePlan([{ role: 'hero', source: 'x#hero' }]);
  const result = await validate({ plan, generatedHtmlPath: genHtml, kbRoot: kb });

  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.perSection.length, 1);
  assert.strictEqual(result.perSection[0].pass, true);
});

test('validate: fails when generated section is missing', async () => {
  const kb = mkTmp();
  mkKB(kb, 'x', { hero: '<html><body><section><h1>h</h1></section></body></html>' });
  const outDir = mkTmp();
  const genHtml = path.join(outDir, 'index.html');
  // Write an empty-ish generated file without the section marker.
  fs.writeFileSync(genHtml, '<html><body><p>nothing</p></body></html>');

  const plan = makePlan([{ role: 'hero', source: 'x#hero' }]);
  const result = await validate({ plan, generatedHtmlPath: genHtml, kbRoot: kb });

  assert.strictEqual(result.passed, false);
  assert.deepStrictEqual(result.excludeSuggestions, ['x#hero']);
});

test('validate: fails when scripts are missing in generated output', async () => {
  const kb = mkTmp();
  const src = '<html><head><script>a</script><script>b</script></head><body><section>x</section></body></html>';
  mkKB(kb, 'x', { hero: src });

  // "generated" output with scripts stripped.
  const bad = '<html><body><!-- section: hero from x -->\n<section>x</section>\n</body></html>';
  const outDir = mkTmp();
  const genHtml = path.join(outDir, 'index.html');
  fs.writeFileSync(genHtml, bad);

  const plan = makePlan([{ role: 'hero', source: 'x#hero' }]);
  const result = await validate({ plan, generatedHtmlPath: genHtml, kbRoot: kb });

  assert.strictEqual(result.passed, false);
  assert.match(result.perSection[0].fingerprintCheck.report.join('\n'), /scripts: missing 2/);
});

test('validate: nodeTolerance is respected', async () => {
  const kb = mkTmp();
  const big = '<html><body><section>' + '<div></div>'.repeat(100) + '</section></body></html>';
  mkKB(kb, 'x', { hero: big });

  const assembled = assemble({
    sections: [
      { role: 'hero', site: 'x', html: '<html><body><section>' + '<div></div>'.repeat(80) + '</section></body></html>' },
    ],
  });
  const outDir = mkTmp();
  const genHtml = path.join(outDir, 'index.html');
  fs.writeFileSync(genHtml, assembled.html);

  const plan = makePlan([{ role: 'hero', source: 'x#hero' }]);
  const strict = await validate({ plan, generatedHtmlPath: genHtml, kbRoot: kb, nodeTolerance: 0.05 });
  assert.strictEqual(strict.passed, false);

  const tolerant = await validate({ plan, generatedHtmlPath: genHtml, kbRoot: kb, nodeTolerance: 0.5 });
  assert.strictEqual(tolerant.passed, true);
});
