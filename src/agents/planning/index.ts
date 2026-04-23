// Agent ② — Planning (stub — to implement in Week 4 of REFACTOR_BRIEF.md §4.4)

export interface PlanningInput {
  briefPath: string;
  atlasPath?: string;
}

export interface Plan {
  sections: Array<{ role: string; source: string; reason: string }>;
  design_constraints: {
    palette_reference: string;
    typo_reference: string;
    rhythm_reference: string;
  };
  coherence_notes: string;
}

export async function plan(_input: PlanningInput): Promise<Plan> {
  throw new Error(
    'agents/planning: not implemented — see src/agents/planning/README.md and REFACTOR_BRIEF.md §4.4',
  );
}
