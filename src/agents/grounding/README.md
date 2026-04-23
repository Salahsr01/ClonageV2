# Agent ① — Grounding (S2)

Status: **stub — to implement in Week 2** (REFACTOR_BRIEF.md §4.2)

## Input

A clone directory (output of `src/reproducer-exact/`), containing:
- `index.html` (+ asset dirs, per-section HTML via `.clonage-kb/sections/<site>/`)
- `screenshots/` (per-section or full-page)

## Output

For each section detected by `src/deep-extract/`:
- A `<section>.ground.json` sidecar next to the section HTML in `.clonage-kb/`.
- Schema (zod-validated):

```ts
{
  role: 'hero' | 'navbar' | 'works' | 'about' | 'cta' | 'contact' | ...,
  mood: string[],                       // e.g. ["moody", "editorial"]
  animations: Array<{
    type: 'scroll-pin' | 'stagger' | 'magnetic' | 'split-text' | ...,
    library: 'gsap' | 'framer' | 'lenis' | 'none'
  }>,
  palette_dominant: string[],           // top colors as hex
  typo: {
    display: string,
    body: string,
    axes: string[]
  },
  layout: {
    composition: 'fullscreen' | 'split' | 'masonry' | 'centered' | 'asymmetric' | ...,
    density: 'tight' | 'airy' | 'spacious'
  },
  signature: string,                    // 1-sentence FR describing what the section does
  usable_as: string[]                   // roles this section could fill elsewhere
}
```

## Pipeline

1. For each section in the clone, fetch or generate a screenshot (Playwright fallback if missing).
2. Simplify the DOM (keep structure + classes, drop raw content).
3. Call Claude Sonnet 4.6 Vision with image + simplified DOM.
4. Validate the JSON against zod. Retry max 2 times with feedback on invalid.
5. Write `.ground.json` next to the section HTML.

## Cache

Hash the section HTML. If the hash matches a previous run, skip the LLM call.

## Non-goals

- **Never produce HTML.** Output is strictly JSON.
- **Never analyze the whole page.** One section at a time.
