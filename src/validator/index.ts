// Validator — boucle de validation (stub — to implement in Week 6 of REFACTOR_BRIEF.md §4.6)

export interface ValidationInput {
  generatedDir: string;
  planPath: string;
}

export interface ValidationResult {
  passed: boolean;
  perSection: Array<{ role: string; diffPct: number; coherent: boolean; reason?: string }>;
  failureReport?: string;
}

export async function validate(_input: ValidationInput): Promise<ValidationResult> {
  throw new Error(
    'validator: not implemented — see src/validator/README.md and REFACTOR_BRIEF.md §4.6',
  );
}
