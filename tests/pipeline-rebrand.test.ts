import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cloneAndRebrand } from '../src/pipeline-rebrand.js';
import { FakeVisionLLM } from '../src/agents/grounding/llm.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clone-and-rebrand-'));
}

function seedClone(outputRoot: string): string {
  const cloneDir = path.join(outputRoot, 'example.com_2026-04-23');
  fs.mkdirSync(cloneDir, { recursive: true });
  fs.writeFileSync(
    path.join(cloneDir, 'recording.har'),
    JSON.stringify({
      log: {
        entries: [
          {
            request: { url: 'https://example.com/' },
            response: {
              content: {
                mimeType: 'text/html',
                text: '<html><body><h1>NAUGHTYDUK©</h1><p>DIGITAL INNOVATION STUDIO</p><style>body{background:#f0f0f0}</style></body></html>',
              },
            },
          },
          {
            request: { url: 'https://example.com/app.js' },
            response: {
              content: {
                mimeType: 'application/javascript',
                text: 'const brand = "NAUGHTYDUK"; const bg = "#f0f0f0";',
              },
            },
          },
        ],
      },
    }),
  );
  return cloneDir;
}

test('cloneAndRebrand chains record → brief-gen → rebrand-har', async () => {
  const outputRoot = mkTmp();
  const fakeLLM = new FakeVisionLLM(() =>
    JSON.stringify({
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [
        { from: 'DIGITAL INNOVATION STUDIO', to: 'ARCHITECTURE STUDIO' },
        { from: '#f0f0f0', to: '#0d2e5c' },
      ],
    }),
  );
  const result = await cloneAndRebrand({
    url: 'https://example.com/',
    targetDescription: 'studio d\'architecture moody marseille',
    outputRoot,
    recordFn: async (_url, outDir) => seedClone(outDir),
    llm: fakeLLM,
    replayAfter: false,
  });

  assert.ok(fs.existsSync(result.briefPath), 'brief file written');
  const rebrandedHar = path.join(result.rebrandedCloneDir, 'recording.har');
  assert.ok(fs.existsSync(rebrandedHar), 'rebranded HAR written');

  const out = JSON.parse(fs.readFileSync(rebrandedHar, 'utf-8'));
  const htmlText: string = out.log.entries[0].response.content.text;
  assert.match(htmlText, /LUMEN STUDIO©/);
  assert.match(htmlText, /ARCHITECTURE STUDIO/);
  assert.match(htmlText, /#0d2e5c/);

  const jsText: string = out.log.entries[1].response.content.text;
  assert.match(jsText, /"LUMEN STUDIO"/);
  assert.match(jsText, /"#0d2e5c"/);

  assert.ok(result.stats.harTotalHits > 0);
  assert.ok(result.stats.briefCopyEntries >= 2);
});

test('cloneAndRebrand propagates error when recordFn throws', async () => {
  const outputRoot = mkTmp();
  const llm = new FakeVisionLLM(() => '{}');
  await assert.rejects(
    cloneAndRebrand({
      url: 'https://example.com/',
      targetDescription: 'x',
      outputRoot,
      recordFn: async () => {
        throw new Error('recording failed');
      },
      llm,
      replayAfter: false,
    }),
    /recording failed/,
  );
});

test('cloneAndRebrand rejects when LLM returns invalid brief', async () => {
  const outputRoot = mkTmp();
  const llm = new FakeVisionLLM(() => 'not valid json');
  await assert.rejects(
    cloneAndRebrand({
      url: 'https://example.com/',
      targetDescription: 'x',
      outputRoot,
      recordFn: async (_url, outDir) => seedClone(outDir),
      llm,
      replayAfter: false,
    }),
    /brief-gen failed/,
  );
});
