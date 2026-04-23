# Why `src/compose/` was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/compose/` (and co-archived with `tests/compose/`)
**REFACTOR_BRIEF.md reference:** §3

## What this module did

`src/compose/` was the "Mode B" pipeline — take a deep-extracted KB v2 site,
compose a new brand's site by LLM-rewriting content while preserving the
skeleton of one chosen source site. Sub-modules at archive time:

- `assembler.ts` — merge per-section rewrites back into a full document
- `index.ts` — orchestrator (load KB, call LLM, assemble, write output)
- `prompt.ts` — build LLM prompts (text-only v2)
- `types.ts` — shared types
- `inventory.ts` — Cheerio-based DOM inventory (copy-block enumeration)
- `reinject.ts` — position-based DOM patch application
- `rewrite-text.ts` — text-node LLM rewriter
- `select.ts` — section selection
- `validate.ts` — structural fingerprint guard

## Why it was archived

1. **Truncation bug** — the orchestrator asked the LLM for HTML output on
   large sections, hitting token caps and producing silently truncated
   results. Memory observations #958, #963, #977 document iCOMAT leaks and
   42 KB cuts.
2. **Visible-text leaks** — even with the text-only prompt split, the
   pipeline left Prismic CDN URLs and meta tags pointing to icomat.co.uk.
   Mix of LLM hallucination and incomplete walk coverage.
3. **User verdict** — "c'est de la grosse merde" (Apr 22, 2:22 PM,
   memory #S200).
4. **Architectural mismatch** — ScreenCoder-style 3-agent split
   (Grounding → Planning → Generation) is the intended replacement per
   REFACTOR_BRIEF §4.

## What replaces it

| `compose/` concern              | Replacement                       |
|---|---|
| Section loading from KB         | `src/atlas/` (S3)                 |
| Brand brief → section selection | `agents/planning/` (S4)           |
| HTML assembly + text rewrite    | `agents/generation/` (S5)         |
| Validation                      | `src/validator/` (S6)             |

The valuable piece of `rewrite-text.ts` (text-node-only LLM diff) should
be ported to `agents/generation/text-diff.ts` per REFACTOR_BRIEF §6
S5 étape 1.

## Co-archived

`tests/compose/` went with this module — same commit. Its tests
(preservation, validate, reinject, rewrite-text, select, inventory,
orchestrator) were specific to the compose/ pipeline and have no life
outside it.

## Under what conditions could it come back

Only if the ScreenCoder-style pipeline fundamentally fails to preserve
animations/scripts in real sites (unlikely — the new Generation phase is
pure concatenation of real HTML from KB, not LLM synthesis).
