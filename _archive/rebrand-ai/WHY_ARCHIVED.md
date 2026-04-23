# Why `src/rebrand-ai/` was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/rebrand-ai/`
**REFACTOR_BRIEF.md reference:** §3 — "Approche 'LLM réécrit tout' — remplacée par text-diff"

## What this module did

`src/rebrand-ai/index.ts` was a single-file universal LLM rebrand engine that
took a whole cloned site, chunked its copy-blocks, and asked an LLM to
rewrite them for a new brand brief in one pass. It was built the day before
archive (Apr 22, memory #969) as a reaction to `compose/`'s truncation
issues.

## Why it was archived

1. **It depended on `src/compose/`** (inventory, reinject, validate,
   rewrite-text, types) — making it impossible to archive compose without
   rebrand-ai going first.
2. **Same "LLM rewrites everything" philosophy** — even though the final
   output only modified text nodes, the orchestration still relied on
   trusting the LLM on a large payload. Memory #978 documents 30 iCOMAT
   leaks surviving a full run.
3. **Redundant with the new Generation agent (§4.5)** — the new pipeline
   does text-diff on text-nodes per-section instead of whole-site. More
   focused context, less room for hallucination.

## What replaces it

The valuable part of rebrand-ai — the chunked text-diff orchestration — is
already expressed in cleaner form in `_archive/compose/rewrite-text.ts`.
Per REFACTOR_BRIEF §6 S5 étape 1, that file will be the source of
`agents/generation/text-diff.ts`.

## Under what conditions could it come back

If we need a whole-site single-pass rebrand tool for legacy templates, the
idea of "one LLM call, many copy-blocks" could be revived — but only as a
plumbing helper inside `agents/generation/`, not as a standalone command.
