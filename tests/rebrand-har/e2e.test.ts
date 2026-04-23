import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rebrandHar, rebrandClone } from '../../src/rebrand-har/index.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-rebrand-har-'));
}

/** Build a minimal HAR with HTML + JS + CSS + a binary (image) entry. */
function mkFakeHar(): any {
  return {
    log: {
      version: '1.2',
      entries: [
        {
          request: { url: 'https://example.com/' },
          response: {
            status: 200,
            headers: [
              { name: 'Content-Type', value: 'text/html' },
              { name: 'Content-Length', value: '200' },
            ],
            content: {
              mimeType: 'text/html',
              text: '<html><body><h1>NAUGHTYDUK©</h1><style>body{background:#f0f0f0}</style></body></html>',
            },
          },
        },
        {
          request: { url: 'https://example.com/app.js' },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'application/javascript' }],
            content: {
              mimeType: 'application/javascript',
              text: 'var name = "NAUGHTYDUK"; var bg = "#f0f0f0";',
            },
          },
        },
        {
          request: { url: 'https://example.com/app.css' },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'text/css' }],
            content: {
              mimeType: 'text/css',
              text: '.bg-light{background:rgb(240 240 240 / 1);color:#f0f0f0}',
            },
          },
        },
        {
          request: { url: 'https://example.com/logo.png' },
          response: {
            status: 200,
            headers: [{ name: 'Content-Type', value: 'image/png' }],
            content: {
              mimeType: 'image/png',
              encoding: 'base64',
              text: 'iVBORw0KGgoAAAAN', // fake base64
            },
          },
        },
      ],
    },
  };
}

test('rebrandHar rewrites text entries across HTML + JS + CSS', () => {
  const tmp = mkTmp();
  const harIn = path.join(tmp, 'in.har');
  const harOut = path.join(tmp, 'out.har');
  fs.writeFileSync(harIn, JSON.stringify(mkFakeHar()));

  const result = rebrandHar({
    harIn,
    harOut,
    brief: {
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [
        { from: '#f0f0f0', to: '#0d2e5c' },
        { from: 'rgb(240 240 240', to: 'rgb(13 46 92' },
      ],
    },
  });

  assert.strictEqual(result.entriesModified, 3, 'HTML + JS + CSS modified, PNG skipped');

  const out = JSON.parse(fs.readFileSync(harOut, 'utf-8'));
  const [htmlEntry, jsEntry, cssEntry, pngEntry] = out.log.entries;
  assert.match(htmlEntry.response.content.text, /LUMEN STUDIO©/);
  assert.match(htmlEntry.response.content.text, /background:#0d2e5c/);
  assert.match(jsEntry.response.content.text, /"LUMEN STUDIO"/);
  assert.match(jsEntry.response.content.text, /"#0d2e5c"/);
  assert.match(cssEntry.response.content.text, /rgb\(13 46 92 \/ 1\)/);
  // PNG is a binary image — must stay identical.
  assert.strictEqual(pngEntry.response.content.text, 'iVBORw0KGgoAAAAN');
});

test('rebrandHar updates Content-Length header when body length changes', () => {
  const tmp = mkTmp();
  const harIn = path.join(tmp, 'in.har');
  const harOut = path.join(tmp, 'out.har');
  fs.writeFileSync(harIn, JSON.stringify(mkFakeHar()));

  rebrandHar({
    harIn,
    harOut,
    brief: {
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO INC' },
      copy: [],
    },
  });
  const out = JSON.parse(fs.readFileSync(harOut, 'utf-8'));
  const html = out.log.entries[0];
  const cl = html.response.headers.find((h: any) => h.name.toLowerCase() === 'content-length');
  assert.ok(cl);
  assert.strictEqual(cl.value, String(Buffer.byteLength(html.response.content.text, 'utf-8')));
});

test('rebrandHar handles base64-encoded text bodies', () => {
  const tmp = mkTmp();
  const harIn = path.join(tmp, 'in.har');
  const harOut = path.join(tmp, 'out.har');
  const har = {
    log: {
      entries: [
        {
          request: { url: 'https://example.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              encoding: 'base64',
              text: Buffer.from('<h1>NAUGHTYDUK</h1>').toString('base64'),
            },
          },
        },
      ],
    },
  };
  fs.writeFileSync(harIn, JSON.stringify(har));
  rebrandHar({
    harIn,
    harOut,
    brief: { brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' }, copy: [] },
  });
  const out = JSON.parse(fs.readFileSync(harOut, 'utf-8'));
  const decoded = Buffer.from(out.log.entries[0].response.content.text, 'base64').toString('utf-8');
  assert.match(decoded, /LUMEN STUDIO/);
});

test('rebrandHar accepts brief as JSON file path', () => {
  const tmp = mkTmp();
  const harIn = path.join(tmp, 'in.har');
  const harOut = path.join(tmp, 'out.har');
  const briefPath = path.join(tmp, 'brief.json');
  fs.writeFileSync(harIn, JSON.stringify(mkFakeHar()));
  fs.writeFileSync(
    briefPath,
    JSON.stringify({
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [],
    }),
  );
  const result = rebrandHar({ harIn, harOut, brief: briefPath });
  assert.ok(result.totalHits > 0);
});

test('rebrandHar throws on invalid HAR shape', () => {
  const tmp = mkTmp();
  const harIn = path.join(tmp, 'bad.har');
  const harOut = path.join(tmp, 'out.har');
  fs.writeFileSync(harIn, JSON.stringify({ not: 'a har' }));
  assert.throws(
    () => rebrandHar({ harIn, harOut, brief: { copy: [] } }),
    /log\.entries missing/,
  );
});

test('rebrandClone copies the whole clone dir + rewrites the HAR', () => {
  const srcDir = mkTmp();
  fs.writeFileSync(path.join(srcDir, 'recording.har'), JSON.stringify(mkFakeHar()));
  fs.writeFileSync(path.join(srcDir, 'metadata.json'), JSON.stringify({ url: 'x' }));
  fs.mkdirSync(path.join(srcDir, 'media'));
  fs.writeFileSync(path.join(srcDir, 'media', 'video.mp4'), 'fake-mp4-bytes');

  const dstDir = path.join(mkTmp(), 'out');
  const result = rebrandClone({
    cloneDir: srcDir,
    outputCloneDir: dstDir,
    brief: {
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [],
    },
  });
  assert.ok(fs.existsSync(path.join(dstDir, 'recording.har')));
  assert.ok(fs.existsSync(path.join(dstDir, 'metadata.json')));
  assert.ok(fs.existsSync(path.join(dstDir, 'media', 'video.mp4')));
  assert.ok(result.totalHits > 0);
});

test('rebrandClone errors if recording.har is missing', () => {
  const srcDir = mkTmp();
  // No recording.har
  const dstDir = path.join(mkTmp(), 'out');
  assert.throws(
    () =>
      rebrandClone({
        cloneDir: srcDir,
        outputCloneDir: dstDir,
        brief: { copy: [] },
      }),
    /recording\.har/,
  );
});
