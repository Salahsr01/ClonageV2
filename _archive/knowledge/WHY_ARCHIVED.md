# Why `src/knowledge/` (KB v1) was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/knowledge/`
**REFACTOR_BRIEF.md reference:** §3 — "Index plat legacy — remplacé par deep-extract/ + atlas vectoriel"

## What this module did

`src/knowledge/index.ts` was a flat in-memory index of analyzed sites —
sections, animations, components — persisted as JSON. It was the backing
for `kb`, `search`, and `analyze` CLI commands (all commented in
cli.ts now).

It stored:
- Sites summary (vibe, primaryFont, techStack)
- Section content + tags
- Component extractions
- Animation captures

## Why it was archived

1. **Flat index vs. semantic retrieval** — `search` was substring match;
   it couldn't answer "find me a moody hero for an architecture studio".
2. **Redundant with KB v2** — `deep-extract/` already emits per-section
   HTML with classifier metadata into `.clonage-kb/sections/<site>/`.
3. **The new Atlas (§4.3)** replaces this role with vector embeddings +
   ChromaDB + metadata filters. Semantic queries become trivial.

## What replaces it

| `knowledge/` concern       | Replacement                        |
|---|---|
| Per-site summary storage    | `.clonage-kb/sections/<site>/index.json` (already live) |
| Section storage             | `.clonage-kb/sections/<site>/<role>.html` |
| `search` by substring       | `atlas.query({ brief, roleFilter, moodFilter })` (S3) |
| `kb` stats                  | `atlas.stats()` (S3) |
| Site ingestion via `analyze`| `agents/grounding/` (S2) — VLM produces richer fiches |

## Under what conditions could it come back

Never. The vector atlas subsumes all its use cases.
