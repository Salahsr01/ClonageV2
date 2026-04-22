import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import * as path from 'path';
import * as fs from 'fs';
import { inlineSection } from '../../src/deep-extract/inliner.js';

const CLONE_DIR = path.resolve(process.cwd(), 'tests/deep-extract/fixtures/minimal-clone');

function loadFixture() {
  const html = fs.readFileSync(path.join(CLONE_DIR, 'index.html'), 'utf-8');
  const css = fs.readFileSync(path.join(CLONE_DIR, 'styles.css'), 'utf-8');
  const $ = load(html);
  return { $, css };
}

test('inlineSection wraps section in a standalone HTML document', () => {
  const { $, css } = loadFixture();
  const section = $('section.hero-wrap');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.startsWith('<!DOCTYPE html>'), 'starts with DOCTYPE');
  assert.ok(out.includes('<html'), 'contains html tag');
  assert.ok(out.includes('</html>'), 'closes html tag');
  assert.ok(out.includes('<style>'), 'inlines a style block');
  assert.ok(out.includes('hero-wrap'), 'contains the section class');
});

test('inlineSection filters CSS to rules touching the section', () => {
  const { $, css } = loadFixture();
  const section = $('section.hero-wrap');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.includes('.hero-wrap'), 'keeps hero-wrap rule');
  assert.ok(out.includes('.tagline'), 'keeps nested class rule');
  assert.ok(!out.includes('.services-grid'), 'drops unrelated services-grid rule');
  assert.ok(!out.includes('.portfolio-grid'), 'drops unrelated portfolio-grid rule');
});

test('inlineSection always keeps :root, @font-face, body', () => {
  const { $, css } = loadFixture();
  const section = $('section.hero-wrap');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.includes(':root'), 'keeps :root');
  assert.ok(out.includes('@font-face'), 'keeps @font-face');
  assert.ok(out.includes('body '), 'keeps body rule');
});

test('inlineSection inlines local images as data URLs', () => {
  const { $, css } = loadFixture();
  const section = $('section.hero-wrap');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.includes('data:image/svg+xml;base64,'), 'logo.svg inlined as base64');
  assert.ok(!out.includes('./assets/logo.svg'), 'no more relative src');
});

test('inlineSection preserves script tags inside the section', () => {
  const { $, css } = loadFixture();
  const section = $('section.contact-block');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.includes('<script>'), 'keeps script tag');
  assert.ok(out.includes('addEventListener'), 'keeps script body');
});

test('inlineSection output is compact (< 50KB for fixture)', () => {
  const { $, css } = loadFixture();
  const section = $('section.hero-wrap');
  const out = inlineSection(section, css, CLONE_DIR);
  assert.ok(out.length < 50_000, `output size ${out.length} should be under 50KB`);
});
