// Agent ① — Grounding (stub — to implement in Week 2 of REFACTOR_BRIEF.md §4.2)

export interface GroundingInput {
  cloneDir: string;
  force?: boolean;
}

export interface GroundingResult {
  sections: Array<{
    role: string;
    groundPath: string;
  }>;
}

export async function ground(_input: GroundingInput): Promise<GroundingResult> {
  throw new Error(
    'agents/grounding: not implemented — see src/agents/grounding/README.md and REFACTOR_BRIEF.md §4.2',
  );
}
