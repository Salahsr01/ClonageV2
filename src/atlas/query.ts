import type { EmbeddingProvider } from './embeddings.js';
import { cosine } from './embeddings.js';
import type { AtlasEntry, AtlasIO } from './store.js';

export interface AtlasQuery {
  brief: string;
  roleFilter?: string;
  moodFilter?: string[];
  siteFilter?: string[];         // allowed sites
  excludeSources?: string[];     // blocked `site#role` ids (used by S6 retry)
  topK?: number;
}

export interface AtlasHit {
  entry: AtlasEntry;
  score: number;
}

/**
 * Brute-force cosine over all entries. At our scale (< 10K sections) this is
 * sub-millisecond; the optimization would be an HNSW/ANN index, deferred
 * until actually needed.
 */
export async function queryAtlas(
  io: AtlasIO,
  embedder: EmbeddingProvider,
  q: AtlasQuery,
): Promise<AtlasHit[]> {
  const entries = io.load();
  if (entries.length === 0) return [];

  // Validate embedder matches the stored vectors.
  const embedderIds = new Set(entries.map((e) => e.embedder_id));
  if (!embedderIds.has(embedder.id)) {
    throw new Error(
      `atlas embedder mismatch: query uses "${embedder.id}" but atlas stores ${[...embedderIds].join(', ')}. ` +
        'Re-run `clonage atlas index` with the same embedder, or set OPENAI_API_KEY to match.',
    );
  }

  const queryVec = await embedder.embed(q.brief);

  const topK = q.topK ?? 5;
  const hits: AtlasHit[] = [];
  for (const entry of entries) {
    if (entry.embedder_id !== embedder.id) continue; // ignore alien rows
    if (q.roleFilter) {
      const role = entry.role;
      const ficheRole = entry.fiche.role;
      const usable = entry.fiche.usable_as || [];
      if (role !== q.roleFilter && ficheRole !== q.roleFilter && !usable.includes(q.roleFilter)) {
        continue;
      }
    }
    if (q.moodFilter && q.moodFilter.length > 0) {
      const moods = new Set(entry.fiche.mood.map((m) => m.toLowerCase()));
      const anyMatch = q.moodFilter.some((m) => moods.has(m.toLowerCase()));
      if (!anyMatch) continue;
    }
    if (q.siteFilter && q.siteFilter.length > 0 && !q.siteFilter.includes(entry.site)) continue;
    if (q.excludeSources && q.excludeSources.length > 0 && q.excludeSources.includes(entry.id)) continue;

    const score = cosine(queryVec, entry.vector);
    hits.push({ entry, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topK);
}

/**
 * Build the text we embed per section. The tuple (signature + role + mood + typo
 * family) is what carries semantic meaning for retrieval. Keep it compact.
 */
export function buildSectionEmbedText(entry: Pick<AtlasEntry, 'role' | 'fiche'>): string {
  const f = entry.fiche;
  const parts = [
    `role: ${entry.role}`,
    `canonical: ${f.role}`,
    `mood: ${f.mood.join(', ')}`,
    `composition: ${f.layout.composition}`,
    `density: ${f.layout.density}`,
    `typo: ${f.typo.display} + ${f.typo.body}`,
    `animations: ${f.animations.map((a) => a.type).join(', ')}`,
    `signature: ${f.signature}`,
    `usable_as: ${f.usable_as.join(', ')}`,
  ];
  return parts.join('\n');
}
