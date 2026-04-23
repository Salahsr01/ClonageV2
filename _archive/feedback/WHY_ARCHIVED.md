# Why `src/feedback/` was archived

**Archived on:** 2026-04-23 (Semaine 1 du refactor ScreenCoder)
**Archived from:** `src/feedback/` (was empty at archive time)
**REFACTOR_BRIEF.md reference:** §3 — "Hooks jamais utilisés"

## What this module contained

Nothing. The directory existed but had no `.ts` files — git doesn't track
empty directories, so there's nothing to `git mv`. This marker file is
placed in `_archive/feedback/` to preserve the intent of the brief ("the
feedback hooks concept was considered and archived without being used").

## Why it was archived

1. **Empty since at least Apr 15, 2026** (dir mtime).
2. **Hooks were never implemented** — the concept was to register
   listeners for post-clone / post-generate events, but the new
   architecture (§4) has an explicit orchestrator (`pipeline compose`)
   that calls steps in sequence, making generic hooks redundant.

## What replaces it

Nothing explicit — the 3-agent orchestrator in `pipeline.ts` handles
the staging that hooks would have covered.

## Under what conditions could it come back

If multiple external callers (e.g., CI bots) need to react to pipeline
milestones. Currently unplanned.
