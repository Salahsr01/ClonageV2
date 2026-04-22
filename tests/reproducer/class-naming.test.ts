import { test } from 'node:test';
import assert from 'node:assert';

// Tests de référence pour la logique d'inférence (l'impl réelle est dans page.evaluate)
function inferClassName(
  original: string,
  tag: string,
  role: string | null,
  dataSection: string | null,
  textContent: string | null,
  counter: { n: number }
): string {
  if (/^[a-z][a-z-]*$/i.test(original) && original.length < 30) return original;

  const TAG_NAMES: Record<string, string> = {
    h1: 'hero-title', nav: 'nav', footer: 'site-footer', header: 'site-header', main: 'main-content',
  };

  if (dataSection) return `${dataSection.toLowerCase()}-section`;
  if (TAG_NAMES[tag]) return TAG_NAMES[tag];
  if (role === 'button') return `button-${counter.n++}`;
  if (role === 'dialog') return `dialog-${counter.n++}`;

  if (textContent && textContent.length > 0 && textContent.length < 30) {
    const slug = textContent.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slug.length > 0 && slug.length < 30) return `${tag}-${slug}`;
  }

  return `el-${counter.n++}`;
}

test('cleanClassName garde un nom déjà clean', () => {
  const c = { n: 0 };
  assert.strictEqual(inferClassName('hero', 'div', null, null, null, c), 'hero');
});

test('cleanClassName utilise data-section en priorité', () => {
  const c = { n: 0 };
  assert.strictEqual(inferClassName('Button-module__n0x4Aa', 'section', null, 'hero', null, c), 'hero-section');
});

test('cleanClassName utilise tag sémantique pour h1', () => {
  const c = { n: 0 };
  assert.strictEqual(inferClassName('ugly-abc123', 'h1', null, null, null, c), 'hero-title');
});

test('cleanClassName slugifie le text content court', () => {
  const c = { n: 0 };
  assert.strictEqual(inferClassName('abc__xyz', 'button', null, null, 'Contact Us', c), 'button-contact-us');
});

test('cleanClassName fallback el-N avec counter', () => {
  const c = { n: 0 };
  assert.strictEqual(inferClassName('abc__xyz', 'div', null, null, null, c), 'el-0');
  assert.strictEqual(inferClassName('def__abc', 'div', null, null, null, c), 'el-1');
});
