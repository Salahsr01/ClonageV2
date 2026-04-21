# Rebrand (Deterministic v1) — Design

**Date:** 2026-04-21
**Author:** Salah
**Status:** Draft
**Version:** 1.0

---

## Problem

A reproduction from Phase 1 (`reproduce-exact`) is pixel-faithful to the source — same brand name, same palette, same fonts, same copy, same images. To turn a reproduction into a usable template for a different brand, the user needs a controlled way to swap **5 axes** (name/logo, colors, typography, copy, images) without breaking the pixel-perfect layout.

Previous LLM-based reskin attempts (`src/generator/reskin.ts`, `template.ts`) produced low-fidelity output because the LLM rewrote HTML from scratch. This design avoids that: same "copy-not-reconstruct" principle as `reproduce-exact`.

## Solution Overview

A **deterministic, LLM-free rebrand pipeline** that takes a reproduction HTML file + a brand brief JSON and produces a new HTML file with the requested substitutions applied. All 5 axes are implemented as independent transformers applied in sequence. Each transformer skips silently if its section of the brief is absent.

Future work (v2): a generative layer above this that produces a brief from a vibe prompt, leaving the deterministic pipeline unchanged.

## CLI Surface

```
clonage rebrand <reproduction-html-path> --brief brand.json [--output <path>]
```

- `<reproduction-html-path>` — the `.html` file produced by `reproduce-exact` (or any standalone HTML with inline styles; the transformers don't care about provenance).
- `--brief <path>` — path to the brand brief JSON (schema below).
- `--output <path>` — output HTML. Default: `{basename}.rebranded.html` next to the input.

Exit code: 0 on success, 1 on I/O or schema errors.

## Brand Brief Schema

All fields optional; missing fields skip the corresponding transformer.

```json
{
  "brand": {
    "name": "Atelier Noma",
    "source_name": "Made in Evolve"
  },

  "palette": {
    "background": "#0F1A2B",
    "text": "#F5E6C8",
    "accent": "#C9A66B",
    "map": {
      "rgb(17, 17, 17)": "#0F1A2B"
    }
  },

  "typography": {
    "primary": { "family": "Inter", "google": true },
    "display": { "family": "Playfair Display", "google": true }
  },

  "copy": [
    { "from": "Digital evolution", "to": "Artisanat du bois" },
    { "selector": "h1", "to": "Nouveau titre" }
  ],

  "images": [
    { "selector": ".hero-img", "to": "./assets/new-hero.jpg" },
    { "from": "old-image.webp", "to": "https://cdn.example.com/new.jpg" }
  ]
}
```

### Field semantics

- **brand.name** — new brand text. **brand.source_name** — the literal string to match in the reproduction HTML. Both required if either present. Case-sensitive global text replacement within text nodes only (not in attribute values, not in CSS — a `brand.source_name` that matches a class name must not be touched).
- **palette.background / text / accent** — the 3 role colors of the new brand. If `map` is absent, the transformer auto-clusters the source HTML's colors (top-1 most-frequent per role, see PaletteTransformer details) and maps them to these targets.
- **palette.map** — explicit source-color → target-color overrides; takes precedence over auto-clustering for matched source colors.
- **typography.primary / display** — the 2 font roles. `.google: true` adds a `<link>` tag to `<head>` for the Google Font. `.family` is the CSS `font-family` value.
- **copy** — array of text substitutions. Two forms:
  - `from`/`to`: literal text-node match and replace.
  - `selector`/`to`: replace the text content of all elements matching the selector.
- **images** — array of image substitutions. Two forms:
  - `from`/`to`: match `src` attribute by suffix (filename). `to` is a local path or URL.
  - `selector`/`to`: set `src` on all `<img>` matching the selector.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   clonage rebrand <html> --brief brand.json     │
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │ Load brief    │───▶│ Load HTML +   │───▶│ Parse DOM     │    │
│  │ (JSON schema  │    │ validate      │    │ (cheerio)     │    │
│  │  validate)    │    │ reproduction  │    │               │    │
│  └───────────────┘    └───────────────┘    └───────┬───────┘    │
│                                                    ▼            │
│  ┌──────────────────── Transformer chain ──────────────────┐    │
│  │  1. BrandTransformer      (text-node string replace)    │    │
│  │  2. PaletteTransformer    (inline-style color rewrite)  │    │
│  │  3. TypographyTransformer (inline-style font rewrite +  │    │
│  │                            Google Fonts link in <head>) │    │
│  │  4. CopyTransformer       (text-node / selector swap)   │    │
│  │  5. ImagesTransformer     (<img src> rewrite)           │    │
│  └──────────────────────┬──────────────────────────────────┘    │
│                         ▼                                       │
│                  ┌──────────────┐    ┌──────────────────┐       │
│                  │ Serialize    │───▶│ Write output +   │       │
│                  │ DOM          │    │ _rebrand.json    │       │
│                  └──────────────┘    │ (metadata)       │       │
│                                      └──────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Module layout (new)

- `src/rebrand/index.ts` — `rebrand(options)` orchestrator.
- `src/rebrand/brief.ts` — brief loading, schema validation, type guards.
- `src/rebrand/transformers/brand.ts` — name/logo text swap.
- `src/rebrand/transformers/palette.ts` — color swap (with auto-clustering helper in `color-cluster.ts`).
- `src/rebrand/transformers/typography.ts` — font swap + Google Fonts link injection.
- `src/rebrand/transformers/copy.ts` — text mapping + selector-based replacement.
- `src/rebrand/transformers/images.ts` — `<img src>` rewrite (with inline-as-data-URL for local files).
- `src/rebrand/color-cluster.ts` — extract dominant colors from inline-style attributes.
- `src/rebrand/types.ts` — `BrandBrief`, `RebrandOptions`, `RebrandResult`, `TransformerReport`.
- `src/cli.ts` — *modify* — add `rebrand` subcommand.
- `tests/rebrand/*.test.ts` — unit + integration tests.

### Key design decisions

**Cheerio for DOM manipulation, not Playwright.** The reproduction HTML is static — no JS needed. `cheerio` (jQuery-like API on a static DOM) is faster, simpler, and fits the pipeline. Playwright would be overkill here.

**Transformers are independent and composable.** Each transformer takes `(cheerio root, briefSection) → cheerio root`. No shared state. A transformer returns a report (`{ applied: n, skipped: n, warnings: [] }`) that ends up in `_rebrand.json`.

**Order matters.** `BrandTransformer` runs before `CopyTransformer` so that a brand name in a heading is handled as a brand swap, not as a generic copy swap. Palette before Typography so Google Fonts injection sees final color tokens (doesn't matter today, but it's a safe invariant).

**Copy length warning.** If `new_text.length > 1.5 × old_text.length`, emit a warning to `_rebrand.json` and stdout. No truncation, no layout enforcement in v1.

## Data Model

```ts
export interface BrandBrief {
  brand?: { name: string; source_name: string };
  palette?: {
    background?: string;
    text?: string;
    accent?: string;
    map?: Record<string, string>;
  };
  typography?: {
    primary?: { family: string; google?: boolean };
    display?: { family: string; google?: boolean };
  };
  copy?: Array<
    | { from: string; to: string }
    | { selector: string; to: string }
  >;
  images?: Array<
    | { from: string; to: string }
    | { selector: string; to: string }
  >;
}

export interface RebrandOptions {
  inputHtml: string;
  brief: BrandBrief;
  outputPath?: string;
}

export interface TransformerReport {
  name: 'brand' | 'palette' | 'typography' | 'copy' | 'images';
  applied: number;
  skipped: number;
  warnings: string[];
}

export interface RebrandResult {
  outputHtml: string;
  metadataPath: string;
  reports: TransformerReport[];
}
```

## Transformer Details

### 1. BrandTransformer

- If `brief.brand` absent, skip.
- Walk all text nodes under `<body>`; for each occurrence of `brief.brand.source_name`, replace with `brief.brand.name`.
- Do NOT touch attribute values (no `alt`, no `title`, no `aria-label`) — those are text but often contain class-like strings or hashed identifiers. Explicit `copy[]` entries with selectors can handle edge cases.
- Report: count of nodes touched.

### 2. PaletteTransformer

- If `brief.palette` absent, skip.
- Step 1: Extract all color values from `style="..."` attributes on every element. Normalize to `rgb()` form.
- Step 2: Build the source palette:
  - If `palette.map` covers ≥ 1 colors, apply those exact mappings first.
  - For remaining source colors, cluster by role using a simple heuristic:
    - Background roles: colors appearing in `background-color` or `background-image` (gradient stops).
    - Text roles: colors appearing in `color`.
    - Accent roles: colors that don't fit either above.
  - Take the top-1 most-frequent color per role. Map to `palette.background` / `palette.text` / `palette.accent`.
- Step 3: Rewrite every `style` attribute with the mapping applied.
- Report: count of color-value substitutions; warnings for colors not mapped.

### 3. TypographyTransformer

- If `brief.typography` absent, skip.
- Extract the set of `font-family` values present in inline styles. Heuristic:
  - The **most-frequent** font-family on text-bearing elements → "primary" role.
  - Font-families appearing on `<h1>`, `<h2>`, `<h3>` with a distinctive size (typically > 32px) → "display" role.
- Replace primary-role occurrences with `brief.typography.primary.family`, and display-role with `brief.typography.display.family`, in all `style` attributes.
- If `brief.typography.primary.google` or `.display.google` is true, append a `<link href="https://fonts.googleapis.com/css2?family=...&display=swap" rel="stylesheet">` into `<head>`.
- Report: font substitutions per role.

### 4. CopyTransformer

- If `brief.copy` absent or empty, skip.
- For each entry:
  - **`from`/`to` form**: walk all text nodes, replace exact literal matches. Emit warning if no match found.
  - **`selector`/`to` form**: find all matching elements, set their `.text()` to the new value. Emit warning if no element matches.
- Emit warning if `to.length > 1.5 × from.length` (or, for selector form, `> 1.5 × old_text.length`).
- Report: count of text replacements.

### 5. ImagesTransformer

- If `brief.images` absent or empty, skip.
- For each entry:
  - **`from`/`to` form**: find all `<img>` whose `src` attribute ends with `from` (string suffix match). Set `src` to the resolved `to`.
  - **`selector`/`to` form**: find all `<img>` matching the selector. Set `src` to the resolved `to`.
- `to` resolution:
  - Local path (starts with `./` or absolute): read the file, base64-encode, inline as `data:` URL. (Consistent with reproduction's approach.)
  - HTTP(S) URL: leave as-is. (No fetch in v1 — the user is responsible for CDN availability.)
- Report: count of image swaps; warnings for local paths that don't exist.

## Output Structure

```
{input-dir}/
  hero.html                       # input (reproduction)
  hero.rebranded.html             # output
  hero.rebranded.assets/          # optional; unused in v1 (images inlined as data URLs)
  hero.rebranded._rebrand.json    # metadata
```

`_rebrand.json` shape:
```json
{
  "inputHtml": "hero.html",
  "briefPath": "brand.json",
  "brandName": "Atelier Noma",
  "reports": [
    { "name": "brand", "applied": 4, "skipped": 0, "warnings": [] },
    { "name": "palette", "applied": 23, "skipped": 1, "warnings": ["color #1a1a1a had no target role"] },
    { "name": "typography", "applied": 18, "skipped": 0, "warnings": [] },
    { "name": "copy", "applied": 2, "skipped": 0, "warnings": ["new text 2.1× longer than original on entry 0"] },
    { "name": "images", "applied": 3, "skipped": 0, "warnings": [] }
  ],
  "timestamp": "2026-04-21T..."
}
```

## Error Handling

- **Brief schema violation** (invalid JSON, unknown fields, wrong types): fail fast with a message pointing to the offending path. No partial runs.
- **Input HTML not found / unreadable**: fail with a clear message.
- **Per-transformer soft errors** (no matches, missing files): warning in report, continue.
- **Cheerio parse failure** (malformed HTML): fall back to a best-effort text-based substitution for the brand+copy axes only; skip palette/typography/images with a warning. This is a safety net; reproduction output is expected to be valid HTML.

## Testing Strategy

1. **Unit tests per transformer** — each transformer gets fixtures (small HTML strings) and assertions on the output.
2. **Integration test** — run the full pipeline on the `sample-hero.html` fixture from Phase 1 with a known brief; assert diff.
3. **End-to-end test** — run `rebrand` on a reproduction of the real madeinevolve hero + a sample brief; assert that the brand name and palette are visible in the output, even if the reproduction itself has known gaps (GSAP slider state).

No visual/pixel-diff verification in v1 (the output layout should be identical to the input, only text/colors/fonts/images change; layout breakage would show up in tests via HTML structure diffs).

## Acceptance Criteria

- [ ] `clonage rebrand --help` shows the subcommand with `--brief` and `--output`.
- [ ] Running on a reproduction HTML with an empty brief (`{}`) produces bit-identical output (passthrough).
- [ ] Running with a full brief swaps brand name, 3 palette colors, 2 font families, ≥ 1 copy entry, and ≥ 1 image.
- [ ] `_rebrand.json` is generated and contains 5 transformer reports.
- [ ] All new code passes TypeScript build and the existing test suite (no regressions).
- [ ] End-to-end test on `sample-hero.html` + a `brand.json` fixture: output HTML contains the new brand name, at least one `#new-color` substring, and the new Google Fonts link.

## Non-Goals (v1)

- No LLM calls anywhere.
- No "vibe prompt" → brief generation (v2).
- No image *generation* (DALL·E, Midjourney). User provides files or URLs.
- No handling of external stylesheet `<link>` tags — reproduction output uses inline styles only.
- No responsive-variant rebranding (mobile/desktop diff) — applies to the full file as-is.
- No accessibility checks (contrast ratio validation) on the new palette — user's responsibility in v1.
- No visual regression / pixel-diff after rebrand — the expectation is that rebrand is *intentionally* non-identical to source.

## Risks & Mitigations

- **Risk:** Palette auto-clustering picks the "wrong" dominant color as the primary (e.g., clusters a border color as text).
  - **Mitigation:** The `palette.map` explicit-override escape hatch always wins. Document this in CLI help and recommend `map` for edge cases. Plan a v1.1 follow-up with a `--report-palette-only` flag that prints the source palette without modifying, so the user can debug.
- **Risk:** `brand.source_name` appears inside a selector-like string by coincidence (e.g., "Evolve" in a CSS class) and the global replace corrupts it.
  - **Mitigation:** Substitution happens **only in text nodes**, never in attributes. Also, the match is a case-sensitive exact-string match, so partial-word matches are the only risk. Worth documenting.
- **Risk:** Google Fonts injection fails at runtime (font not available). The user sees fallback fonts.
  - **Mitigation:** In v1, we don't validate the font name against the Google Fonts catalog. If the user sets `primary.family: "MadeUpFont"` with `google: true`, the link tag is malformed and the browser falls back. A v1.1 addition could validate the name.
- **Risk:** Selector-based copy entries match zero elements silently.
  - **Mitigation:** Warning in the report when `applied: 0` for a specified entry. User sees it in `_rebrand.json` and stdout.

## Timeline

Target: 4 working days from 2026-04-21.

- Day 1: Types + brief loader + BrandTransformer + CopyTransformer (both string-based; share machinery).
- Day 2: PaletteTransformer + color-cluster helper.
- Day 3: TypographyTransformer + ImagesTransformer.
- Day 4: Orchestrator + CLI + integration test + docs update.

---

**Next step:** after user approval, transition to `superpowers:writing-plans` to produce a bite-sized implementation plan.
