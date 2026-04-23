import { test } from 'node:test';
import assert from 'node:assert';
import { remapPalette, remapFont } from '../../../src/agents/generation/token-remap.js';

test('remapPalette swaps matching hex colors', () => {
  const html = '<div style="color:#ff0000;background:#00ff00"></div>';
  const out = remapPalette(html, ['#ff0000', '#00ff00'], ['#111111', '#222222']);
  assert.match(out, /#111111/);
  assert.match(out, /#222222/);
  assert.doesNotMatch(out, /#ff0000/);
  assert.doesNotMatch(out, /#00ff00/);
});

test('remapPalette is a no-op when either side is empty', () => {
  const html = '<div style="color:#f00"></div>';
  assert.strictEqual(remapPalette(html, [], ['#000']), html);
  assert.strictEqual(remapPalette(html, ['#f00'], []), html);
});

test('remapPalette cycles when source has more colors than target', () => {
  const html = 'A #111 B #222 C #333';
  const out = remapPalette(html, ['#111', '#222', '#333'], ['#abc']);
  assert.match(out, /#abc/);
  assert.doesNotMatch(out, /#111/);
  assert.doesNotMatch(out, /#222/);
  assert.doesNotMatch(out, /#333/);
});

test('remapFont swaps font-family in <style> tags', () => {
  const html =
    '<html><head><style>body { font-family: "Inter", sans-serif; }</style></head></html>';
  const out = remapFont(html, 'Inter', 'Roboto');
  assert.match(out, /Roboto/);
  assert.doesNotMatch(out, /Inter/);
});

test('remapFont swaps font-family in inline styles', () => {
  const html = '<div style="font-family: Inter; color: red">x</div>';
  const out = remapFont(html, 'Inter', 'Roboto');
  assert.match(out, /Roboto/);
  assert.match(out, /color: red/);
});

test('remapFont ignores unknown-family swaps', () => {
  const html = '<style>body{font-family:Inter}</style>';
  const out = remapFont(html, 'unknown', 'Roboto');
  assert.strictEqual(out, html);
});
