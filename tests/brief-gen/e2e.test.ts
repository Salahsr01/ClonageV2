import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateBrief, writeBrief } from '../../src/brief-gen/index.js';
import { FakeVisionLLM } from '../../src/agents/grounding/llm.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-briefgen-'));
}

function mkFakeClone(): string {
  const dir = mkTmp();
  const har = {
    log: {
      version: '1.2',
      entries: [
        {
          request: { url: 'https://source.com/' },
          response: {
            content: {
              mimeType: 'text/html',
              text: `<html><body>
                <h1>NAUGHTYDUK©</h1>
                <p>DIGITAL INNOVATION STUDIO</p>
                <p>Manchester, UK</p>
                <style>body{background:#f0f0f0;color:#141414}</style>
              </body></html>`,
            },
          },
        },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, 'recording.har'), JSON.stringify(har));
  fs.mkdirSync(path.join(dir, '_screenshots'));
  fs.writeFileSync(path.join(dir, '_screenshots', 'initial.png'), Buffer.from('fake-png'));
  return dir;
}

test('generateBrief calls the LLM with extracted signals and parses JSON', async () => {
  const clone = mkFakeClone();
  let captured = '';

  const llm = new FakeVisionLLM((input) => {
    captured = input.userPrompt;
    return JSON.stringify({
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [
        { from: 'DIGITAL INNOVATION STUDIO', to: 'ARCHITECTURE & DESIGN STUDIO' },
        { from: 'Manchester, UK', to: 'Marseille, FR' },
        { from: '#f0f0f0', to: '#0d2e5c' },
      ],
    });
  });

  const result = await generateBrief({
    cloneDir: clone,
    targetDescription: 'Architecture studio in Marseille, moody minimal',
    llm,
  });

  // Prompt received the extracted texts + colors
  assert.match(captured, /NAUGHTYDUK©/);
  assert.match(captured, /#f0f0f0/);
  assert.match(captured, /Architecture studio in Marseille/);

  // Brief is valid
  assert.strictEqual(result.brief.brand?.source_name, 'NAUGHTYDUK');
  assert.strictEqual(result.brief.brand?.name, 'LUMEN STUDIO');
  assert.strictEqual(result.brief.copy.length, 3);
});

test('generateBrief retries on invalid JSON and succeeds', async () => {
  const clone = mkFakeClone();
  let calls = 0;
  const llm = new FakeVisionLLM(() => {
    calls++;
    if (calls < 2) return 'not json';
    return JSON.stringify({
      brand: { source_name: 'NAUGHTYDUK', name: 'LUMEN STUDIO' },
      copy: [],
    });
  });
  const result = await generateBrief({
    cloneDir: clone,
    targetDescription: 'retry test',
    llm,
    maxRetries: 2,
  });
  assert.strictEqual(calls, 2);
  assert.strictEqual(result.brief.brand?.name, 'LUMEN STUDIO');
});

test('generateBrief throws after maxRetries exhausted', async () => {
  const clone = mkFakeClone();
  const llm = new FakeVisionLLM(() => 'not json');
  await assert.rejects(
    generateBrief({
      cloneDir: clone,
      targetDescription: 'bad llm',
      llm,
      maxRetries: 1,
    }),
    /brief-gen failed/,
  );
});

test('generateBrief accepts LLM responses wrapped in markdown fences', async () => {
  const clone = mkFakeClone();
  const llm = new FakeVisionLLM(
    () =>
      '```json\n' +
      JSON.stringify({ brand: { source_name: 'A', name: 'B' }, copy: [] }) +
      '\n```',
  );
  const result = await generateBrief({
    cloneDir: clone,
    targetDescription: 'fence test',
    llm,
  });
  assert.strictEqual(result.brief.brand?.name, 'B');
});

test('generateBrief throws when recording.har is missing', async () => {
  const clone = mkTmp();
  const llm = new FakeVisionLLM(() => '{}');
  await assert.rejects(
    generateBrief({
      cloneDir: clone,
      targetDescription: 'missing har',
      llm,
    }),
    /recording\.har not found/,
  );
});

test('writeBrief persists the brief as pretty JSON', () => {
  const out = path.join(mkTmp(), 'brief.json');
  writeBrief(
    {
      brand: { source_name: 'A', name: 'B' },
      copy: [{ from: 'x', to: 'y' }],
    },
    out,
  );
  const loaded = JSON.parse(fs.readFileSync(out, 'utf-8'));
  assert.strictEqual(loaded.brand.source_name, 'A');
  assert.strictEqual(loaded.copy[0].to, 'y');
});
