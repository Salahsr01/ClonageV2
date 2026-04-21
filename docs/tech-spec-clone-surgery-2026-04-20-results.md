# Clone-Surgery Reproduction — Validation Results

**Date:** 2026-04-20
**Plan:** `docs/superpowers/plans/2026-04-20-clone-surgery-reproduction.md`
**Spec:** `docs/tech-spec-clone-surgery-2026-04-20.md`
**Commit:** 8051431 (post-v1.1 file:// fetch fix)

## Fixture baseline
- Hero fixture at `tests/reproducer-exact/fixtures/sample-hero.html`: **0.00% pixel diff** at 1280×800.

## Real-world sites

| Site | Section selector | Detection method | Viewport coverage | Fonts inlined | Images inlined | Diff score | Passed @ 5% | Notes |
|---|---|---|---|---|---|---|---|---|
| madeinevolve.com (v1.0) | `main > section:first-of-type` | selector | 100.0% | 1/1 | 0/3 | 99.77% | ✗ | v1.0 baseline: 3 image inlines failed because Chromium blocks `fetch()` cross-origin on `file://`. |
| madeinevolve.com (v1.1) | `main > section:first-of-type` | selector | 100.0% | 1/1 | **3/3** | **72.15%** | ✗ | v1.1 fix (Node `fs` fallback for `file://` URLs): all 3 images now inlined. Remaining 72% diff is GSAP slider state divergence — source has 1 slide visible at screenshot time, output renders all 3 `.slider_cms_img` elements per their computed styles. Static-capture limitation, not an inliner bug. |
| mersi-architecture.com | `header` (fallback to `nav`) | selector | 7.1% | 4/4 | 0/0 | 0.00% | ✓ | Default `hero` alias failed — site has NO `<section>` elements (single `<main data-taxi>` SPA shell). `--section header` resolves to `<nav>` (76px tall top bar). Pixel-perfect but not a real hero; needs a container selector like `main > .home` for meaningful coverage. |
| obsidianassembly.com | N/A | — | — | — | — | — | — | Clone directory contains only recorder output (`recording.har`, `screenshots/`, `metadata.json`) — no `index.html`. `reproduce-exact` is not applicable; this site is `replay`-only. |
| jobyaviation.com | N/A | — | — | — | — | — | — | Same as obsidianassembly: recorder-only output (`extraction/`, `media/`, `recording.har`, `screenshots/`) — no rendered clone HTML. |
| icomat.co.uk | `main > section:first-of-type` (default `hero` alias) | selector | 500.0% | 0/0 | 4/4 | 12.63% | ✗ | Detected section is far down the page (bbox y=11807, height=5400) — likely a GSAP ScrollTrigger-pinned section chosen by `:first-of-type` inside a virtualized/stacked layout. All 4 images inlined successfully. 12.6% diff is plausibly within font-metric + scrollbar + anti-alias territory once coverage is corrected. |

## Observations

- **Fixture → real-world is not a smooth curve.** The fixture is 0.00%; of 3 real sites with clone HTML, only 1 passed at 5% (mersi, but via a degenerate `nav`-only match). The other two are 12.63% and 99.77%.
- **Auto-detection of the "hero" is fragile on production sites.**
  - Webflow (madeinevolve) puts an empty first `<section class="section">` before the real hero; `main > section:first-of-type` grabs the shell.
  - Webflow/Taxi SPA (mersi) has zero `<section>` elements, so every `hero` alias fallback misses. We silently fall through to `nav` when the user passes `--section header`, which is misleading (the user asked for a hero, got a nav, and got 0%).
  - The `:first-of-type` rule on icomat matches a pinned section reported at y=11807 with height 5400 (coverage 500% of viewport). Either the page has a tall GSAP pin that changes the layout's natural order, or the detector is resolving the bbox after scroll/reflow. Either way, "first of type" is not the hero here.
- **Asset inlining is the biggest fidelity blocker on madeinevolve.** 3/3 images failed to inline; fonts inlined 1/1. The result is essentially a blank/broken page vs. the source (source screenshot is 14 KB vs. 33 KB output — the output is actually *larger* because it renders the skeleton without the hero imagery). Likely cause: Next.js-style `/_next/static/...` or CDN-absolute image URLs that don't resolve against the local clone root.
- **`viewportCoverage` reporting is broken for large sections.** icomat reports 500.0%, madeinevolve/mersi report 100.0%/7.1% which look right. The 500% value suggests we're dividing element height by viewport height without clamping — the metric is meant as "how much of the viewport does this section cover" but it's being computed as "how many viewport-heights tall is this section." These are different questions and the column becomes unreadable.
- **`reproduce-exact` is inapplicable to recorder-only output.** Two of the five "cloned" directories (obsidianassembly, jobyaviation) contain only HAR + screenshots, not rendered HTML. We should either document this as a prerequisite, or have the CLI fail fast with a clear message ("no index.html found — is this a `clone` output or a `record` output?").
- **Total runtime for the working runs:** ~9s + ~6s + ~9s ≈ 25 seconds wall-clock for 3 sites + 2 retries ≈ ~35s of actual browser work. Well under the budget.

## v1.1 Update (2026-04-21)

**Fix applied:** `src/reproducer-exact/asset-inliner.ts` — when a resolved URL starts with `file://`, the inliner now reads the file from Node's `fs` instead of calling `page.evaluate(fetch)` (Chromium treats each `file://` document as a unique origin and blocks cross-origin fetch on files). MIME type is inferred from file extension with a small lookup table.

**Verified regression-free:** 24/24 tests still pass. E2E fixture: 0.00%. Mersi retained its 0.00% degenerate pass.

**Remaining limitations on real sites (out of v1.1 scope):**
- **Dynamic state capture** — animated sliders (GSAP SplitText, slider_cms_img carousels) render in one state on source, all states on static output. Would require waiting for timeline stability before snapshot, or an explicit "play all timelines then freeze" pre-pass.
- **Hero auto-detection on Webflow/SPA sites** — the `hero` alias dead-ends on sites with no `<section>` or with a shell-before-hero pattern. Fix is heuristic enrichment (visibility filter, above-the-fold scoring).
- **Recorder-output directories** — `reproduce-exact` needs a fail-fast "no index.html → try `replay` instead" guard.

## Next-Step Recommendations

1. ~~**Fix image URL resolution against the clone root.**~~ **DONE in v1.1** (file:// Node fs fallback).
2. **Improve "hero" detection.** Don't trust `:first-of-type` blindly. At minimum:
   - Skip elements with `display: none`, `visibility: hidden`, `opacity: 0`, or zero rendered height.
   - Require the element to intersect the initial viewport (y < viewport.height).
   - Consider scoring by (visible area ∩ viewport) and picking the top-ranked above-the-fold block.
3. **Add a `main` / `main > *:first-child` fallback for SPA sites with no `<section>` elements** (Taxi, Barba, some Webflow templates). Currently the alias chain dead-ends and the user has to hand-pick a selector.
4. **Clamp / rename `viewportCoverage`.** Either clamp to `[0, 1]` and rename the ≥1 case to `heightRatio`, or split into two fields: `viewportIntersection` (0..1) and `sectionHeightInViewports` (≥0).
5. **Fail fast when `reproduce-exact` is given a non-clone directory.** Detect the "recorder-only" layout (`recording.har` + `screenshots/` but no `index.html`) and emit a pointer to `replay` instead.
6. **Consider loosening the default `--threshold 0.02`.** Even the passing mersi run only passed because the detected element was a 76px-tall nav. On real heroes with web fonts and rasterized images, sub-2% will require anti-alias-tolerant diffing (e.g., `pixelmatch` with `threshold: 0.1` on a per-pixel basis, or a perceptual diff like SSIM).
7. **Re-run validation on `jobyaviation` + `obsidianassembly` once they've been re-cloned with the `clone` pipeline** (not the recorder), so we have 5 real data points instead of 3.
