// Atlas — RAG vectoriel local (REFACTOR_BRIEF.md §4.3)

import * as fs from 'fs';
import * as path from 'path';

import type { GroundSidecar } from '../agents/grounding/schema.js';
import { GroundSidecarSchema } from '../agents/grounding/schema.js';
import type { EmbeddingProvider } from './embeddings.js';
import { loadDefaultEmbedder } from './embeddings.js';
import type { AtlasEntry, AtlasIO } from './store.js';
import { JsonlAtlasStore } from './store.js';
import { buildSectionEmbedText, queryAtlas } from './query.js';
import type { AtlasQuery, AtlasHit } from './query.js';

export type { AtlasQuery, AtlasHit } from './query.js';
export type { AtlasEntry, AtlasIO } from './store.js';
export type { EmbeddingProvider } from './embeddings.js';
export { cosine } from './embeddings.js';
export { HashEmbedding, OpenAIEmbedding, loadDefaultEmbedder } from './embeddings.js';
export { JsonlAtlasStore, MemoryAtlasStore } from './store.js';

export interface IndexInput {
  /** Site directory containing `<role>.html` + `<role>.ground.json` sidecars. */
  kbSectionDir: string;
  site: string;
  embedder?: EmbeddingProvider;
  io?: AtlasIO;
  /** Drop any prior rows for this site before inserting. Default true (prevents duplicates). */
  replaceForSite?: boolean;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
}

export async function indexSite(input: IndexInput): Promise<IndexResult> {
  const { kbSectionDir, site, replaceForSite = true } = input;
  const io = input.io ?? new JsonlAtlasStore();
  const embedder = input.embedder ?? loadDefaultEmbedder();

  if (!fs.existsSync(kbSectionDir)) {
    throw new Error(`kbSectionDir does not exist: ${kbSectionDir}`);
  }

  // Collect sidecars.
  const files = fs
    .readdirSync(kbSectionDir)
    .filter((f) => f.endsWith('.ground.json'))
    .map((f) => path.join(kbSectionDir, f));

  if (files.length === 0) {
    throw new Error(
      `no .ground.json sidecars in ${kbSectionDir} — run Grounding (agents/grounding) first`,
    );
  }

  // Load existing rows; drop those belonging to this site if replaceForSite.
  let existing = io.load();
  if (replaceForSite) {
    existing = existing.filter((e) => e.site !== site);
  }

  const fresh: AtlasEntry[] = [];
  let skipped = 0;
  for (const sidecarPath of files) {
    let sidecar: GroundSidecar;
    try {
      sidecar = GroundSidecarSchema.parse(JSON.parse(fs.readFileSync(sidecarPath, 'utf-8')));
    } catch {
      skipped++;
      continue;
    }

    const roleFromFilename = path.basename(sidecarPath, '.ground.json');
    const htmlPath = path.join(kbSectionDir, `${roleFromFilename}.html`);
    const text = buildSectionEmbedText({ role: roleFromFilename, fiche: sidecar.fiche });
    const vector = await embedder.embed(text);
    const entry: AtlasEntry = {
      id: `${site}#${roleFromFilename}`,
      site,
      role: roleFromFilename,
      source_html: htmlPath,
      fiche: sidecar.fiche,
      embedder_id: embedder.id,
      vector,
    };
    fresh.push(entry);
  }

  io.replace([...existing, ...fresh]);
  return { indexed: fresh.length, skipped };
}

export async function query(q: AtlasQuery, opts?: { io?: AtlasIO; embedder?: EmbeddingProvider }): Promise<AtlasHit[]> {
  const io = opts?.io ?? new JsonlAtlasStore();
  const embedder = opts?.embedder ?? loadDefaultEmbedder();
  return queryAtlas(io, embedder, q);
}

export interface AtlasStats {
  path: string;
  totalEntries: number;
  sites: string[];
  embedderIds: string[];
}

export function stats(io?: AtlasIO): AtlasStats {
  const store = io ?? new JsonlAtlasStore();
  const entries = store.load();
  return {
    path: store.path,
    totalEntries: entries.length,
    sites: Array.from(new Set(entries.map((e) => e.site))).sort(),
    embedderIds: Array.from(new Set(entries.map((e) => e.embedder_id))).sort(),
  };
}
