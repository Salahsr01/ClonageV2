# Technical Specification: Clone-Surgery Reproduction

**Date:** 2026-04-20
**Author:** Salah
**Version:** 1.0
**Project Type:** Feature (Clonage v3.1 — reproduction pipeline refactor)
**Project Level:** 1 (3-6 stories, ≤ 1 week)
**Status:** Draft

---

## Document Overview

This Technical Specification defines a **deterministic, LLM-free reproduction pipeline** for Clonage v3.1. It replaces the current regenerator-based `reproduce` step, which relies on LLM regeneration from truncated HTML + design tokens and caps at ~71% visual fidelity (per Design2Code benchmarks and observed output quality on the `hero-kuro` / `mersi-architecture.com` test runs).

**Related Documents:**
- Brainstorming session (this conversation, 2026-04-20)
- Existing research: `research-clonage-spa-react-webgl-2026-04-15.md`
- Prior brainstorm: `brainstorming-generation-v2-2026-04-15.md`

---

## Problem & Solution

### Problem Statement

The current `reproduce` pipeline (`src/generator/regenerator.ts:45-162`) sends truncated HTML (3,000–6,000 chars per section) plus a summarized tokens/animations description to an LLM (Qwen-Coder via HF or Claude via Anthropic), asking it to reconstruct "clean" HTML/CSS from scratch. This fails on three axes:

1. **Fidelity ceiling** — leading screenshot-to-code tools (v0, Bolt.new) plateau at 71–72% visual accuracy. Benchmarks (Design2Code, WebCode2M) confirm LLMs lose pixel measurements, animation timings, and exact layout.
2. **Information loss before the LLM** — truncation at 3,000 chars removes structural context the model would need.
3. **Inconsistency with the project's proven methodology** — the `clone` step works "incroyablement bien" precisely because it performs *exact transfer* (DOM, CSS, assets) with zero model-based reconstruction. The reproduction step violates that principle.

### Proposed Solution

**Clone-Surgery:** a deterministic reproduction pipeline that applies the same transfer-not-reconstruct principle as `clone`.

Pipeline (zero LLM calls):

1. Playwright loads the already-cloned site from local disk (file:// URL).
2. Detect the target section via **Largest Contentful Paint (LCP)** heuristic (browser-native, authoritative) — with fallback to a user-provided CSS selector (`--section`).
3. For the target subtree, extract the live DOM + each descendant's `getComputedStyle()` values directly from the browser.
4. Use **freeze-dry** (WebMemex, MIT) to serialize the subtree into a self-contained HTML file with inlined CSS, fonts, and assets as `data:` URLs or colocated files.
5. Output a standalone `hero.html` (or `{section-name}.html`) that renders **identical at the pixel** to the original, because it carries the same computed style values.

Result: pixel-perfect reproduction by construction, in seconds, with no API dependency.

---

## Requirements

### What Needs to Be Built

- **R1 — CLI command `reproduce-exact`:** new command (distinct from current `reproduce`) that takes a clone path and outputs a self-contained section HTML. Example: `clonage reproduce-exact ./output/madeinevolve/madeinevolve.com_2026-04-20 --section hero`. Acceptance: command runs end-to-end and produces a file.
- **R2 — LCP-based automatic section detection:** when `--section` is omitted, the pipeline identifies the hero using Chromium's LCP candidate logic (via `PerformanceObserver` injected into the Playwright page). Acceptance: on 5 recent cloned sites (madeinevolve, mersi, jobyaviation, obsidianassembly, icomat), automatic detection picks a `<section>` or `<header>` covering ≥ 60vh at top of page in ≥ 4 of 5 cases.
- **R3 — Manual selector override:** `--section "<CSS selector>"` or `--section hero|header|footer|nav` (named aliases) takes precedence over LCP detection. Acceptance: passing a valid selector always extracts exactly that subtree.
- **R4 — Computed-style serialization:** every DOM node in the extracted subtree receives an inline `style="…"` attribute reproducing its `getComputedStyle()` values for the ~40 layout-critical properties (display, position, flex, grid, padding, margin, font-*, color, background, border, transform, opacity, gap, width, height). Acceptance: per-pixel mismatch ratio between the output HTML's screenshot and the source section's screenshot ≤ 2% at 1920×1080, computed with `pixelmatch` using default threshold `0.1` and `includeAA: true` (anti-aliasing tolerated).
- **R5 — Self-containment via freeze-dry:** all subresources (images, fonts, videos, inline SVGs) referenced within the subtree are either inlined as `data:` URLs or copied into an `assets/` folder next to the output HTML. Acceptance: output HTML renders offline (no network requests) and a pixel-diff holds.
- **R6 — Output structure:** `{output-dir}/reproduction-exact/{section-name}.html` + optional `assets/` + `_metadata.json` (source URL, section selector used, LCP candidate data, pixel-diff score, timestamp). Acceptance: metadata JSON is machine-readable and contains all fields listed.
- **R7 — Visual verification (post-extraction):** after extraction, take a screenshot of the output and of the original section, compute SSIM or per-pixel diff, save both screenshots and the score in `_metadata.json`. Acceptance: score is logged and a red/green status printed to CLI.
- **R8 — Preserve animation markers (best-effort, no execution):** when a node has `data-gsap-*`, inline animations, or a `transition` property, keep those attributes/properties in the output. Acceptance: `transition` and `animation` CSS properties present in the source appear in the output for the same nodes. (Full GSAP timeline replay is out of scope — see below.)

### What This Does NOT Include

- **No LLM calls** anywhere in the reproduction-exact pipeline.
- **No rebranding / theming / content swap** — that is a future step that will layer on top of this deterministic baseline.
- **No multi-section composition** in v1 — one section at a time. Multi-section extraction is a future enhancement.
- **No GSAP timeline replay** — we preserve transition/animation CSS but do not re-animate scroll-triggered JS timelines. (The `replay` step in the broader pipeline remains responsible for dynamic-behavior reproduction.)
- **No cleanup / refactoring of the output HTML** (no class-name deduplication, no minification). Output is verbose-but-faithful by design.
- **No changes to the existing `reproduce` command.** The new `reproduce-exact` command coexists; the old one remains for reference and can be retired later.

---

## Technical Approach

### Technology Stack

- **Language/Framework:** TypeScript (existing project conventions), Node 20+.
- **Runtime dependencies (new):**
  - `freeze-dry` (^0.5 or latest MIT) — self-contained DOM serialization.
  - `pixelmatch` (^5) + `pngjs` — deterministic pixel-diff for R7.
- **Runtime dependencies (existing):**
  - `playwright` — already used in `regenerator.ts:11` and across the project.
- **Hosting/deployment:** local CLI only (no server changes).

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    clonage reproduce-exact                  │
│                                                             │
│  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐    │
│  │  Playwright │──▶│  Section     │──▶│ Subtree Style  │    │
│  │  (headless) │   │  Detector    │   │ Snapshotter    │    │
│  │  loads      │   │  (LCP +      │   │ (inlines       │    │
│  │  clone/*.html│  │  fallback    │   │  computedStyle)│    │
│  └─────────────┘   │  selector)   │   └────────┬───────┘    │
│                    └──────────────┘            │            │
│                                                ▼            │
│                    ┌──────────────┐   ┌────────────────┐    │
│                    │ freeze-dry   │◀──│ Trim subtree   │    │
│                    │ serializer   │   │ to extract ref │    │
│                    │ (inline assets│  └────────────────┘    │
│                    │  + fonts)    │                         │
│                    └──────┬───────┘                         │
│                           ▼                                 │
│                    ┌──────────────┐                         │
│                    │ Write output │                         │
│                    │ + assets/    │                         │
│                    └──────┬───────┘                         │
│                           ▼                                 │
│                    ┌──────────────┐                         │
│                    │ Pixel-diff   │                         │
│                    │ verification │                         │
│                    │ (pixelmatch) │                         │
│                    └──────┬───────┘                         │
│                           ▼                                 │
│                     _metadata.json                          │
└─────────────────────────────────────────────────────────────┘
```

**Module layout (new):**

- `src/reproducer-exact/index.ts` — orchestration entry point.
- `src/reproducer-exact/section-detector.ts` — LCP + selector logic.
- `src/reproducer-exact/style-snapshot.ts` — inline-computed-style logic (runs inside the Playwright page context).
- `src/reproducer-exact/freeze-dry-wrapper.ts` — adapter around `freeze-dry` lib.
- `src/reproducer-exact/verify.ts` — screenshot + pixel-diff.

No changes to existing `src/generator/regenerator.ts` or `src/reproducer/index.ts` in v1.

### Data Model

```ts
interface ReproduceExactOptions {
  clonePath: string;               // absolute path to cloned site dir
  entryFile?: string;              // default: 'index.html'
  section?: string;                // CSS selector or named alias
  outputDir: string;
  viewport?: { width: number; height: number }; // default 1920×1080
  diffThreshold?: number;          // default 0.02 (2%)
}

interface ReproduceExactResult {
  outputHtml: string;              // absolute path to written .html
  assetsDir?: string;
  metadataPath: string;
  diffScore: number;               // 0..1, lower = better
  passed: boolean;                 // diffScore ≤ diffThreshold
  sectionSelector: string;         // what was ultimately used
  detectionMethod: 'lcp' | 'selector' | 'fallback';
}
```

### API Design

Not applicable (CLI-only feature).

---

## Implementation Plan

### Stories

1. **S1 — Section Detector (LCP + Selector)** — implement `section-detector.ts`: inject a `PerformanceObserver` + `largest-contentful-paint` entry-type logic into the Playwright page, return the best-candidate selector. Add `--section` CLI flag override. Test on 5 cloned sites. *(~1 day)*
2. **S2 — Computed-Style Snapshotter** — implement `style-snapshot.ts`: for a root selector, walk the subtree in the page, call `getComputedStyle` per node, serialize relevant properties to an inline `style` attribute. Return the modified HTML as a string. *(~1 day)*
3. **S3 — Self-Containment via freeze-dry** — integrate the `freeze-dry` lib, wire the snapshotter output through it so assets/fonts are inlined. Handle fallback when `freeze-dry` can't fetch a resource (keep original URL with a warning in metadata). *(~0.5 day)*
4. **S4 — CLI command `reproduce-exact`** — add command to `src/cli.ts`, wire it to `src/reproducer-exact/index.ts`, accept `--section`, `--output`, `--viewport` flags. Update `README` / `CLAUDE.md` with usage. *(~0.5 day)*
5. **S5 — Visual Verification** — implement `verify.ts`: screenshot source section + reproduced file at same viewport, run `pixelmatch`, write diff score + side-by-side image into `_metadata.json` and `_diff.png`. *(~0.5 day)*
6. **S6 — End-to-End Test on madeinevolve + mersi-architecture** — full dry run on the 2 most-representative sites in `output/`, adjust thresholds, confirm ≤ 2% pixel diff holds. Document results in `docs/tech-spec-clone-surgery-2026-04-20-results.md`. *(~0.5 day)*

### Development Phases

**Phase A (core extraction, days 1-2):** S1 → S2 → S3, in order. Deliverable: a functional extractor that produces a self-contained HTML, even without CLI polish.

**Phase B (CLI + verification, day 3):** S4 → S5, parallelizable with a small overlap. Deliverable: end-user-runnable command with a numeric confidence score.

**Phase C (validation, day 4):** S6. Deliverable: confirmed fidelity on real sites + tuned defaults.

---

## Acceptance Criteria

- [ ] `clonage reproduce-exact ./output/madeinevolve/madeinevolve.com_2026-04-20 --section hero` produces a self-contained HTML file that opens offline in Chrome.
- [ ] Visual pixel-diff between the output HTML and the source section ≤ 2% at 1920×1080.
- [ ] `--section` flag accepts both named aliases (`hero`, `header`, `footer`, `nav`) and arbitrary CSS selectors.
- [ ] When `--section` is omitted, LCP-based auto-detection runs and records its choice in `_metadata.json`.
- [ ] On ≥ 4 of 5 reference sites (madeinevolve, mersi, jobyaviation, obsidianassembly, icomat), auto-detection picks a reasonable hero-like candidate.
- [ ] Output is fully offline: running the HTML produces zero network requests in DevTools.
- [ ] Zero LLM API calls made (no `fetch` to `router.huggingface.co` or `api.anthropic.com`).
- [ ] Command runs in ≤ 15 seconds on a typical page (excluding any asset-heavy freeze-dry inlining).
- [ ] `_metadata.json` contains: `sourceUrl`, `clonePath`, `sectionSelector`, `detectionMethod`, `diffScore`, `viewport`, `timestamp`, `assetsInlined`, `assetsFailed`.
- [ ] All new code passes existing TypeScript build and existing test suite (no regression in `src/generator` or `src/reproducer`).

---

## Non-Functional Requirements

### Performance

- Target: ≤ 15s for a standard page section on a mid-range laptop. freeze-dry inlining may extend this for pages with many large images — this is acceptable but logged.
- Memory: must handle sites with ~300k px `scrollHeight` (cf. mersi-architecture GSAP issue, memory `feedback_recorder_gsap_scrolltrigger.md`). Use `viewport` scoping and `--section`-only extraction to avoid whole-page memory pressure.

### Security

- Playwright runs headless with `file://` URLs only in this pipeline. No external network inside the extractor beyond what freeze-dry fetches for asset inlining (which targets the original CDN assets already referenced by the clone).
- No API keys required (HF_TOKEN / ANTHROPIC_API_KEY unused).

### Other

- **Offline-first:** output must be verifiable with network disabled.
- **Reproducibility:** same input → same output bytes (modulo timestamps in `_metadata.json`).

---

## Dependencies

- **Upstream (existing):** a successful `clone` step must have produced a local HTML + assets structure under `output/<domain>/<domain>_<date>/`. This spec assumes that structure unchanged.
- **Library:** `freeze-dry` must be installable from npm; if its Playwright integration is immature (open GitHub issue `gildas-lormeau/SingleFile#1463` referenced similar work for SingleFile), we fall back to a thin custom serializer in `freeze-dry-wrapper.ts` that handles the subset we need (inline stylesheets + `data:` URL assets).
- **Playwright** is already a project dependency.

---

## Risks & Mitigation

- **Risk:** `freeze-dry` doesn't cleanly support a subtree (only full-document snapshotting).
  - **Mitigation:** pre-trim the page's `document.body` to contain only the target subtree (mutate via `evaluate`) before calling `freeze-dry`. Document this in the wrapper.
- **Risk:** LCP heuristic picks the wrong element on atypical layouts (full-screen video bg, sticky nav masking the hero).
  - **Mitigation:** `--section` override is always available and advertised in logs. Print the selected candidate + a 2nd-best runner-up so the user can switch quickly.
- **Risk:** Inlined computed styles produce output files so large that browsers struggle to render.
  - **Mitigation:** target ~40 layout-critical properties (whitelist), not all 300+ computed properties. Measure output file size and warn if > 2 MB.
- **Risk:** Pages with CSS-in-JS or dynamic-injected `<style>` tags resolve differently at snapshot time vs. reproduction time.
  - **Mitigation:** since we inline computed styles on nodes directly, the original stylesheet source becomes irrelevant — our output only depends on the already-computed values. This is a feature, not a bug.
- **Risk:** GSAP ScrollTrigger pinning (cf. mersi-architecture, `feedback_recorder_gsap_scrolltrigger.md`) distorts `getComputedStyle` values at extraction time.
  - **Mitigation:** before snapshotting, scroll to `window.scrollTo(0, 0)` and wait for `requestIdleCallback` to ensure GSAP has settled into its pre-scroll state. Document this in `style-snapshot.ts`.

---

## Timeline

**Target Completion:** 2026-04-24 (4 working days from 2026-04-20).

**Milestones:**
- 2026-04-21 — Phase A complete (extractor produces self-contained HTML for madeinevolve hero).
- 2026-04-23 — Phase B complete (CLI + verification working end-to-end).
- 2026-04-24 — Phase C complete (validated on 5 reference sites, ≤ 2% diff, tech-spec closed).

---

## Approval

**Reviewed By:**
- [ ] Salah (Author)
- [ ] (Solo project — no additional reviewers)

---

## Next Steps

### Phase 4: Implementation

Level 1 (6 stories):
- Run `/sprint-planning` to confirm story order (already drafted above as Phase A/B/C).
- Then `/create-story` per story, `/dev-story` to implement.

Alternative (lighter): move directly to the `superpowers:writing-plans` skill to produce a concrete implementation plan from this spec, since the brainstorming skill's terminal state is `writing-plans`.

---

**This document was created using BMAD Method v6 — Phase 2 (Planning)**
