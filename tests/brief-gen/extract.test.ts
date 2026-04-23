import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractFromHar } from '../../src/brief-gen/extract.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-extract-'));
}

function mkHar(entries: any[]): any {
  return { log: { version: '1.2', entries } };
}

test('extractFromHar pulls visible text from the HTML entry', () => {
  const tmp = mkTmp();
  const harPath = path.join(tmp, 'r.har');
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      mkHar([
        {
          request: { url: 'https://example.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              text: `<html><body>
                <h1>LUMEN©</h1>
                <nav><a>INDEX</a><a>PROJECTS</a></nav>
                <section><p>The creative powerhouse</p></section>
                <script>hidden secret</script>
                <style>body{color:red}</style>
              </body></html>`,
            },
          },
        },
      ]),
    ),
  );
  const s = extractFromHar(harPath);
  assert.ok(s.texts.includes('LUMEN©'));
  assert.ok(s.texts.includes('INDEX'));
  assert.ok(s.texts.includes('PROJECTS'));
  assert.ok(s.texts.includes('The creative powerhouse'));
  assert.ok(!s.texts.includes('hidden secret'), 'scripts dropped');
  assert.ok(!s.texts.some((t) => t.includes('color:red')), 'styles dropped');
});

test('extractFromHar aggregates colors from HTML + JS + CSS with frequency', () => {
  const tmp = mkTmp();
  const harPath = path.join(tmp, 'r.har');
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      mkHar([
        {
          request: { url: 'https://x.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              text: '<body><style>body{background:#f0f0f0;color:#141414}</style></body>',
            },
          },
        },
        {
          request: { url: 'https://x.com/app.js' },
          response: {
            content: {
              mimeType: 'application/javascript',
              text: 'const bg = "#f0f0f0"; const hl = "#141414"; const accent = "#e5c07b";',
            },
          },
        },
        {
          request: { url: 'https://x.com/app.css' },
          response: {
            content: {
              mimeType: 'text/css',
              text: '.bg{background:rgb(240 240 240 / 1)} .hl{color:rgb(20,20,20)}',
            },
          },
        },
      ]),
    ),
  );
  const s = extractFromHar(harPath);
  assert.ok(s.colors.hex.includes('#f0f0f0'));
  assert.ok(s.colors.hex.includes('#141414'));
  assert.ok(s.colors.hex.includes('#e5c07b'));
  assert.ok(s.colors.rgb.some((r) => r.startsWith('rgb(240 240 240')));
});

test('extractFromHar guesses a brand from "BRAND©" tokens', () => {
  const tmp = mkTmp();
  const harPath = path.join(tmp, 'r.har');
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      mkHar([
        {
          request: { url: 'https://y.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              text: '<html><body><h1>LUMEN©</h1><p>LUMEN © 2026</p></body></html>',
            },
          },
        },
      ]),
    ),
  );
  const s = extractFromHar(harPath);
  assert.strictEqual(s.brandGuess, 'LUMEN');
});

test('extractFromHar handles base64-encoded bodies', () => {
  const tmp = mkTmp();
  const harPath = path.join(tmp, 'r.har');
  const html = '<html><body><h1>HELLO</h1><style>body{background:#abc123}</style></body></html>';
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      mkHar([
        {
          request: { url: 'https://z.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              encoding: 'base64',
              text: Buffer.from(html).toString('base64'),
            },
          },
        },
      ]),
    ),
  );
  const s = extractFromHar(harPath);
  assert.ok(s.texts.includes('HELLO'));
  assert.ok(s.colors.hex.includes('#abc123'));
});

test('extractFromHar skips binary (image/font) entries', () => {
  const tmp = mkTmp();
  const harPath = path.join(tmp, 'r.har');
  fs.writeFileSync(
    harPath,
    JSON.stringify(
      mkHar([
        {
          request: { url: 'https://z.com/logo.png' },
          response: {
            content: {
              mimeType: 'image/png',
              encoding: 'base64',
              text: Buffer.from('fake-png').toString('base64'),
            },
          },
        },
      ]),
    ),
  );
  const s = extractFromHar(harPath);
  assert.strictEqual(s.texts.length, 0);
  assert.strictEqual(s.colors.hex.length, 0);
});
