# Rebrand (Deterministic v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `clonage rebrand <html> --brief brand.json` CLI that applies a strict brand brief (name, palette, typography, copy, images) to a reproduction HTML file, zero LLM calls.

**Architecture:** Cheerio parses the reproduction HTML statically. Five independent transformers run in sequence (brand → palette → typography → copy → images), each skipping silently if its brief section is absent. Each returns a `TransformerReport`. Orchestrator serializes the DOM + writes `_rebrand.json`.

**Tech Stack:** TypeScript 6, Node 20+, `cheerio` (new MIT dep), `node:test`, existing `commander` CLI.

**Spec:** `docs/superpowers/specs/2026-04-21-rebrand-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/rebrand/types.ts` | `BrandBrief`, `RebrandOptions`, `RebrandResult`, `TransformerReport` |
| `src/rebrand/brief.ts` | Load + validate JSON brief (throw on schema violation) |
| `src/rebrand/color-normalize.ts` | Canonicalize any CSS color string → `rgb(r, g, b)` / `rgba(...)` |
| `src/rebrand/transformers/brand.ts` | Brand name/source_name text-node swap |
| `src/rebrand/transformers/palette.ts` | Strict color map-based substitution + unmapped-top-5 report |
| `src/rebrand/transformers/typography.ts` | Font-family swap + Google Fonts link injection |
| `src/rebrand/transformers/copy.ts` | `from`/`to` and `selector`/`to` text swaps, length warnings |
| `src/rebrand/transformers/images.ts` | `<img src>` rewrite (local → data URL, URL passthrough) |
| `src/rebrand/index.ts` | `rebrand(options)` orchestrator |
| `src/cli.ts` | *Modify* — add `rebrand` subcommand |
| `tests/rebrand/fixtures/brief-full.json` | Brief with all 5 axes |
| `tests/rebrand/fixtures/brief-palette-only.json` | Brief with just palette map |
| `tests/rebrand/brief.test.ts` | Schema validation tests |
| `tests/rebrand/color-normalize.test.ts` | Color canonicalization tests |
| `tests/rebrand/brand.test.ts` | BrandTransformer tests |
| `tests/rebrand/palette.test.ts` | PaletteTransformer tests |
| `tests/rebrand/typography.test.ts` | TypographyTransformer tests |
| `tests/rebrand/copy.test.ts` | CopyTransformer tests |
| `tests/rebrand/images.test.ts` | ImagesTransformer tests |
| `tests/rebrand/e2e.test.ts` | Full-pipeline integration test |

---

## Task 1: Bootstrap — install cheerio, scaffold types + brief loader

**Files:**
- Modify: `package.json` (add `cheerio`)
- Create: `src/rebrand/types.ts`
- Create: `src/rebrand/brief.ts`
- Create: `tests/rebrand/fixtures/brief-full.json`
- Create: `tests/rebrand/fixtures/brief-palette-only.json`
- Create: `tests/rebrand/brief.test.ts`

- [ ] **Step 1.1: Install cheerio**

```bash
cd /Users/salah/Desktop/Clonage && npm install cheerio@^1.0.0
```
Expected: `package.json` + `package-lock.json` updated, no errors.

- [ ] **Step 1.2: Create types.ts**

Create `src/rebrand/types.ts`:

```ts
export interface BrandBrief {
  brand?: { name: string; source_name: string };
  palette?: { map: Record<string, string> };
  typography?: {
    primary?: { family: string; google?: boolean };
    display?: { family: string; google?: boolean };
  };
  copy?: Array<CopyEntry>;
  images?: Array<ImageEntry>;
}

export type CopyEntry =
  | { from: string; to: string }
  | { selector: string; to: string };

export type ImageEntry =
  | { from: string; to: string }
  | { selector: string; to: string };

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
  info?: Record<string, unknown>;
}

export interface RebrandResult {
  outputHtml: string;
  metadataPath: string;
  reports: TransformerReport[];
}
```

- [ ] **Step 1.3: Create fixtures**

Create `tests/rebrand/fixtures/brief-full.json`:

```json
{
  "brand": { "name": "Atelier Noma", "source_name": "Fixture Hero" },
  "palette": {
    "map": {
      "rgb(42, 24, 16)": "#0F1A2B",
      "#2a1810": "#0F1A2B"
    }
  },
  "typography": {
    "primary": { "family": "Inter", "google": true },
    "display": { "family": "Playfair Display", "google": true }
  },
  "copy": [
    { "from": "Fixture Hero Title", "to": "Nouveau Titre Principal" }
  ],
  "images": [
    { "selector": ".hero-img", "to": "./assets/new-hero.jpg" }
  ]
}
```

Create `tests/rebrand/fixtures/brief-palette-only.json`:

```json
{
  "palette": {
    "map": {
      "rgb(17, 17, 17)": "#0F1A2B"
    }
  }
}
```

- [ ] **Step 1.4: Write failing brief.test.ts**

Create `tests/rebrand/brief.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { loadBrief, validateBrief } from '../../src/rebrand/brief.js';

test('loadBrief reads a valid JSON file', () => {
  const p = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-full.json');
  const brief = loadBrief(p);
  assert.strictEqual(brief.brand?.name, 'Atelier Noma');
  assert.ok(brief.palette?.map);
});

test('loadBrief accepts a partial brief (palette-only)', () => {
  const p = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-palette-only.json');
  const brief = loadBrief(p);
  assert.strictEqual(brief.brand, undefined);
  assert.ok(brief.palette?.map);
});

test('loadBrief accepts an empty brief ({})', () => {
  const brief = validateBrief({});
  assert.deepStrictEqual(brief, {});
});

test('validateBrief rejects brand missing source_name', () => {
  assert.throws(
    () => validateBrief({ brand: { name: 'X' } }),
    /brand\.source_name/
  );
});

test('validateBrief rejects palette without map', () => {
  assert.throws(
    () => validateBrief({ palette: {} }),
    /palette\.map/
  );
});

test('validateBrief rejects copy entry without from/selector', () => {
  assert.throws(
    () => validateBrief({ copy: [{ to: 'x' } as any] }),
    /copy\[0\]/
  );
});
```

- [ ] **Step 1.5: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 6 new tests FAIL (module missing); existing 24 tests still pass.

- [ ] **Step 1.6: Implement brief.ts**

Create `src/rebrand/brief.ts`:

```ts
import * as fs from 'fs';
import { BrandBrief, CopyEntry, ImageEntry } from './types.js';

export function loadBrief(filePath: string): BrandBrief {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch (err: any) { throw new Error(`brief: invalid JSON in ${filePath}: ${err.message}`); }
  return validateBrief(json);
}

export function validateBrief(input: unknown): BrandBrief {
  if (input === null || typeof input !== 'object') {
    throw new Error('brief: top-level must be a JSON object');
  }
  const b = input as Record<string, unknown>;
  const out: BrandBrief = {};

  if ('brand' in b) {
    const br = b.brand as Record<string, unknown>;
    if (!br || typeof br !== 'object') throw new Error('brief: brand must be an object');
    if (typeof br.name !== 'string') throw new Error('brief: brand.name must be a string');
    if (typeof br.source_name !== 'string') throw new Error('brief: brand.source_name must be a string');
    out.brand = { name: br.name, source_name: br.source_name };
  }

  if ('palette' in b) {
    const p = b.palette as Record<string, unknown>;
    if (!p || typeof p !== 'object') throw new Error('brief: palette must be an object');
    if (!p.map || typeof p.map !== 'object') throw new Error('brief: palette.map is required and must be an object');
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.map as Record<string, unknown>)) {
      if (typeof v !== 'string') throw new Error(`brief: palette.map["${k}"] must be a string`);
      map[k] = v;
    }
    out.palette = { map };
  }

  if ('typography' in b) {
    const t = b.typography as Record<string, unknown>;
    if (!t || typeof t !== 'object') throw new Error('brief: typography must be an object');
    out.typography = {};
    for (const role of ['primary', 'display'] as const) {
      if (role in t) {
        const r = t[role] as Record<string, unknown>;
        if (!r || typeof r !== 'object') throw new Error(`brief: typography.${role} must be an object`);
        if (typeof r.family !== 'string') throw new Error(`brief: typography.${role}.family must be a string`);
        out.typography[role] = { family: r.family, google: r.google === true };
      }
    }
  }

  if ('copy' in b) {
    if (!Array.isArray(b.copy)) throw new Error('brief: copy must be an array');
    out.copy = b.copy.map((e, i) => validateCopyEntry(e, i));
  }

  if ('images' in b) {
    if (!Array.isArray(b.images)) throw new Error('brief: images must be an array');
    out.images = b.images.map((e, i) => validateImageEntry(e, i));
  }

  return out;
}

function validateCopyEntry(e: unknown, i: number): CopyEntry {
  if (!e || typeof e !== 'object') throw new Error(`brief: copy[${i}] must be an object`);
  const ce = e as Record<string, unknown>;
  if (typeof ce.to !== 'string') throw new Error(`brief: copy[${i}].to must be a string`);
  if (typeof ce.from === 'string') return { from: ce.from, to: ce.to };
  if (typeof ce.selector === 'string') return { selector: ce.selector, to: ce.to };
  throw new Error(`brief: copy[${i}] must have either "from" or "selector"`);
}

function validateImageEntry(e: unknown, i: number): ImageEntry {
  if (!e || typeof e !== 'object') throw new Error(`brief: images[${i}] must be an object`);
  const ie = e as Record<string, unknown>;
  if (typeof ie.to !== 'string') throw new Error(`brief: images[${i}].to must be a string`);
  if (typeof ie.from === 'string') return { from: ie.from, to: ie.to };
  if (typeof ie.selector === 'string') return { selector: ie.selector, to: ie.to };
  throw new Error(`brief: images[${i}] must have either "from" or "selector"`);
}
```

- [ ] **Step 1.7: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 30 pass (24 existing + 6 new).

- [ ] **Step 1.8: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add package.json package-lock.json src/rebrand tests/rebrand && git commit -m "feat(rebrand): bootstrap — types + brief loader with schema validation"
```

---

## Task 2: Color normalizer helper

**Files:**
- Create: `src/rebrand/color-normalize.ts`
- Create: `tests/rebrand/color-normalize.test.ts`

The palette transformer (Task 4) needs to match source colors written in any CSS form against the user's map keys. We normalize both sides to a canonical `rgb()` / `rgba()` form.

- [ ] **Step 2.1: Write failing test**

Create `tests/rebrand/color-normalize.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { normalizeColor } from '../../src/rebrand/color-normalize.js';

test('normalizeColor: hex3 → rgb', () => {
  assert.strictEqual(normalizeColor('#fff'), 'rgb(255, 255, 255)');
});

test('normalizeColor: hex6 → rgb', () => {
  assert.strictEqual(normalizeColor('#0F1A2B'), 'rgb(15, 26, 43)');
});

test('normalizeColor: hex8 (with alpha) → rgba', () => {
  assert.strictEqual(normalizeColor('#0F1A2BCC'), 'rgba(15, 26, 43, 0.8)');
});

test('normalizeColor: rgb(...) → rgb(...)', () => {
  assert.strictEqual(normalizeColor('rgb(17,17,17)'), 'rgb(17, 17, 17)');
  assert.strictEqual(normalizeColor('rgb(17, 17, 17)'), 'rgb(17, 17, 17)');
});

test('normalizeColor: rgba with alpha=1 → rgb', () => {
  assert.strictEqual(normalizeColor('rgba(255, 0, 0, 1)'), 'rgb(255, 0, 0)');
});

test('normalizeColor: rgba with non-1 alpha → rgba', () => {
  assert.strictEqual(normalizeColor('rgba(255, 0, 0, 0.5)'), 'rgba(255, 0, 0, 0.5)');
});

test('normalizeColor: named color → rgb', () => {
  assert.strictEqual(normalizeColor('white'), 'rgb(255, 255, 255)');
  assert.strictEqual(normalizeColor('black'), 'rgb(0, 0, 0)');
});

test('normalizeColor: returns null for non-color strings', () => {
  assert.strictEqual(normalizeColor('linear-gradient(...)'), null);
  assert.strictEqual(normalizeColor(''), null);
});
```

- [ ] **Step 2.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 8 new tests FAIL.

- [ ] **Step 2.3: Implement color-normalize.ts**

Create `src/rebrand/color-normalize.ts`:

```ts
const NAMED_COLORS: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000',
  blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080',
  silver: '#c0c0c0', maroon: '#800000', olive: '#808000', lime: '#00ff00',
  aqua: '#00ffff', teal: '#008080', navy: '#000080', fuchsia: '#ff00ff',
  purple: '#800080', orange: '#ffa500', transparent: 'rgba(0, 0, 0, 0)',
};

export function normalizeColor(input: string): string | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();

  if (s in NAMED_COLORS) return normalizeColor(NAMED_COLORS[s]);

  // Hex
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return `rgb(${parseInt(h[0]+h[0], 16)}, ${parseInt(h[1]+h[1], 16)}, ${parseInt(h[2]+h[2], 16)})`;
    }
    if (h.length === 6) {
      return `rgb(${parseInt(h.slice(0,2), 16)}, ${parseInt(h.slice(2,4), 16)}, ${parseInt(h.slice(4,6), 16)})`;
    }
    if (h.length === 8) {
      const r = parseInt(h.slice(0,2), 16);
      const g = parseInt(h.slice(2,4), 16);
      const b = parseInt(h.slice(4,6), 16);
      const a = Math.round(parseInt(h.slice(6,8), 16) / 255 * 100) / 100;
      if (a === 1) return `rgb(${r}, ${g}, ${b})`;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return null;
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) {
    const r = parseInt(rgb[1], 10);
    const g = parseInt(rgb[2], 10);
    const b = parseInt(rgb[3], 10);
    const a = rgb[4] !== undefined ? parseFloat(rgb[4]) : 1;
    if (a >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return null;
}
```

- [ ] **Step 2.4: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 38 pass (30 + 8).

- [ ] **Step 2.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/color-normalize.ts tests/rebrand/color-normalize.test.ts && git commit -m "feat(rebrand): color normalizer — hex/rgb/rgba/named → canonical rgb()"
```

---

## Task 3: BrandTransformer

**Files:**
- Create: `src/rebrand/transformers/brand.ts`
- Create: `tests/rebrand/brand.test.ts`

- [ ] **Step 3.1: Write failing test**

Create `tests/rebrand/brand.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyBrand } from '../../src/rebrand/transformers/brand.js';

test('applyBrand replaces source_name in text nodes', () => {
  const $ = load('<h1>Made in Evolve</h1><p>We are Made in Evolve, great.</p>');
  const report = applyBrand($, { name: 'Atelier Noma', source_name: 'Made in Evolve' });
  assert.strictEqual($('h1').text(), 'Atelier Noma');
  assert.strictEqual($('p').text(), 'We are Atelier Noma, great.');
  assert.strictEqual(report.applied, 2);
});

test('applyBrand does NOT touch attribute values', () => {
  const $ = load('<div class="Evolve-section" title="Made in Evolve logo"><span>Made in Evolve</span></div>');
  applyBrand($, { name: 'Atelier Noma', source_name: 'Made in Evolve' });
  assert.strictEqual($('div').attr('class'), 'Evolve-section', 'class attribute untouched');
  assert.strictEqual($('div').attr('title'), 'Made in Evolve logo', 'title attribute untouched');
  assert.strictEqual($('span').text(), 'Atelier Noma', 'text node replaced');
});

test('applyBrand reports 0 applied when source_name not present', () => {
  const $ = load('<h1>Hello world</h1>');
  const report = applyBrand($, { name: 'X', source_name: 'Y' });
  assert.strictEqual(report.applied, 0);
});
```

- [ ] **Step 3.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 3 new tests FAIL.

- [ ] **Step 3.3: Implement brand.ts**

Create `src/rebrand/transformers/brand.ts`:

```ts
import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';

export function applyBrand(
  $: CheerioAPI,
  brand: { name: string; source_name: string }
): TransformerReport {
  let applied = 0;

  // Walk only text nodes inside <body> (or the whole doc if no body)
  const root = $('body').length ? $('body') : $.root();

  root.contents().each(function walk() {
    const self = this as any;
    if (self.type === 'text') {
      const before = self.data as string;
      if (before.includes(brand.source_name)) {
        self.data = before.split(brand.source_name).join(brand.name);
        applied++;
      }
    } else if (self.type === 'tag') {
      // Recurse
      $(self).contents().each(walk);
    }
  });

  return { name: 'brand', applied, skipped: 0, warnings: [] };
}
```

- [ ] **Step 3.4: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 41 pass (38 + 3).

- [ ] **Step 3.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/transformers/brand.ts tests/rebrand/brand.test.ts && git commit -m "feat(rebrand): BrandTransformer — text-node-only brand name swap"
```

---

## Task 4: PaletteTransformer

**Files:**
- Create: `src/rebrand/transformers/palette.ts`
- Create: `tests/rebrand/palette.test.ts`

- [ ] **Step 4.1: Write failing test**

Create `tests/rebrand/palette.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyPalette } from '../../src/rebrand/transformers/palette.js';

test('applyPalette replaces a rgb() color in a style attribute', () => {
  const $ = load('<div style="color: rgb(17, 17, 17); padding: 8px"></div>');
  const report = applyPalette($, { map: { 'rgb(17, 17, 17)': '#0F1A2B' } });
  assert.match($('div').attr('style')!, /color:\s*#0F1A2B/);
  assert.match($('div').attr('style')!, /padding:\s*8px/);
  assert.strictEqual(report.applied, 1);
});

test('applyPalette matches hex source keys against rgb inline styles (normalization)', () => {
  const $ = load('<div style="background-color: rgb(255, 255, 255)"></div>');
  applyPalette($, { map: { '#ffffff': '#F5E6C8' } });
  assert.match($('div').attr('style')!, /background-color:\s*#F5E6C8/);
});

test('applyPalette replaces in gradient stops', () => {
  const $ = load('<div style="background-image: linear-gradient(0deg, rgb(17, 17, 17), rgba(255, 0, 0, 0.5))"></div>');
  const report = applyPalette($, { map: { 'rgb(17, 17, 17)': '#000000' } });
  assert.match($('div').attr('style')!, /linear-gradient\(0deg,\s*#000000,\s*rgba\(255,\s*0,\s*0,\s*0\.5\)\)/);
  assert.strictEqual(report.applied, 1);
});

test('applyPalette reports top-5 unmapped source colors', () => {
  const html = `
    <div style="color: rgb(1, 1, 1)"></div>
    <div style="color: rgb(1, 1, 1)"></div>
    <div style="color: rgb(2, 2, 2)"></div>
    <div style="color: rgb(3, 3, 3); background-color: rgb(4, 4, 4)"></div>
  `;
  const $ = load(html);
  const report = applyPalette($, { map: {} });
  const unmapped = report.info?.topUnmapped as Array<[string, number]>;
  assert.ok(unmapped.length > 0);
  assert.deepStrictEqual(unmapped[0], ['rgb(1, 1, 1)', 2]);
});
```

- [ ] **Step 4.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 4 new tests FAIL.

- [ ] **Step 4.3: Implement palette.ts**

Create `src/rebrand/transformers/palette.ts`:

```ts
import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';
import { normalizeColor } from '../color-normalize.js';

// Matches color values in CSS: hex, rgb(), rgba(), named colors.
// Using a tight pattern to avoid matching inside URLs or identifiers.
const COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)|\b(?:black|white|red|green|blue|yellow|gray|grey|silver|maroon|olive|lime|aqua|teal|navy|fuchsia|purple|orange|transparent)\b/g;

export function applyPalette(
  $: CheerioAPI,
  palette: { map: Record<string, string> }
): TransformerReport {
  // Build normalized lookup: normalized source → user-provided target
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(palette.map)) {
    const n = normalizeColor(k);
    if (n) lookup.set(n, v);
  }

  let applied = 0;
  const unmappedCounts = new Map<string, number>();
  const warnings: string[] = [];

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    const rewritten = style.replace(COLOR_PATTERN, (match) => {
      const norm = normalizeColor(match);
      if (!norm) return match;
      const target = lookup.get(norm);
      if (target) {
        applied++;
        return target;
      }
      unmappedCounts.set(norm, (unmappedCounts.get(norm) || 0) + 1);
      return match;
    });
    if (rewritten !== style) $(el).attr('style', rewritten);
  });

  const topUnmapped = [...unmappedCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (Object.keys(palette.map).length === 0) {
    warnings.push('palette.map is empty — no substitutions made. See topUnmapped for discovery.');
  }

  return {
    name: 'palette',
    applied,
    skipped: 0,
    warnings,
    info: { topUnmapped },
  };
}
```

- [ ] **Step 4.4: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 45 pass (41 + 4).

- [ ] **Step 4.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/transformers/palette.ts tests/rebrand/palette.test.ts && git commit -m "feat(rebrand): PaletteTransformer — strict map-only substitution + top-5 unmapped report"
```

---

## Task 5: TypographyTransformer

**Files:**
- Create: `src/rebrand/transformers/typography.ts`
- Create: `tests/rebrand/typography.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `tests/rebrand/typography.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyTypography } from '../../src/rebrand/transformers/typography.js';

test('applyTypography replaces the most-frequent font-family (primary role)', () => {
  const html = `
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <h1 style="font-family: Georgia; font-size: 48px">title</h1>
  `;
  const $ = load(html);
  const report = applyTypography($, {
    primary: { family: 'Inter', google: false },
  });
  assert.match($('p').first().attr('style')!, /font-family:\s*Inter/);
  assert.strictEqual(report.applied >= 3, true);
});

test('applyTypography replaces display-role fonts on large headings', () => {
  const html = `
    <p style="font-family: Helvetica; font-size: 14px">body</p>
    <h1 style="font-family: Georgia; font-size: 48px">title</h1>
    <h2 style="font-family: Georgia; font-size: 40px">sub</h2>
  `;
  const $ = load(html);
  applyTypography($, {
    display: { family: 'Playfair Display', google: false },
  });
  assert.match($('h1').attr('style')!, /font-family:\s*Playfair Display/);
  assert.match($('h2').attr('style')!, /font-family:\s*Playfair Display/);
  assert.match($('p').attr('style')!, /font-family:\s*Helvetica/); // untouched
});

test('applyTypography adds Google Fonts link to <head> when google:true', () => {
  const $ = load('<html><head></head><body><p style="font-family: Helvetica">hi</p></body></html>');
  applyTypography($, {
    primary: { family: 'Inter', google: true },
    display: { family: 'Playfair Display', google: true },
  });
  const links = $('head link[href*="fonts.googleapis.com"]');
  assert.strictEqual(links.length, 1, 'one combined Google Fonts link');
  const href = links.attr('href')!;
  assert.match(href, /family=Inter/);
  assert.match(href, /family=Playfair\+Display/);
});
```

- [ ] **Step 5.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 3 new tests FAIL.

- [ ] **Step 5.3: Implement typography.ts**

Create `src/rebrand/transformers/typography.ts`:

```ts
import type { CheerioAPI } from 'cheerio';
import { TransformerReport } from '../types.js';

const FAMILY_PATTERN = /font-family:\s*([^;]+?)(?=;|$)/g;
const FONT_SIZE_PATTERN = /font-size:\s*(\d+(?:\.\d+)?)px/;
const DISPLAY_MIN_PX = 32;

export function applyTypography(
  $: CheerioAPI,
  typography: {
    primary?: { family: string; google?: boolean };
    display?: { family: string; google?: boolean };
  }
): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  // Step 1: count font-family occurrences to pick the "primary" (most-frequent on text-bearing elements)
  const familyCounts = new Map<string, number>();
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || '';
    let m: RegExpExecArray | null;
    const re = /font-family:\s*([^;]+?)(?=;|$)/g;
    while ((m = re.exec(style)) !== null) {
      const fam = m[1].trim();
      familyCounts.set(fam, (familyCounts.get(fam) || 0) + 1);
    }
  });

  const primaryFamily = [...familyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  // Step 2: rewrite inline styles
  $('[style]').each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase?.() ?? '';
    const style = $(el).attr('style') || '';

    const rewritten = style.replace(FAMILY_PATTERN, (_match, fam: string) => {
      const current = fam.trim();

      // Display role: large heading tags
      if (typography.display && ['h1', 'h2', 'h3'].includes(tag)) {
        const sizeMatch = FONT_SIZE_PATTERN.exec(style);
        const size = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
        if (size >= DISPLAY_MIN_PX) {
          applied++;
          return `font-family: ${typography.display.family}`;
        }
      }

      // Primary role: most-frequent source family
      if (typography.primary && current === primaryFamily) {
        applied++;
        return `font-family: ${typography.primary.family}`;
      }

      return `font-family: ${current}`;
    });

    if (rewritten !== style) $(el).attr('style', rewritten);
  });

  // Step 3: Google Fonts link injection
  const googleFamilies: string[] = [];
  if (typography.primary?.google) googleFamilies.push(typography.primary.family);
  if (typography.display?.google) googleFamilies.push(typography.display.family);

  if (googleFamilies.length) {
    const href = 'https://fonts.googleapis.com/css2?'
      + googleFamilies.map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}`).join('&')
      + '&display=swap';

    let head = $('head');
    if (!head.length) {
      $('html').prepend('<head></head>');
      head = $('head');
    }
    // Remove any prior rebrand-injected Google Fonts link to avoid duplicates
    head.find('link[data-rebrand-google-fonts]').remove();
    head.append(`<link rel="stylesheet" data-rebrand-google-fonts href="${href}">`);
  }

  if (!primaryFamily && typography.primary) warnings.push('no font-family found in inline styles — primary not applied');

  return { name: 'typography', applied, skipped: 0, warnings };
}
```

- [ ] **Step 5.4: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 48 pass. If "Playfair+Display" encoding test fails, verify URLSearchParams vs manual encoding — the manual approach above uses `encodeURIComponent` then replaces `%20` with `+` for the Google Fonts idiom.

- [ ] **Step 5.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/transformers/typography.ts tests/rebrand/typography.test.ts && git commit -m "feat(rebrand): TypographyTransformer — font swap + Google Fonts injection"
```

---

## Task 6: CopyTransformer

**Files:**
- Create: `src/rebrand/transformers/copy.ts`
- Create: `tests/rebrand/copy.test.ts`

- [ ] **Step 6.1: Write failing test**

Create `tests/rebrand/copy.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { load } from 'cheerio';
import { applyCopy } from '../../src/rebrand/transformers/copy.js';

test('applyCopy from/to replaces literal text in text nodes', () => {
  const $ = load('<p>Digital evolution happens here.</p>');
  const report = applyCopy($, [{ from: 'Digital evolution', to: 'Artisanat du bois' }]);
  assert.strictEqual($('p').text(), 'Artisanat du bois happens here.');
  assert.strictEqual(report.applied, 1);
});

test('applyCopy selector/to replaces text content of matching elements', () => {
  const $ = load('<h1>Old heading</h1><h2>Keep this</h2>');
  applyCopy($, [{ selector: 'h1', to: 'New heading' }]);
  assert.strictEqual($('h1').text(), 'New heading');
  assert.strictEqual($('h2').text(), 'Keep this');
});

test('applyCopy warns when new text is >1.5x original length', () => {
  const $ = load('<p>Short</p>');
  const report = applyCopy($, [{ from: 'Short', to: 'Much much longer replacement text' }]);
  assert.strictEqual(report.warnings.length, 1);
  assert.match(report.warnings[0], /1\.5/);
});

test('applyCopy warns when from string has no match', () => {
  const $ = load('<p>Hello</p>');
  const report = applyCopy($, [{ from: 'Not present', to: 'New' }]);
  assert.match(report.warnings[0], /no match/i);
  assert.strictEqual(report.applied, 0);
});
```

- [ ] **Step 6.2: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 4 new tests FAIL.

- [ ] **Step 6.3: Implement copy.ts**

Create `src/rebrand/transformers/copy.ts`:

```ts
import type { CheerioAPI } from 'cheerio';
import { TransformerReport, CopyEntry } from '../types.js';

export function applyCopy($: CheerioAPI, entries: CopyEntry[]): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let matched = 0;
    let originalLen = 0;

    if ('from' in entry) {
      const root = $('body').length ? $('body') : $.root();
      root.contents().each(function walk() {
        const self = this as any;
        if (self.type === 'text') {
          if ((self.data as string).includes(entry.from)) {
            self.data = (self.data as string).split(entry.from).join(entry.to);
            matched++;
            applied++;
          }
        } else if (self.type === 'tag') {
          $(self).contents().each(walk);
        }
      });
      originalLen = entry.from.length;
      if (matched === 0) warnings.push(`copy[${i}]: no match for "${entry.from}"`);
    } else {
      const els = $(entry.selector);
      if (!els.length) {
        warnings.push(`copy[${i}]: selector "${entry.selector}" matched 0 elements`);
      } else {
        els.each((_, el) => {
          originalLen = Math.max(originalLen, $(el).text().length);
          $(el).text(entry.to);
          matched++;
          applied++;
        });
      }
    }

    if (originalLen > 0 && entry.to.length > originalLen * 1.5) {
      warnings.push(`copy[${i}]: new text ${(entry.to.length / originalLen).toFixed(1)}× longer than original (>1.5× threshold)`);
    }
  }

  return { name: 'copy', applied, skipped: 0, warnings };
}
```

- [ ] **Step 6.4: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 52 pass.

- [ ] **Step 6.5: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/transformers/copy.ts tests/rebrand/copy.test.ts && git commit -m "feat(rebrand): CopyTransformer — from/selector modes with length warnings"
```

---

## Task 7: ImagesTransformer

**Files:**
- Create: `src/rebrand/transformers/images.ts`
- Create: `tests/rebrand/images.test.ts`
- Create: `tests/rebrand/fixtures/new-hero.jpg` (tiny fixture image)

- [ ] **Step 7.1: Create the tiny fixture image**

```bash
cd /Users/salah/Desktop/Clonage && node -e "const f=require('fs'); const buf=Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb00430008060607060508070708090908060a0b0a0b0c0b0b0b0c0b0b0b0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0cffc00011080001000103012200021101031101ffc4001500010100000000000000000000000000000007ffc40014100100000000000000000000000000000000ffc40014010100000000000000000000000000000000ffc400141101000000000000000000000000000000000003ffda000c03010002110311003f00fbd0003f00','hex'); f.writeFileSync('tests/rebrand/fixtures/new-hero.jpg', buf)"
```
Expected: a 1×1 minimal JPEG created.

- [ ] **Step 7.2: Write failing test**

Create `tests/rebrand/images.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import * as path from 'path';
import { load } from 'cheerio';
import { applyImages } from '../../src/rebrand/transformers/images.js';

const FIXTURE_IMG = path.resolve(process.cwd(), 'tests/rebrand/fixtures/new-hero.jpg');

test('applyImages from/to matches suffix and rewrites <img src>', () => {
  const $ = load('<img src="./assets/old-hero.webp"><img src="./assets/logo.svg">');
  applyImages($, [{ from: 'old-hero.webp', to: 'https://cdn.example.com/new.jpg' }]);
  assert.strictEqual($('img').eq(0).attr('src'), 'https://cdn.example.com/new.jpg');
  assert.strictEqual($('img').eq(1).attr('src'), './assets/logo.svg');
});

test('applyImages selector/to rewrites matching <img>', () => {
  const $ = load('<img class="hero-img" src="a.jpg"><img class="other" src="b.jpg">');
  applyImages($, [{ selector: '.hero-img', to: 'https://cdn.example.com/new.jpg' }]);
  assert.strictEqual($('img.hero-img').attr('src'), 'https://cdn.example.com/new.jpg');
  assert.strictEqual($('img.other').attr('src'), 'b.jpg');
});

test('applyImages inlines local files as data: URLs', () => {
  const $ = load('<img class="hero-img" src="old.jpg">');
  applyImages($, [{ selector: '.hero-img', to: FIXTURE_IMG }]);
  const src = $('img.hero-img').attr('src')!;
  assert.match(src, /^data:image\/jpeg;base64,/);
});

test('applyImages warns on missing local file', () => {
  const $ = load('<img class="hero-img" src="old.jpg">');
  const report = applyImages($, [{ selector: '.hero-img', to: './nonexistent.jpg' }]);
  assert.match(report.warnings[0], /not found/);
});
```

- [ ] **Step 7.3: Run to verify it fails**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 4 new tests FAIL.

- [ ] **Step 7.4: Implement images.ts**

Create `src/rebrand/transformers/images.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { CheerioAPI } from 'cheerio';
import { TransformerReport, ImageEntry } from '../types.js';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

export function applyImages($: CheerioAPI, entries: ImageEntry[]): TransformerReport {
  let applied = 0;
  const warnings: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const resolvedTo = resolveTarget(entry.to, warnings, i);
    if (resolvedTo === null) continue;

    if ('from' in entry) {
      const matches = $('img').filter((_, el) => {
        const src = $(el).attr('src') || '';
        return src.endsWith(entry.from);
      });
      if (!matches.length) {
        warnings.push(`images[${i}]: no <img> ends with "${entry.from}"`);
      } else {
        matches.each((_, el) => { $(el).attr('src', resolvedTo); applied++; });
      }
    } else {
      // Scope selector to <img> so ".hero-img" becomes "img.hero-img", ".foo > .bar" stays as-is if already img-scoped.
      const scoped = entry.selector.match(/^\s*img\b/) ? entry.selector : `img${entry.selector}`;
      const els = $(scoped);
      if (!els.length) {
        warnings.push(`images[${i}]: selector "${entry.selector}" matched 0 <img>`);
      } else {
        els.each((_, el) => { $(el).attr('src', resolvedTo); applied++; });
      }
    }
  }

  return { name: 'images', applied, skipped: 0, warnings };
}

function resolveTarget(to: string, warnings: string[], idx: number): string | null {
  // http(s) → passthrough
  if (/^https?:\/\//.test(to)) return to;

  // data: → passthrough
  if (to.startsWith('data:')) return to;

  // local path → inline as data URL
  const absolute = path.isAbsolute(to) ? to : path.resolve(process.cwd(), to);
  if (!fs.existsSync(absolute)) {
    warnings.push(`images[${idx}]: local file not found: ${absolute}`);
    return null;
  }
  const buf = fs.readFileSync(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}
```

- [ ] **Step 7.5: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 56 pass.

- [ ] **Step 7.6: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/transformers/images.ts tests/rebrand/images.test.ts tests/rebrand/fixtures/new-hero.jpg && git commit -m "feat(rebrand): ImagesTransformer — from/selector modes, local inline + URL passthrough"
```

---

## Task 8: Orchestrator

**Files:**
- Create: `src/rebrand/index.ts`

- [ ] **Step 8.1: Implement orchestrator**

Create `src/rebrand/index.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';
import { RebrandOptions, RebrandResult, TransformerReport } from './types.js';
import { applyBrand } from './transformers/brand.js';
import { applyPalette } from './transformers/palette.js';
import { applyTypography } from './transformers/typography.js';
import { applyCopy } from './transformers/copy.js';
import { applyImages } from './transformers/images.js';
import { logger } from '../utils/logger.js';

export async function rebrand(options: RebrandOptions): Promise<RebrandResult> {
  const inputAbs = path.resolve(options.inputHtml);
  if (!fs.existsSync(inputAbs)) {
    throw new Error(`rebrand: input HTML not found: ${inputAbs}`);
  }
  const html = fs.readFileSync(inputAbs, 'utf-8');
  const $ = load(html);

  const reports: TransformerReport[] = [];

  logger.step(1, 5, 'Brand (nom / logo text)...');
  if (options.brief.brand) reports.push(applyBrand($, options.brief.brand));
  else reports.push({ name: 'brand', applied: 0, skipped: 1, warnings: [] });

  logger.step(2, 5, 'Palette (couleurs)...');
  if (options.brief.palette) reports.push(applyPalette($, options.brief.palette));
  else reports.push({ name: 'palette', applied: 0, skipped: 1, warnings: [] });

  logger.step(3, 5, 'Typography (polices)...');
  if (options.brief.typography) reports.push(applyTypography($, options.brief.typography));
  else reports.push({ name: 'typography', applied: 0, skipped: 1, warnings: [] });

  logger.step(4, 5, 'Copy (textes)...');
  if (options.brief.copy?.length) reports.push(applyCopy($, options.brief.copy));
  else reports.push({ name: 'copy', applied: 0, skipped: 1, warnings: [] });

  logger.step(5, 5, 'Images...');
  if (options.brief.images?.length) reports.push(applyImages($, options.brief.images));
  else reports.push({ name: 'images', applied: 0, skipped: 1, warnings: [] });

  // Output
  const outputPath = options.outputPath ?? defaultOutputPath(inputAbs);
  fs.writeFileSync(outputPath, $.html(), 'utf-8');

  const metadataPath = outputPath.replace(/\.html$/i, '._rebrand.json');
  fs.writeFileSync(metadataPath, JSON.stringify({
    inputHtml: inputAbs,
    outputHtml: outputPath,
    brandName: options.brief.brand?.name ?? null,
    reports,
    timestamp: new Date().toISOString(),
  }, null, 2));

  const applied = reports.reduce((s, r) => s + r.applied, 0);
  const warnings = reports.reduce((s, r) => s + r.warnings.length, 0);
  if (warnings) logger.warn(`Rebrand: ${applied} substitutions, ${warnings} warnings — voir ${metadataPath}`);
  else logger.success(`Rebrand: ${applied} substitutions — ${outputPath}`);

  return { outputHtml: outputPath, metadataPath, reports };
}

function defaultOutputPath(input: string): string {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}.rebranded.html`);
}
```

- [ ] **Step 8.2: TypeScript compile check**

```bash
cd /Users/salah/Desktop/Clonage && npx tsc --noEmit 2>&1 | head -10
```
Expected: no errors.

- [ ] **Step 8.3: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -10
```
Expected: 56 pass (unchanged — no tests in this task).

- [ ] **Step 8.4: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/rebrand/index.ts && git commit -m "feat(rebrand): orchestrator — 5 transformers in sequence + _rebrand.json metadata"
```

---

## Task 9: CLI subcommand

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 9.1: Find insertion point**

```bash
cd /Users/salah/Desktop/Clonage && grep -n "program.parse" src/cli.ts
```
Insert the new command immediately before `program.parse()`.

- [ ] **Step 9.2: Add command**

Insert into `src/cli.ts` before `program.parse`:

```ts
// === REBRAND command (deterministic, LLM-free) ===
program
  .command('rebrand <html>')
  .description('Appliquer un brand brief JSON a un HTML reproduit (nom, couleurs, typo, copy, images)')
  .requiredOption('-b, --brief <path>', 'Chemin vers le brand brief JSON')
  .option('-o, --output <path>', 'Fichier HTML de sortie (default: {basename}.rebranded.html)')
  .action(async (htmlPath: string, options: any) => {
    try {
      const { loadBrief } = await import('./rebrand/brief.js');
      const { rebrand } = await import('./rebrand/index.js');
      const brief = loadBrief(path.resolve(options.brief));
      const result = await rebrand({
        inputHtml: path.resolve(htmlPath),
        brief,
        outputPath: options.output ? path.resolve(options.output) : undefined,
      });
      logger.info(`Output: ${result.outputHtml}`);
      logger.info(`Metadata: ${result.metadataPath}`);
      const hasWarnings = result.reports.some(r => r.warnings.length > 0);
      process.exit(hasWarnings ? 0 : 0); // warnings don't fail the command
    } catch (err: any) {
      logger.error(err.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 9.3: Build and smoke-test**

```bash
cd /Users/salah/Desktop/Clonage && npm run build 2>&1 | tail -5 && node dist/cli.js rebrand --help 2>&1 | head -20
```
Expected: help text lists `--brief` (required) and `--output`.

- [ ] **Step 9.4: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add src/cli.ts && git commit -m "feat(cli): rebrand command"
```

---

## Task 10: End-to-end integration test

**Files:**
- Create: `tests/rebrand/e2e.test.ts`

- [ ] **Step 10.1: Write the E2E test**

Create `tests/rebrand/e2e.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rebrand } from '../../src/rebrand/index.js';
import { loadBrief } from '../../src/rebrand/brief.js';

test('rebrand E2E: passthrough when brief is empty ({})', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebrand-e2e-'));
  const inputPath = path.join(outDir, 'hero.html');
  fs.writeFileSync(inputPath, '<!DOCTYPE html><html><body><h1 style="color: rgb(42,24,16); font-family: Arial; font-size: 72px">Fixture Hero</h1></body></html>');

  const result = await rebrand({
    inputHtml: inputPath,
    brief: {},
  });

  const out = fs.readFileSync(result.outputHtml, 'utf-8');
  assert.match(out, /Fixture Hero/);
  assert.match(out, /rgb\(42,24,16\)|rgb\(42, 24, 16\)/);
  assert.strictEqual(result.reports.every(r => r.skipped === 1), true);
});

test('rebrand E2E: full brief applies all 5 transformers', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebrand-e2e-'));
  const inputPath = path.join(outDir, 'hero.html');
  fs.writeFileSync(inputPath, `
    <!DOCTYPE html><html><head></head><body>
    <h1 style="color: rgb(42, 24, 16); font-family: Arial; font-size: 72px">Fixture Hero</h1>
    <p style="color: rgb(100, 100, 100); font-family: Arial; font-size: 14px">Some body copy</p>
    <img class="hero-img" src="./old-hero.jpg">
    </body></html>
  `);

  const briefPath = path.resolve(process.cwd(), 'tests/rebrand/fixtures/brief-full.json');
  const brief = loadBrief(briefPath);

  const result = await rebrand({ inputHtml: inputPath, brief });

  const out = fs.readFileSync(result.outputHtml, 'utf-8');

  // brand.name replaced source_name
  assert.match(out, /Atelier Noma/, 'brand name replaced');
  // palette map applied
  assert.match(out, /color:\s*#0F1A2B/, 'palette color mapped');
  // typography applied (display for h1)
  assert.match(out, /font-family:\s*Playfair Display/, 'display font applied to h1');
  assert.match(out, /font-family:\s*Inter/, 'primary font applied to body');
  // Google Fonts link injected
  assert.match(out, /fonts\.googleapis\.com/, 'google fonts link');
  // image: selector-based replacement (to points to ./assets/new-hero.jpg which does not exist — warning, not error)
  const imgReport = result.reports.find(r => r.name === 'images')!;
  assert.ok(imgReport.warnings.length > 0 || imgReport.applied > 0, 'image transformer ran');

  // metadata
  const meta = JSON.parse(fs.readFileSync(result.metadataPath, 'utf-8'));
  assert.strictEqual(meta.brandName, 'Atelier Noma');
  assert.strictEqual(meta.reports.length, 5);
});
```

- [ ] **Step 10.2: Run tests**

```bash
cd /Users/salah/Desktop/Clonage && npm test 2>&1 | tail -15
```
Expected: 58 pass (56 + 2). If the second test fails because `./assets/new-hero.jpg` from the brief fixture doesn't resolve (it's a relative path resolved against cwd), the assertion `imgReport.warnings.length > 0 || imgReport.applied > 0` should still pass because we assert OR.

- [ ] **Step 10.3: Commit**

```bash
cd /Users/salah/Desktop/Clonage && git add tests/rebrand/e2e.test.ts && git commit -m "test(rebrand): e2e — passthrough + full 5-axis brief"
```

---

## Self-Review Checklist (after all tasks)

- [ ] Every section of the spec maps to at least one task above. Schema, transformers (brand/palette/typography/copy/images), orchestrator, CLI, tests — all present.
- [ ] No TODO/TBD/placeholder in task code blocks.
- [ ] Types (`BrandBrief`, `TransformerReport`, etc.) declared in Task 1 are the same names used in Tasks 3-10.
- [ ] Function names consistent: `applyBrand`, `applyPalette`, `applyTypography`, `applyCopy`, `applyImages` — used identically across Task + tests + orchestrator.
- [ ] Fixture paths use `process.cwd()` consistently (tests compile to `dist-test/`; `__dirname` would break).
- [ ] Each task has its own commit; scoped messages (feat/test/docs).
- [ ] Existing test count (24 from Phase 1) + 34 new = 58 expected at end.

---

**Plan ready for execution.**
