// Atlas — RAG vectoriel (stub — to implement in Week 3 of REFACTOR_BRIEF.md §4.3)

export interface AtlasQuery {
  brief: string;
  roleFilter?: string;
  moodFilter?: string[];
  topK?: number;
}

export interface GroundedSection {
  site: string;
  role: string;
  signature: string;
  mood: string[];
  palette_dominant: string[];
  score: number;
}

export async function query(_q: AtlasQuery): Promise<GroundedSection[]> {
  throw new Error(
    'atlas/query: not implemented — see src/atlas/README.md and REFACTOR_BRIEF.md §4.3',
  );
}

export async function index(_cloneDir: string): Promise<{ indexed: number }> {
  throw new Error(
    'atlas/index: not implemented — see src/atlas/README.md and REFACTOR_BRIEF.md §4.3',
  );
}
