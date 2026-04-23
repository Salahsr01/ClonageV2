import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { GroundFicheSchema } from '../agents/grounding/schema.js';

/**
 * One row of the atlas. Stored as JSON Lines in `.clonage-kb/atlas.jsonl` so
 * the file is append-friendly and human-inspectable.
 */
export const AtlasEntrySchema = z.object({
  id: z.string(),                    // stable id: `${site}#${role}`
  site: z.string(),
  role: z.string(),
  source_html: z.string(),           // path to the section HTML
  fiche: GroundFicheSchema,
  embedder_id: z.string(),           // e.g. "openai:text-embedding-3-small:1536"
  vector: z.array(z.number()),       // the embedding
});

export type AtlasEntry = z.infer<typeof AtlasEntrySchema>;

export interface AtlasIO {
  load(): AtlasEntry[];
  append(entry: AtlasEntry): void;
  replace(entries: AtlasEntry[]): void;
  path: string;
}

/**
 * JSONL-backed atlas persisted on disk. Writes are append-only; `replace`
 * rewrites the whole file.
 */
export class JsonlAtlasStore implements AtlasIO {
  readonly path: string;

  constructor(filePath?: string) {
    this.path = filePath ?? path.join(process.cwd(), '.clonage-kb', 'atlas.jsonl');
  }

  load(): AtlasEntry[] {
    if (!fs.existsSync(this.path)) return [];
    const raw = fs.readFileSync(this.path, 'utf-8');
    const out: AtlasEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(AtlasEntrySchema.parse(JSON.parse(line)));
      } catch {
        // Skip malformed lines silently — they can be fixed with `atlas rebuild`.
      }
    }
    return out;
  }

  append(entry: AtlasEntry): void {
    const validated = AtlasEntrySchema.parse(entry);
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    fs.appendFileSync(this.path, JSON.stringify(validated) + '\n', 'utf-8');
  }

  replace(entries: AtlasEntry[]): void {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const text = entries.map((e) => JSON.stringify(AtlasEntrySchema.parse(e))).join('\n') + '\n';
    fs.writeFileSync(this.path, text, 'utf-8');
  }
}

/**
 * In-memory store used by tests.
 */
export class MemoryAtlasStore implements AtlasIO {
  readonly path = ':memory:';
  private entries: AtlasEntry[] = [];

  load(): AtlasEntry[] {
    return [...this.entries];
  }
  append(entry: AtlasEntry): void {
    this.entries.push(AtlasEntrySchema.parse(entry));
  }
  replace(entries: AtlasEntry[]): void {
    this.entries = entries.map((e) => AtlasEntrySchema.parse(e));
  }
}
