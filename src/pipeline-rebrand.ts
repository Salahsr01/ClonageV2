// pipeline-rebrand.ts — end-to-end: record → brief-gen → rebrand-har [→ replay]
//
// Used by `clonage clone-and-rebrand <url> --for "<desc>"`. Sits at the same
// level as `pipeline-compose.ts` but targets the HAR-native rebrand flow
// (vs. the compose flow which needs multi-site atlas + generation).

import * as fs from 'fs';
import * as path from 'path';

import type { VisionLLM } from './agents/grounding/llm.js';
import { generateBrief, writeBrief } from './brief-gen/index.js';
import { rebrandClone } from './rebrand-har/index.js';
import { logger } from './utils/logger.js';

export interface CloneAndRebrandInput {
  url: string;
  targetDescription: string;
  outputRoot?: string;
  recordTimeoutMs?: number;
  /** Injected to ease testing. Default = calls the real Recorder. */
  recordFn?: (url: string, outputDir: string, timeoutMs: number) => Promise<string>;
  llm?: VisionLLM;
  /** Start a `replay` after the rebrand. Default true. */
  replayAfter?: boolean;
}

export interface CloneAndRebrandResult {
  sourceCloneDir: string;
  briefPath: string;
  rebrandedCloneDir: string;
  stats: {
    briefCopyEntries: number;
    harEntriesModified: number;
    harTotalHits: number;
  };
}

export async function cloneAndRebrand(input: CloneAndRebrandInput): Promise<CloneAndRebrandResult> {
  const {
    url,
    targetDescription,
    outputRoot = './output',
    recordTimeoutMs = 90_000,
    replayAfter = true,
  } = input;

  const record = input.recordFn ?? defaultRecord;

  logger.step(1, replayAfter ? 4 : 3, `Record: ${url}`);
  const sourceCloneDir = await record(url, outputRoot, recordTimeoutMs);

  logger.step(2, replayAfter ? 4 : 3, `Brief-gen from ${path.basename(sourceCloneDir)}`);
  const briefResult = await generateBrief({
    cloneDir: sourceCloneDir,
    targetDescription,
    llm: input.llm,
  });
  const briefPath = path.join(sourceCloneDir, '_rebrand_brief.json');
  writeBrief(briefResult.brief, briefPath);
  logger.info(
    `  brand: ${briefResult.brief.brand?.source_name ?? '(none)'} → ${briefResult.brief.brand?.name ?? '(none)'} | copy entries: ${briefResult.brief.copy.length}`,
  );

  logger.step(3, replayAfter ? 4 : 3, 'Rebrand HAR');
  const rebrandedCloneDir = sourceCloneDir + '-rebranded';
  const rebrandResult = rebrandClone({
    cloneDir: sourceCloneDir,
    outputCloneDir: rebrandedCloneDir,
    brief: briefResult.brief,
  });
  logger.info(
    `  ${rebrandResult.entriesModified} entries modified, ${rebrandResult.totalHits} total hits`,
  );

  if (replayAfter) {
    logger.step(4, 4, 'Replay (open Chromium)');
    const { Replay } = await import('./replay/index.js');
    const replay = new Replay({ recordingDir: rebrandedCloneDir, notFound: 'fallback' });
    await replay.start();
  }

  return {
    sourceCloneDir,
    briefPath,
    rebrandedCloneDir,
    stats: {
      briefCopyEntries: briefResult.brief.copy.length,
      harEntriesModified: rebrandResult.entriesModified,
      harTotalHits: rebrandResult.totalHits,
    },
  };
}

/**
 * Default record impl: delegates to the Recorder (intouchable per §2).
 * Wraps it to return the clone dir path.
 */
async function defaultRecord(url: string, outputRoot: string, timeoutMs: number): Promise<string> {
  const { Recorder } = await import('./recorder/index.js');
  const recorder = new Recorder({
    url,
    outputDir: outputRoot,
    viewport: { name: 'desktop', width: 1920, height: 1080 },
    timeout: timeoutMs,
    maxPages: 1,
    headless: true,
  });
  const dir = await recorder.record();
  if (!dir) {
    // Older Recorder impls return void and compute dir internally.
    return resolveLatestCloneDir(outputRoot, url);
  }
  return dir;
}

/**
 * Fallback: if record() doesn't return a path, scan `outputRoot` for the
 * freshest dir whose name matches the URL's host.
 */
function resolveLatestCloneDir(outputRoot: string, url: string): string {
  const host = new URL(url).hostname;
  const entries = fs
    .readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(host.replace(/^www\./, '')))
    .map((d) => ({
      name: d.name,
      path: path.join(outputRoot, d.name),
      mtime: fs.statSync(path.join(outputRoot, d.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (entries.length === 0) {
    throw new Error(`clone-and-rebrand: no clone dir found under ${outputRoot} matching ${host}`);
  }
  return entries[0].path;
}
