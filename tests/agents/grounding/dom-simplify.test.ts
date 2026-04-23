import { test } from 'node:test';
import assert from 'node:assert';
import { simplifyDOM } from '../../../src/agents/grounding/dom-simplify.js';

test('simplifyDOM drops text content but keeps tags and classes', () => {
  const html = '<section class="hero"><h1>Welcome</h1><p>Body text</p></section>';
  const out = simplifyDOM(html);
  assert.match(out, /<section class="hero">/);
  assert.match(out, /<h1/);
  assert.match(out, /<p\/>/);
  assert.doesNotMatch(out, /Welcome/);
  assert.doesNotMatch(out, /Body text/);
});

test('simplifyDOM strips script and style content but keeps tags', () => {
  const html =
    '<section><script>var secret = 1;</script><style>.a{color:red}</style></section>';
  const out = simplifyDOM(html);
  assert.match(out, /<script\/>/);
  assert.match(out, /<style\/>/);
  assert.doesNotMatch(out, /secret/);
  assert.doesNotMatch(out, /color:red/);
});

test('simplifyDOM truncates at maxChars', () => {
  const huge = '<section>' + '<div class="a"></div>'.repeat(5000) + '</section>';
  const out = simplifyDOM(huge, 500);
  assert.ok(out.length <= 500 + 20, `expected length <= ~500, got ${out.length}`);
  assert.ok(out.endsWith('…[truncated]') || out.length < 500);
});

test('simplifyDOM collapses deep subtrees with ellipsis', () => {
  let html = '<div>';
  for (let i = 0; i < 10; i++) html += '<div>';
  for (let i = 0; i < 10; i++) html += '</div>';
  html += '</div>';
  const out = simplifyDOM(html, 10000, 3);
  assert.match(out, /…/);
});

test('simplifyDOM preserves data-section + aria-label attributes', () => {
  const html =
    '<section data-section="hero-split" aria-label="Main hero"><h1>t</h1></section>';
  const out = simplifyDOM(html);
  assert.match(out, /data-section="hero-split"/);
  assert.match(out, /aria-label="Main hero"/);
});
