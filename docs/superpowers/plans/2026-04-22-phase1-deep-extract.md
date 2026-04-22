# Phase 1 : `deep-extract` + KB v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `clonage deep-extract <cloneDir>` — transforms a clone into 4-8 autonomous HTML sections under `.clonage-kb/sections/<site>/` with a `index.json` manifest.

**Architecture:** Cheerio parses clone `index.html`. A classifier assigns a role to each candidate block using deterministic heuristics. An inliner turns each section into a standalone HTML file (styles inline, assets as data URLs). The KB writer emits per-site `index.json` + per-role `.html` files.

**Tech Stack:** TypeScript 6, Node 20+, `cheerio` (already added by rebrand plan), `node:test`, existing `commander` CLI.

**Spec:** `docs/superpowers/specs/2026-04-22-ai-generation-pipeline.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/deep-extract/types.ts` | `SectionRole`, `ExtractedSection`, `DeepExtractResult`, `KBv2Index` |
| `src/deep-extract/classifier.ts` | Heuristic role assignment for a cheerio node |
| `src/deep-extract/boundary.ts` | Find candidate section boundaries in the DOM |
| `src/deep-extract/inliner.ts` | Section -> autonomous HTML (styles/assets inlined) |
| `src/deep-extract/kb-writer.ts` | Write `.clonage-kb/sections/<site>/` + `index.json` |
| `src/deep-extract/index.ts` | `deepExtract(cloneDir, opts)` orchestrator |
| `src/cli.ts` | *Modify* — add `deep-extract` subcommand |
| `tests/deep-extract/fixtures/minimal-clone/` | Tiny hand-built fixture (index.html + styles.css + 1 asset) |
| `tests/deep-extract/boundary.test.ts` | Boundary detection tests |
| `tests/deep-extract/classifier.test.ts` | Role classifier tests |
| `tests/deep-extract/inliner.test.ts` | Inliner output autonomy tests |
| `tests/deep-extract/kb-writer.test.ts` | KB v2 index schema tests |
| `tests/deep-extract/e2e.test.ts` | Full pipeline on `output/www.mersi-architecture.com_2026-04-15` |

---

## Task 1 : Bootstrap — types + fixture + boundary skeleton

**Files:**
- Create: `src/deep-extract/types.ts`
- Create: `tests/deep-extract/fixtures/minimal-clone/index.html`
- Create: `tests/deep-extract/fixtures/minimal-clone/styles.css`
- Create: `tests/deep-extract/fixtures/minimal-clone/assets/logo.svg`
- Create: `src/deep-extract/boundary.ts` (skeleton)

- [ ] **Step 1.1 : Create `src/deep-extract/types.ts`**

```ts
export type SectionRole =
  | 'hero'
  | 'services'
  | 'portfolio'
  | 'about'
  | 'testimonials'
  | 'contact'
  | 'cta'
  | 'nav'
  | 'footer'
  | `section-${number}`;

export interface SectionCandidate {
  el: cheerio.Cheerio;     // the cheerio-wrapped element
  depth: number;           // DOM depth
  textLength: number;
  childCount: number;
  tag: string;
  classList: string[];
}

export interface ExtractedSection {
  role: SectionRole;
  file: string;             // "hero.html"
  size_bytes: number;
  has_animation: boolean;   // true if <script> tag present inside section
  dominant_classes: string[];
  text_excerpt: string;     // first 180 chars of innerText
  tags: string[];           // inferred tags ("minimaliste", "editorial")
}

export interface KBv2Index {
  site: string;
  source_clone: string;
  extracted_at: string;     // ISO 8601
  palette: { primary?: string; secondary?: string; accent?: string };
  fonts: {
    primary?: { family: string; google: boolean };
    display?: { family: string; google: boolean };
  };
  sections: ExtractedSection[];
}

export interface DeepExtractOptions {
  cloneDir: string;
  sectionsTarget?: number;  // default 6, soft target
  force?: boolean;          // overwrite existing KB entry
}

export interface DeepExtractResult {
  site: string;
  kbDir: string;            // ".clonage-kb/sections/<site>"
  index: KBv2Index;
}
```

Expected : compiles (`npx tsc -p tsconfig.json` — no errors on new types).

- [ ] **Step 1.2 : Create minimal fixture**

`tests/deep-extract/fixtures/minimal-clone/index.html` — a 5-section hand-built page (hero, services, portfolio, contact, footer). Each section uses `<section class="...">` wrappers with distinguishing classes (`hero-wrap`, `services-grid`, etc.). Include one `<script>` tag inside one section to exercise `has_animation: true`.

`styles.css` — minimal CSS that styles each section class (enough to show the inliner picks up the right rules).

`assets/logo.svg` — 5-line SVG.

Expected : the fixture loads via `cheerio.load(fs.readFileSync(...))` without error.

- [ ] **Step 1.3 : Create `src/deep-extract/boundary.ts` skeleton**

```ts
import * as cheerio from 'cheerio';
import { SectionCandidate } from './types.js';

export function findSectionCandidates($: cheerio.CheerioAPI): SectionCandidate[] {
  throw new Error('not implemented');
}
```

Expected : compiles.

---

## Task 2 : `boundary.ts` — find section candidates (TDD)

**Files:**
- Create: `tests/deep-extract/boundary.test.ts`
- Modify: `src/deep-extract/boundary.ts`

- [ ] **Step 2.1 : Write failing tests first**

`tests/deep-extract/boundary.test.ts` covers:
- Minimal fixture produces **exactly** 5 candidates (one per `<section>`).
- Candidates are sorted by document order.
- Each candidate has correct `tag`, `classList`, `textLength`, `childCount`.
- A page with **no** `<section>` tags falls back to direct `<main>` children.
- A page without `<main>` falls back to `<body>` direct children having at least one block-level child.

Run : `node --test tests/deep-extract/boundary.test.ts` — expect all 5 tests to fail.

- [ ] **Step 2.2 : Implement `findSectionCandidates`**

Logic :
1. If `$('main section, main > article, main > header, main > footer, main > nav').length > 0` -> use those.
2. Else if `$('section, article, header, footer, nav').length > 0` -> use those.
3. Else fallback : direct children of `<main>` (or `<body>`) that contain an `h1`/`h2` OR have a class matching `/section|hero|wrap|block/`.

For each selected element, build a `SectionCandidate` with `depth` (count parents), `textLength` (`.text().length`), `childCount` (`.children().length`), `classList` (parse `class` attr), `tag` (lowercased tag name).

Expected : tests pass.

---

## Task 3 : `classifier.ts` — assign a role (TDD)

**Files:**
- Create: `tests/deep-extract/classifier.test.ts`
- Create: `src/deep-extract/classifier.ts`

- [ ] **Step 3.1 : Write failing tests**

Tests cover :
- First candidate with `h1` or class matching `hero`/`banner` -> `hero`.
- Candidate with `>= 3` direct children sharing a class pattern (services grid) -> `services`.
- Candidate with class `portfolio`/`projects`/`work` OR grid of `<img>` + titles -> `portfolio`.
- Candidate with `<form>` OR class `contact` OR href `mailto:` dominating -> `contact`.
- Candidate with class `about` OR paragraph > 400 chars + image -> `about`.
- Candidate with `blockquote` or class `testimonial` -> `testimonials`.
- Candidate with tag `footer` OR class `footer` -> `footer`.
- Candidate with tag `nav` OR class `nav` -> `nav`.
- Fallback -> `section-${index}`.

Run : 9 failing tests.

- [ ] **Step 3.2 : Implement `classify(candidate, index)`**

```ts
export function classify(c: SectionCandidate, index: number, isFirst: boolean): SectionRole {
  const cls = c.classList.join(' ').toLowerCase();
  const tag = c.tag;
  // ... ordered checks matching tests ...
}
```

Order matters : check `footer`/`nav` by tag first, then `hero` by class/first-position, then `contact` (form presence), then `portfolio`, then `services`, then `about`, then `testimonials`, then fallback.

Expected : tests pass.

---

## Task 4 : `inliner.ts` — section to autonomous HTML (TDD)

**Files:**
- Create: `tests/deep-extract/inliner.test.ts`
- Create: `src/deep-extract/inliner.ts`

This module reuses logic from the existing `src/reproducer/asset-inliner.ts`. Check it before writing from scratch — prefer importing the helper if it's already exported.

- [ ] **Step 4.1 : Read existing asset-inliner**

Run : `grep -n "export" src/reproducer/asset-inliner.ts` to see what's exported.

If a `inlineAssets(html, baseDir)` function exists, reuse it. Otherwise, factor the common code into `src/utils/asset-inline.ts` and use from both places.

- [ ] **Step 4.2 : Write failing tests**

Tests cover :
- Given a cheerio section element + clone dir, returns a string containing `<!DOCTYPE html><html>...<style>...</style>...section HTML...</html>`.
- Inlined styles include at least one rule from `styles.css` that targets a class used in the section.
- `<img src="./assets/logo.svg">` is replaced with `data:image/svg+xml;base64,...`.
- `<script>` tags **inside** the section are preserved verbatim.
- Output size is < 50 KB for a 3-paragraph section fixture (sanity check).

- [ ] **Step 4.3 : Implement `inlineSection(section, css, cloneDir)`**

```ts
export function inlineSection(
  section: cheerio.Cheerio,
  fullCss: string,
  cloneDir: string
): string {
  // 1. Extract section outerHTML
  // 2. Collect all class names + tag names used in section
  // 3. Filter CSS rules to those whose selectors touch those classes/tags
  //    (simple heuristic: split css into rules, keep rules whose selector string contains one of the classes)
  // 4. Inline assets (reuse utility)
  // 5. Wrap in a minimal <!DOCTYPE html>...<style>filtered css</style>... shell
}
```

For the CSS filter : split on `}` (crude but works), for each rule check if the selector (before `{`) contains any of the section's class tokens. Keep rule if yes, plus always-keep `:root`, `html`, `body`, `@font-face`.

Expected : tests pass.

---

## Task 5 : `kb-writer.ts` — write `index.json` + section files (TDD)

**Files:**
- Create: `tests/deep-extract/kb-writer.test.ts`
- Create: `src/deep-extract/kb-writer.ts`

- [ ] **Step 5.1 : Write failing tests**

Tests cover :
- Given a `KBv2Index` + array of `{ role, html }` + `siteName`, writes files to `.clonage-kb/sections/<site>/`.
- `<role>.html` files are created for each section.
- `index.json` is valid JSON parsed back identical to input.
- `force: false` throws if `.clonage-kb/sections/<site>/index.json` exists.
- `force: true` overwrites.
- Uses a **temp dir** override (don't pollute real `.clonage-kb` in tests).

- [ ] **Step 5.2 : Implement `writeKB`**

```ts
export function writeKB(params: {
  siteName: string;
  index: KBv2Index;
  sections: Array<{ role: SectionRole; html: string }>;
  kbRoot?: string;        // default: process.cwd() + '/.clonage-kb'
  force?: boolean;
}): { kbDir: string }
```

Expected : tests pass.

---

## Task 6 : Orchestrator `src/deep-extract/index.ts` (TDD)

**Files:**
- Create: `tests/deep-extract/orchestrator.test.ts`
- Create: `src/deep-extract/index.ts`

- [ ] **Step 6.1 : Write failing test**

Test : given the minimal fixture, orchestrator returns `DeepExtractResult` with 5 sections, writes `.clonage-kb/sections/minimal-clone/{hero,services,portfolio,contact,footer}.html` + `index.json`.

Use a tempdir for KB root.

- [ ] **Step 6.2 : Implement orchestrator**

```ts
export async function deepExtract(opts: DeepExtractOptions): Promise<DeepExtractResult> {
  // 1. Read clone: index.html + styles.css
  // 2. cheerio.load(html)
  // 3. findSectionCandidates
  // 4. classify each (track seen roles to avoid duplicates - append -2, -3, etc. or fallback to section-N)
  // 5. For each section: inlineSection -> html string
  // 6. Build ExtractedSection metadata (size_bytes, dominant_classes, text_excerpt, has_animation, tags)
  //    - tags: infer from classList + metadata (simple keyword match: "minimal", "grid", "bold", etc.)
  // 7. Extract palette (from styles.css: find top 3 colors via regex)
  // 8. Extract fonts (from styles.css: find @font-face src or font-family: declarations)
  // 9. Build KBv2Index
  // 10. writeKB
  // 11. Return result
}
```

Palette extraction : simple regex over `styles.css` for `#[0-9a-fA-F]{6}` and `rgb(...)` ; keep top 3 by frequency.
Fonts : regex `font-family:\s*["']?([^"';]+)` ; dedupe, keep top 2.

Expected : test passes.

---

## Task 7 : CLI wiring

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 7.1 : Locate existing command registrations**

Run : `grep -n "program\\.command\\|\\.action" src/cli.ts` to find the structure.

- [ ] **Step 7.2 : Register `deep-extract` command**

```ts
program
  .command('deep-extract <cloneDir>')
  .description("Extraire un clone en sections autonomes indexees dans .clonage-kb/")
  .option('-s, --sections <n>', 'Nombre cible de sections (soft)', '6')
  .option('-f, --force', 'Ecraser une entree KB existante')
  .action(async (cloneDir, options) => {
    const { deepExtract } = await import('./deep-extract/index.js');
    try {
      const result = await deepExtract({
        cloneDir,
        sectionsTarget: parseInt(options.sections, 10),
        force: !!options.force,
      });
      logger.success(`KB ecrite: ${result.kbDir}`);
      logger.dim(`${result.index.sections.length} sections extraites`);
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 7.3 : Rebuild and smoke test**

```bash
npx tsc -p tsconfig.json
node dist/cli.js deep-extract --help
```

Expected : help text shows `deep-extract <cloneDir>` with options.

---

## Task 8 : E2E on real clone

**Files:**
- Create: `tests/deep-extract/e2e.test.ts`

- [ ] **Step 8.1 : Write E2E test**

Test : run `deepExtract` on `output/www.mersi-architecture.com_2026-04-15/`. Assert :
- Result has at least 4 sections.
- Each section file exists and `< 15 KB`.
- Each section file contains `<!DOCTYPE html>` and closes `</html>`.
- `index.json` is valid, has `site === 'www.mersi-architecture.com'`, has non-empty `palette` and `fonts`.

This test is gated on the fixture being present :

```ts
const mersiClone = 'output/www.mersi-architecture.com_2026-04-15';
if (!fs.existsSync(mersiClone)) {
  test.skip('e2e: mersi clone not present');
  return;
}
```

- [ ] **Step 8.2 : Run full suite**

```bash
node --test tests/deep-extract/*.test.ts
```

Expected : all green, including e2e.

- [ ] **Step 8.3 : Smoke-open one generated section**

```bash
node dist/cli.js deep-extract output/www.mersi-architecture.com_2026-04-15 --force
open .clonage-kb/sections/www.mersi-architecture.com/hero.html
```

Expected : the page opens in the browser, renders the hero with correct fonts/colors/images without network.

---

## Verification Checklist (Phase 1 DoD)

- [ ] `node --test tests/deep-extract/*.test.ts` — all green.
- [ ] `node dist/cli.js deep-extract <cloneDir>` works on 4 clones (`icomat`, `mersi-architecture`, `raviklaassens`, `thisisstudiox`).
- [ ] Each extracted `<role>.html` renders standalone in a browser (no 404, fonts loaded, images visible).
- [ ] All `index.json` files parse as `KBv2Index`.
- [ ] Each section file size < 15 KB.
- [ ] No regression in existing test suite (`node --test`).

---

## Risques et points de vigilance

1. **CSS selector filter too aggressive.** If a section uses a global class defined at `:root`, we might drop a rule that's actually needed. Mitigation : always keep `@font-face`, `:root`, `html`, `body`, `@keyframes`, `@media` rules.

2. **Boundary detection produces too many / too few candidates.** If a site nests 12 `<section>` tags or uses zero, the heuristic must fall back cleanly. Mitigation : cap hard at 10 candidates, take by document order ; if < 2, fall back to `<main>`/`<body>` children.

3. **Asset inlining blows up section size.** A hero with a 3 MB background image breaks the "< 15 KB" target. Mitigation : images > 200 KB stay as file-relative paths (not inlined), but copied next to the section file in `.clonage-kb/sections/<site>/assets/`.

4. **Reusing asset-inliner may have side effects.** If it mutates the cheerio object in place, inlining one section could leak classes into the next. Mitigation : always operate on a `$.html(clone)` string copy, never on shared cheerio trees.
