// Agent ③ — Generation (stub — to implement in Week 5 of REFACTOR_BRIEF.md §4.5)

export interface GenerationInput {
  planPath: string;
  briefPath: string;
  outputDir: string;
}

export interface GenerationResult {
  indexHtml: string;
  assetsDir: string;
}

export async function generate(_input: GenerationInput): Promise<GenerationResult> {
  throw new Error(
    'agents/generation: not implemented — see src/agents/generation/README.md and REFACTOR_BRIEF.md §4.5',
  );
}
