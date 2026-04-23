import { LLMError } from '../utils/llm.js';

/**
 * Pluggable embedding interface. The orchestrator passes an impl; the default
 * loader reads `OPENAI_API_KEY` for production runs or falls back to a
 * deterministic hash-based pseudo-embedder for offline/test use.
 *
 * Our atlas scale is small (<10K vectors), so we don't need dedicated
 * embedding infrastructure — the interface only needs to be cheap per call.
 */
export interface EmbeddingProvider {
  /** Embedding dimensionality. Must be constant across calls. */
  readonly dim: number;
  /** Identifier written into the store so we refuse to query against a mismatched model. */
  readonly id: string;
  embed(text: string): Promise<number[]>;
}

/**
 * OpenAI text-embedding-3-small by default ($0.02 per 1M tokens, 1536 dim).
 * Hits the public REST endpoint — no SDK dep.
 */
export class OpenAIEmbedding implements EmbeddingProvider {
  readonly dim: number;
  readonly id: string;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'text-embedding-3-small', dim = 1536) {
    this.apiKey = apiKey;
    this.model = model;
    this.dim = dim;
    this.id = `openai:${model}:${dim}`;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) {
      const detail = (await res.text()).substring(0, 500);
      throw new LLMError('openai-embeddings', `HTTP ${res.status}`, {
        status: res.status,
        detail,
      });
    }
    const data = (await res.json()) as any;
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new LLMError('openai-embeddings', 'no embedding in response');
    return vec;
  }
}

/**
 * Deterministic pseudo-embedding for tests and offline atlas runs. Uses a
 * trigram-bag hashed into `dim` buckets with L2 normalization. Produces
 * reasonable semantic locality for similar strings — enough for smoke tests.
 *
 * NOT a real embedding. Do not use for production retrieval.
 */
export class HashEmbedding implements EmbeddingProvider {
  readonly dim: number;
  readonly id: string;

  constructor(dim = 256) {
    this.dim = dim;
    this.id = `hash-trigram:${dim}`;
  }

  async embed(text: string): Promise<number[]> {
    const v = new Array<number>(this.dim).fill(0);
    const s = text.toLowerCase();
    for (let i = 0; i < s.length - 2; i++) {
      const gram = s.substring(i, i + 3);
      let h = 2166136261;
      for (let j = 0; j < gram.length; j++) {
        h ^= gram.charCodeAt(j);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) | 0;
      }
      const idx = Math.abs(h) % this.dim;
      v[idx] += 1;
    }
    // L2 normalize
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < v.length; i++) v[i] /= norm;
    return v;
  }
}

export function loadDefaultEmbedder(): EmbeddingProvider {
  const key = process.env.OPENAI_API_KEY;
  if (key) {
    const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
    return new OpenAIEmbedding(key, model);
  }
  // Warn once — hash embedder is for offline + tests only.
  console.warn(
    '[atlas] OPENAI_API_KEY not set — falling back to HashEmbedding (test-grade). Set the key for real semantic retrieval.',
  );
  return new HashEmbedding(512);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
