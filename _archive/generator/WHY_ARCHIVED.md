# Why `src/generator/` was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/generator/`
**REFACTOR_BRIEF.md reference:** §3 — "Templating LLM qui tronque à 42 KB — remplacé par Generation déterministe"

## What this module did

`src/generator/` was a LLM-based templating engine. Sub-modules at archive
time:

- `index.ts` — top-level Generator class (generate from brief)
- `template.ts` — clone-as-template LLM rewriter (v3.1 pipeline)
- `composer.ts` — multi-clone section composer (`compose` CLI command)
- `reskin.ts` — same-site, new-content reskin
- plus prompts, utilities, and section builders

It backed these CLI commands (now commented out in cli.ts):
`generate`, `compose`, `reskin`, `template`.

## Why it was archived

1. **Truncation at 42 KB** — LLM outputs were silently cut mid-HTML,
   losing `<script>`, `</body>`, closing tags. Memory #963.
2. **Generic "Awwwards-unworthy" output** — when generating from scratch,
   scored 52/100 on validation. Memory `feedback_generation.md` captures
   the user's direct feedback.
3. **Template mode was better** (clone-as-template + text rewrite) —
   but still had text leaks. That logic survives in cleaner form in
   `_archive/compose/rewrite-text.ts`, destined for
   `agents/generation/text-diff.ts` (S5).
4. **Architectural mismatch** — replaced by the deterministic
   Generation compiler (§4.5): load real HTML from KB, text-diff only
   the text nodes, concatenate. Zero LLM for HTML structure.

## What replaces it

| `generator/` concern              | Replacement                            |
|---|---|
| Brief → new site from scratch     | `agents/planning/` + `agents/generation/` |
| clone-as-template text rewrite    | `agents/generation/text-diff.ts` (S5)  |
| Multi-clone section composition   | `agents/generation/` assembler (S5)    |
| Reskin (same site, new brand)     | `agents/generation/` in reskin mode    |

## Under what conditions could it come back

Never in its current form. The valuable ideas (clone-as-template,
per-section composition) are absorbed by the new architecture.
