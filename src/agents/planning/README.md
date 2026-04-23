# Agent ② — Planning (S4)

Status: **stub — to implement in Week 4** (REFACTOR_BRIEF.md §4.4)

## Input

- A brand brief JSON (e.g. `briefs/nova-aerospace.json`).
- A queryable atlas (`src/atlas/`) populated by Grounding runs.

## Output

`generated/<brand>/_plan.json`:

```ts
{
  sections: Array<{
    role: 'navbar' | 'hero' | 'about' | 'works' | 'services' | 'cta' | 'contact' | 'footer',
    source: string,        // e.g. "mersi#navbar-split"
    reason: string
  }>,
  design_constraints: {
    palette_reference: string,  // which source imposes the palette
    typo_reference: string,     // which source imposes the typography
    rhythm_reference: string    // which source imposes vertical spacing
  },
  coherence_notes: string       // 1-paragraph rationale
}
```

## Pipeline

1. For each canonical role (navbar, hero, about, ...), query the atlas for top-5 candidates with the brief.
2. Hand the LLM a compact payload: the brief + candidates (with `signature + mood + palette`).
3. LLM composes the plan JSON.
4. Validate against zod schema. If sources don't exist in atlas: reject + retry.

## CRITICAL: Plan Approval Mode

- `clonage plan --brief X` runs **only** Planning. It does NOT chain to Generation.
- The plan is printed as a readable ASCII table and written to disk.
- The user may edit `_plan.json` by hand (swap sources, drop sections).
- `clonage generate <plan.json>` reads the edited plan and runs Generation.

## Non-goals

- **Never generate HTML.** Output is strictly JSON.
- **Never auto-chain to Generation.**
