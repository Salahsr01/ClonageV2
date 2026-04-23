// rebrand-har — rewrite text response bodies inside a HAR with brand
// substitutions, keeping binary assets (images / fonts / videos) untouched.
//
// Design (REFACTOR_BRIEF §2 — crawler + record + replay are intouchable, so
// this module does NOT modify them; it sits alongside as a post-processing
// transformer that takes a HAR in and emits a HAR out).

import * as fs from 'fs';
import * as path from 'path';

import type { RebrandHarBrief } from './schema.js';
import { RebrandHarBriefSchema } from './schema.js';

export type { RebrandHarBrief } from './schema.js';
export { RebrandHarBriefSchema } from './schema.js';

/** MIME types we treat as text and rewrite. Everything else passes through. */
const TEXT_MIMES = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'text/plain',
  'image/svg+xml',
]);

export interface RebrandHarInput {
  /** Path to the source recording.har produced by `clonage record`. */
  harIn: string;
  /** Path where the rewritten HAR is written. */
  harOut: string;
  /** Brief — either a path to JSON or an already-parsed object. */
  brief: RebrandHarBrief | string;
}

export interface EntryReport {
  url: string;
  mime: string;
  hits: number;
}

export interface RebrandHarResult {
  patternsApplied: number;
  entriesModified: number;
  totalHits: number;
  perEntry: EntryReport[];
  outPath: string;
}

/**
 * Expand a brief into the flat substitution pairs applied to every text body.
 * Brand case variations are auto-derived.
 */
export function briefToPairs(brief: RebrandHarBrief): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (brief.brand) {
    const { source_name: src, name: dst } = brief.brand;
    pairs.push([src.toUpperCase(), dst.toUpperCase()]);
    pairs.push([src, dst]);
    pairs.push([src.toLowerCase(), dst.toLowerCase()]);
    pairs.push([`${src.toUpperCase()}©`, `${dst.toUpperCase()}©`]);
    pairs.push([`${src}©`, `${dst}©`]);
  }
  for (const c of brief.copy) pairs.push([c.from, c.to]);
  // Dedup preserving first-seen order; sort by length desc so longer
  // patterns match before their substrings.
  const seen = new Set<string>();
  const dedup: Array<[string, string]> = [];
  for (const [from, to] of pairs) {
    if (seen.has(from)) continue;
    seen.add(from);
    dedup.push([from, to]);
  }
  dedup.sort((a, b) => b[0].length - a[0].length);
  return dedup;
}

/**
 * Apply all substitution pairs to a text body. Returns the new body + how
 * many distinct patterns fired at least once.
 */
export function applyPairsToBody(body: string, pairs: Array<[string, string]>): { body: string; hits: number } {
  let out = body;
  let hits = 0;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) continue;
    out = out.split(from).join(to);
    hits++;
  }
  return { body: out, hits };
}

function loadBrief(brief: RebrandHarBrief | string): RebrandHarBrief {
  if (typeof brief === 'string') {
    const parsed = JSON.parse(fs.readFileSync(brief, 'utf-8'));
    return RebrandHarBriefSchema.parse(parsed);
  }
  return RebrandHarBriefSchema.parse(brief);
}

export function rebrandHar(input: RebrandHarInput): RebrandHarResult {
  const brief = loadBrief(input.brief);
  const pairs = briefToPairs(brief);

  const har = JSON.parse(fs.readFileSync(input.harIn, 'utf-8'));
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error(`rebrand-har: invalid HAR at ${input.harIn} — log.entries missing`);
  }

  const perEntry: EntryReport[] = [];
  let entriesModified = 0;
  let totalHits = 0;

  for (const e of entries) {
    const mime = String(e?.response?.content?.mimeType ?? '').split(';')[0].trim();
    if (!TEXT_MIMES.has(mime)) continue;
    const body = e.response.content.text;
    if (typeof body !== 'string' || !body) continue;

    const encoding: string | undefined = e.response.content.encoding;
    const isBase64 = encoding === 'base64';
    let decoded: string;
    try {
      decoded = isBase64 ? Buffer.from(body, 'base64').toString('utf-8') : body;
    } catch {
      continue;
    }

    const { body: modified, hits } = applyPairsToBody(decoded, pairs);
    if (hits === 0 || modified === decoded) continue;

    e.response.content.text = isBase64
      ? Buffer.from(modified, 'utf-8').toString('base64')
      : modified;
    const newBytes = Buffer.byteLength(modified, 'utf-8');
    e.response.content.size = newBytes;
    if (Array.isArray(e.response.headers)) {
      for (const h of e.response.headers) {
        if (typeof h?.name === 'string' && h.name.toLowerCase() === 'content-length') {
          h.value = String(newBytes);
        }
      }
    }

    entriesModified++;
    totalHits += hits;
    perEntry.push({ url: String(e.request?.url ?? ''), mime, hits });
  }

  fs.mkdirSync(path.dirname(path.resolve(input.harOut)), { recursive: true });
  fs.writeFileSync(input.harOut, JSON.stringify(har, null, 2), 'utf-8');

  return {
    patternsApplied: pairs.length,
    entriesModified,
    totalHits,
    perEntry,
    outPath: input.harOut,
  };
}

/**
 * Helper: given a clone dir produced by `clonage record` (containing
 * `recording.har`), clone it to a new dir and apply the brief to the HAR.
 * This is what the CLI command wraps.
 */
export function rebrandClone(input: {
  cloneDir: string;
  brief: RebrandHarBrief | string;
  outputCloneDir: string;
}): RebrandHarResult {
  const srcHar = path.join(input.cloneDir, 'recording.har');
  if (!fs.existsSync(srcHar)) {
    throw new Error(
      `rebrand-har: ${srcHar} not found — run \`clonage record <url>\` first`,
    );
  }
  // Clone the whole dir so replay keeps all media + screenshots.
  fs.mkdirSync(input.outputCloneDir, { recursive: true });
  copyDir(input.cloneDir, input.outputCloneDir);
  const dstHar = path.join(input.outputCloneDir, 'recording.har');
  return rebrandHar({ harIn: srcHar, harOut: dstHar, brief: input.brief });
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(s);
      try {
        fs.symlinkSync(target, d);
      } catch {
        fs.copyFileSync(s, d);
      }
    } else {
      fs.copyFileSync(s, d);
    }
  }
}
