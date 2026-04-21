import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { loadBrief, validateBrief } from '../../src/rebrand/brief.js';

test('loadBrief reads a valid JSON file', () => {
  const p = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-full.json');
  const brief = loadBrief(p);
  assert.strictEqual(brief.brand?.name, 'Atelier Noma');
  assert.ok(brief.palette?.map);
});

test('loadBrief accepts a partial brief (palette-only)', () => {
  const p = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-palette-only.json');
  const brief = loadBrief(p);
  assert.strictEqual(brief.brand, undefined);
  assert.ok(brief.palette?.map);
});

test('loadBrief accepts an empty brief ({})', () => {
  const brief = validateBrief({});
  assert.deepStrictEqual(brief, {});
});

test('validateBrief rejects brand missing source_name', () => {
  assert.throws(
    () => validateBrief({ brand: { name: 'X' } }),
    /brand\.source_name/
  );
});

test('validateBrief rejects palette without map', () => {
  assert.throws(
    () => validateBrief({ palette: {} }),
    /palette\.map/
  );
});

test('validateBrief rejects copy entry without from/selector', () => {
  assert.throws(
    () => validateBrief({ copy: [{ to: 'x' } as any] }),
    /copy\[0\]/
  );
});
