# Agent ③ — Generation (S5)

Status: **stub — to implement in Week 5** (REFACTOR_BRIEF.md §4.5)

## Input

- A validated plan JSON (output of Planning).
- The brand brief.

## Output

`generated/<brand>/index.html` + `assets/` directory.

## Pipeline (zero LLM on HTML structure)

1. For each plan section, load its HTML from `.clonage-kb/sections/<source>/<role>.html`.
2. Apply **text-diff LLM** on text-nodes only. Port from `_archive/compose/rewrite-text.ts`
   to `src/agents/generation/text-diff.ts`.
3. Remap tokens:
   - palette → from `palette_reference`
   - typo → from `typo_reference`
   - spacing → from `rhythm_reference`
4. Concatenate sections in plan order, merging `<head>` (dedup styles/scripts/fonts).
5. Write single `index.html` + `assets/`.

## Constraints

- **HTML of each section comes from a real file**, not from an LLM. Scripts and animations are preserved by construction.
- **Text-diff only modifies text nodes** (cheerio walk). Zero structural change.
- If two sections share a CSS class name, prefix with a per-section hash: `.s-{hash}-classname`.

## Non-goals

- **Never ask an LLM for HTML.**
- **Never modify structure.**
