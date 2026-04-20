# Clone-Surgery Reproduction — Validation Results

**Date:** 2026-04-20
**Plan:** `docs/superpowers/plans/2026-04-20-clone-surgery-reproduction.md`
**Spec:** `docs/tech-spec-clone-surgery-2026-04-20.md`
**Commit:** ba55497 (post-e2e)

## Fixture baseline
- Hero fixture at `tests/reproducer-exact/fixtures/sample-hero.html`: **0.00% pixel diff** at 1280×800.

## Real-world sites

| Site | Section selector | Detection method | Viewport coverage | Fonts inlined | Images inlined | Diff score | Passed @ 5% | Notes |
|---|---|---|---|---|---|---|---|---|
| madeinevolve.com | `main > section:first-of-type` (default `hero` alias) | selector | 100.0% | 1/1 | 0/3 | 99.77% | ✗ | 3 image inlines failed; Webflow/Barba dynamic container; first `<section>` is an empty/hidden shell pre-animation. Retry with `header.section` gave identical 99.78% — root cause is asset resolution + dynamic content, not selector. |
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

## Next-Step Recommendations

1. **Fix image URL resolution against the clone root.** The 3/3 image failures on madeinevolve are the single biggest fidelity regression. Audit how `InlineAssets` resolves `src` — absolute URLs, `/_next/static/...`, and `srcset` entries likely need a mapping table against the cloned asset manifest.
2. **Improve "hero" detection.** Don't trust `:first-of-type` blindly. At minimum:
   - Skip elements with `display: none`, `visibility: hidden`, `opacity: 0`, or zero rendered height.
   - Require the element to intersect the initial viewport (y < viewport.height).
   - Consider scoring by (visible area ∩ viewport) and picking the top-ranked above-the-fold block.
3. **Add a `main` / `main > *:first-child` fallback for SPA sites with no `<section>` elements** (Taxi, Barba, some Webflow templates). Currently the alias chain dead-ends and the user has to hand-pick a selector.
4. **Clamp / rename `viewportCoverage`.** Either clamp to `[0, 1]` and rename the ≥1 case to `heightRatio`, or split into two fields: `viewportIntersection` (0..1) and `sectionHeightInViewports` (≥0).
5. **Fail fast when `reproduce-exact` is given a non-clone directory.** Detect the "recorder-only" layout (`recording.har` + `screenshots/` but no `index.html`) and emit a pointer to `replay` instead.
6. **Consider loosening the default `--threshold 0.02`.** Even the passing mersi run only passed because the detected element was a 76px-tall nav. On real heroes with web fonts and rasterized images, sub-2% will require anti-alias-tolerant diffing (e.g., `pixelmatch` with `threshold: 0.1` on a per-pixel basis, or a perceptual diff like SSIM).
7. **Re-run validation on `jobyaviation` + `obsidianassembly` once they've been re-cloned with the `clone` pipeline** (not the recorder), so we have 5 real data points instead of 3.
