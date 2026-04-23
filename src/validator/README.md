# Validator — boucle de validation (S6)

Status: **stub — to implement in Week 6** (REFACTOR_BRIEF.md §4.6)

## Purpose

After Generation, ensure the output is visually coherent with its sources. Trigger retries via Planning if not.

## Pipeline

1. Launch Playwright, screenshot the generated site section by section.
2. For each section, `pixelmatch` vs. its source screenshot. Tolerance 5%.
3. If diff > 5%: call Claude Vision with both screenshots. Ask "is this composition coherent?". Binary verdict + reason.
4. If verdict negative: feed structured feedback back to Planning with exclusion list. Retry cap = 3.
5. After 3 retries: write `_failure_report.json` and stop.

## Files

- `screenshot-diff.ts` — pixelmatch wrapper.
- `fingerprint-check.ts` — verify nodes/scripts/keyframes parity with sources.
- `vision-critique.ts` — Claude Vision critic.
- `index.ts` — orchestrator.
