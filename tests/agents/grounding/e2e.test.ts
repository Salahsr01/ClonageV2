import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ground } from '../../../src/agents/grounding/index.js';
import { FakeVisionLLM } from '../../../src/agents/grounding/llm.js';
import { sampleFiche } from '../../../src/agents/grounding/prompt.js';

function mkTmpKB(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clonage-grounding-'));
}

function writeFixture(dir: string, role: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, `${role}.html`);
  fs.writeFileSync(
    htmlPath,
    `<!DOCTYPE html><html><head><title>${role}</title></head><body>${body}</body></html>`,
    'utf-8',
  );
  return htmlPath;
}

test('ground produces a valid sidecar per section with FakeVisionLLM', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'nav', '<nav class="navbar"><a href="#">Home</a></nav>');
  writeFixture(dir, 'hero', '<section class="hero"><h1>Big title</h1></section>');
  writeFixture(dir, 'about', '<section><h2>About</h2><p>Paragraph.</p></section>');
  writeFixture(dir, 'footer', '<footer><p>&copy; 2026</p></footer>');

  const fakeLLM = new FakeVisionLLM((input) => {
    // Parse role from prompt "tentative role \"X\"" match.
    const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
    const role = m ? m[1] : 'other';
    return JSON.stringify(sampleFiche(role));
  });

  const result = await ground({
    kbSectionDir: dir,
    site: 'test.example.com',
    llm: fakeLLM,
  });

  assert.strictEqual(result.sections.length, 4, '4 sections grounded');
  for (const s of result.sections) {
    assert.ok(fs.existsSync(s.sidecarPath), `sidecar exists for ${s.role}`);
    assert.strictEqual(s.cached, false);
    assert.ok(s.fiche.role);
    assert.ok(s.fiche.mood.length >= 1, 'mood non-empty');
    assert.ok(s.fiche.animations.length >= 1, 'animations non-empty');
  }
});

test('ground is idempotent — second run is fully cached', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'hero', '<section class="hero"><h1>h</h1></section>');

  const fakeLLM = new FakeVisionLLM(() => JSON.stringify(sampleFiche('hero')));

  await ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM });
  const second = await ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM });

  assert.strictEqual(second.sections.length, 1);
  assert.strictEqual(second.sections[0].cached, true, 'second run is cached');
});

test('ground with force=true bypasses cache', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'hero', '<section class="hero"><h1>h</h1></section>');

  let callCount = 0;
  const fakeLLM = new FakeVisionLLM(() => {
    callCount++;
    return JSON.stringify(sampleFiche('hero'));
  });

  await ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM });
  await ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM, force: true });

  assert.strictEqual(callCount, 2, 'LLM called twice with force=true');
});

test('ground retries on invalid JSON and eventually fails', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'hero', '<section><h1>h</h1></section>');

  const fakeLLM = new FakeVisionLLM(() => 'not json at all');

  await assert.rejects(
    ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM, maxRetries: 1 }),
    /grounding failed/,
  );
});

test('ground retries on invalid JSON and eventually succeeds', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'hero', '<section><h1>h</h1></section>');

  let count = 0;
  const fakeLLM = new FakeVisionLLM(() => {
    count++;
    if (count < 2) return 'not json';
    return JSON.stringify(sampleFiche('hero'));
  });

  const result = await ground({
    kbSectionDir: dir,
    site: 'test',
    llm: fakeLLM,
    maxRetries: 2,
  });
  assert.strictEqual(result.sections.length, 1);
  assert.strictEqual(count, 2);
});

test('ground accepts LLM responses wrapped in markdown fences', async () => {
  const dir = mkTmpKB();
  writeFixture(dir, 'hero', '<section><h1>h</h1></section>');

  const fakeLLM = new FakeVisionLLM(
    () => '```json\n' + JSON.stringify(sampleFiche('hero')) + '\n```',
  );

  const result = await ground({ kbSectionDir: dir, site: 'test', llm: fakeLLM });
  assert.strictEqual(result.sections.length, 1);
  assert.strictEqual(result.sections[0].fiche.role, 'hero');
});

// Acceptance test per REFACTOR_BRIEF §6 S2: on a real deep-extract'd KB
// (mersi), produce ≥4 valid fiches with role/mood/animations non-empty.
test('ground e2e on .clonage-kb/sections/www.mersi-architecture.com fixture', async () => {
  const kbDir = path.join(
    process.cwd(),
    '.clonage-kb',
    'sections',
    'www.mersi-architecture.com',
  );
  if (!fs.existsSync(kbDir)) {
    console.log('  ⚠ skipped — mersi KB fixture not present');
    return;
  }
  // Copy to tmp so we don't pollute the real KB with sidecars.
  const tmp = mkTmpKB();
  for (const f of fs.readdirSync(kbDir)) {
    if (f.endsWith('.html')) {
      fs.copyFileSync(path.join(kbDir, f), path.join(tmp, f));
    }
  }
  const fakeLLM = new FakeVisionLLM((input) => {
    const m = input.userPrompt.match(/tentative role \"([^\"]+)\"/);
    const role = m ? m[1] : 'other';
    return JSON.stringify(sampleFiche(role));
  });
  const result = await ground({
    kbSectionDir: tmp,
    site: 'www.mersi-architecture.com',
    llm: fakeLLM,
  });
  assert.ok(
    result.sections.length >= 4,
    `expected ≥4 fiches, got ${result.sections.length}`,
  );
  for (const s of result.sections) {
    assert.ok(s.fiche.role, `role non-empty for ${s.role}`);
    assert.ok(s.fiche.mood.length > 0, `mood non-empty for ${s.role}`);
    assert.ok(s.fiche.animations.length > 0, `animations non-empty for ${s.role}`);
  }
});
