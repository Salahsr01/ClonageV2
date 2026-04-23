// src/atlas/embeddings.ts — stub (S3)

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
