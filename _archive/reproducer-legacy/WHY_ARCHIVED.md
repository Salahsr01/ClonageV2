# Why `src/reproducer/` (legacy v1) was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/reproducer/` and `tests/reproducer/fidelity.test.ts`
**REFACTOR_BRIEF.md reference:** §3 — "Remplacé il y a longtemps par reproducer-exact/"

## What this module did

`src/reproducer/` was the v1 reproduction engine that took a crawled
recording and rebuilt a clean HTML+CSS copy. It was the backing for the
(now-commented) `reproduce` CLI command.

Its sole remaining consumer was `tests/reproducer/fidelity.test.ts`, a
regression test that measured pixel-diff of the legacy reproducer against
the original screenshot (scoring ~61% diff — a known limitation, flagged
in the test output itself).

## Why it was archived

1. **Replaced by `src/reproducer-exact/`** — the current, pixel-perfect,
   computed-styles-based engine (memory #114, Apr 17, 2026).
2. **Coexistence is confusing** — keeping both modules risks future code
   accidentally importing the legacy one.
3. **The fidelity test showed the gap** — 61% diff vs. the <5% target of
   reproducer-exact. Keeping that test around as a benchmark is fine, but
   as part of the archived legacy, not the main test suite.

## What stays / what doesn't

| Concern                                                | Destination                         |
|---|---|
| `src/reproducer/index.ts`                               | `_archive/reproducer-legacy/`        |
| `tests/reproducer/fidelity.test.ts` (imports v1)        | `_archive/reproducer-legacy/`        |
| `tests/reproducer/class-naming.test.ts`                 | stays — tests naming logic (reproducer-exact uses same) |
| `tests/reproducer/css-variables.test.ts`                | stays — tests browser CSS var extraction |
| `tests/reproducer/multi-viewport.test.ts`               | stays — tests viewport capture   |
| `tests/reproducer/pixel-diff.test.ts`                   | stays — tests the pixel-diff utility |
| `tests/reproducer/pseudo-elements.test.ts`              | stays — tests ::before/::after capture |

`tests/reproducer-exact/` (separate folder) is untouched — it is the
primary test location for the current engine.

## Under what conditions could it come back

Never. `reproducer-exact/` is strictly better.
