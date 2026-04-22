import type { Page } from 'playwright';
import type {
  DesignTokens,
  ColorTokens,
  ColorEntry,
  SpacingTokens,
  TypographyTokens,
  FontToken,
  TypeScaleEntry,
  BorderTokens,
  EffectTokens,
} from '../types.js';

/**
 * Convert an rgb/rgba string to a hex color.
 * Handles: "rgb(r, g, b)", "rgba(r, g, b, a)", passthrough for already-hex values.
 *
 * Exported for use by other modules. A duplicate lives inside page.evaluate()
 * because browser-context callbacks cannot reference outer-scope closures.
 */
export function rgbToHex(rgb: string): string {
  // Already hex
  if (rgb.startsWith('#')) return rgb.toLowerCase();

  const match = rgb.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/
  );
  if (!match) return rgb;

  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);

  return (
    '#' +
    [r, g, b]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toLowerCase()
  );
}

/**
 * Extract design tokens from a live page by computing styles on every element.
 *
 * The entire extraction runs inside a single `page.evaluate()` call so that
 * no DOM references cross the serialization boundary. The returned object is
 * plain JSON matching the `DesignTokens` interface.
 */
export async function extractDesignTokens(page: Page): Promise<DesignTokens> {
  // ------------------------------------------------------------------
  // Everything inside this callback executes in the browser context.
  // We cannot reference outer-scope helpers, so rgbToHex is duplicated
  // inside the evaluate body.
  // ------------------------------------------------------------------
  const raw = await page.evaluate(() => {
    // ---- browser-side helpers ----

    /** Convert rgb()/rgba() to #rrggbb */
    function _rgbToHex(rgb: string): string {
      if (rgb.startsWith('#')) return rgb.toLowerCase();
      const m = rgb.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)/
      );
      if (!m) return rgb;
      const r = parseInt(m[1], 10);
      const g = parseInt(m[2], 10);
      const b = parseInt(m[3], 10);
      return (
        '#' +
        [r, g, b]
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')
          .toLowerCase()
      );
    }

    /** Check if a color string is transparent / invisible */
    function _isTransparent(c: string): boolean {
      return (
        c === 'transparent' ||
        c === 'rgba(0, 0, 0, 0)' ||
        c === 'rgba(0,0,0,0)'
      );
    }

    /** Parse a px value string to a number, returns NaN for non-px */
    function _px(v: string): number {
      if (v.endsWith('px')) return parseFloat(v);
      return NaN;
    }

    // ---- collect all elements ----
    const allEls = document.querySelectorAll('*');
    const vpWidth = window.innerWidth;

    // ---- COLOR MAPS ----
    // Map<hex, { count, contexts: Set<string> }>
    const colorMap = new Map<
      string,
      { count: number; contexts: Set<string> }
    >();

    function _trackColor(hex: string, context: string) {
      if (!hex || hex.length !== 7 || !hex.startsWith('#')) return;
      const entry = colorMap.get(hex);
      if (entry) {
        entry.count++;
        entry.contexts.add(context);
      } else {
        colorMap.set(hex, { count: 1, contexts: new Set([context]) });
      }
    }

    const gradients = new Set<string>();

    // ---- SPACING ----
    const spacingValues = new Set<number>();

    // ---- SECTION PADDINGS ----
    const sectionPaddingsSet = new Set<number>();
    const sectionSelector = 'section, [class*="section"], main > div';
    const sectionEls = document.querySelectorAll(sectionSelector);

    // ---- TYPOGRAPHY ----
    const typoSelector =
      'h1, h2, h3, h4, h5, h6, p, a, li, span, blockquote, figcaption, label, button';
    const typoEls = document.querySelectorAll(typoSelector);

    // fontSize -> { count, lineHeight, letterSpacing, fontWeight, fontFamily, tags }
    const typeMap = new Map<
      number,
      {
        count: number;
        lineHeight: number;
        letterSpacing: string;
        fontWeight: string;
        fontFamily: string;
        tags: Set<string>;
      }
    >();

    // fontFamily -> { weights: Set, headingCount, bodyCount, singleUse: boolean }
    const fontMap = new Map<
      string,
      { weights: Set<string>; headingCount: number; bodyCount: number; totalCount: number }
    >();

    // ---- BORDERS ----
    const radiiSet = new Set<number>();
    const widthsSet = new Set<number>();

    // ---- EFFECTS ----
    const shadowsSet = new Set<string>();
    const blendModesSet = new Set<string>();
    const filtersSet = new Set<string>();
    const backdropFiltersSet = new Set<string>();

    // ================================================================
    //  MAIN LOOP: walk every element once
    // ================================================================
    allEls.forEach((el) => {
      const cs = getComputedStyle(el);

      // -- Colors --
      const bg = cs.backgroundColor;
      const fg = cs.color;
      const bc = cs.borderColor;

      if (!_isTransparent(bg)) {
        _trackColor(_rgbToHex(bg), 'backgroundColor');
      }
      if (!_isTransparent(fg)) {
        _trackColor(_rgbToHex(fg), 'color');
      }
      if (!_isTransparent(bc)) {
        // borderColor can be a shorthand with multiple values
        bc.split(/\s+/).forEach((part) => {
          if (!_isTransparent(part)) {
            _trackColor(_rgbToHex(part), 'borderColor');
          }
        });
      }

      // -- Gradients --
      const bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== 'none' && bgImg.includes('gradient')) {
        gradients.add(bgImg);
      }

      // -- Spacing --
      const spacingProps = [
        'marginTop',
        'marginBottom',
        'paddingTop',
        'paddingBottom',
        'gap',
        'rowGap',
        'columnGap',
      ] as const;

      for (const prop of spacingProps) {
        const v = _px(cs.getPropertyValue(
          // camelCase -> kebab-case for getPropertyValue
          prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
        ));
        if (!isNaN(v) && v > 0 && v < 500) {
          spacingValues.add(Math.round(v));
        }
      }

      // -- Borders --
      // borderRadius/borderWidth can be compound ("4px 4px 0px 0px"),
      // so we split and parse each individual value.
      const brRaw = cs.getPropertyValue('border-radius');
      if (brRaw && brRaw !== '0px') {
        brRaw.split(/\s+/).forEach((part) => {
          const v = _px(part);
          if (!isNaN(v) && v > 0) radiiSet.add(Math.round(v));
        });
      }

      const bwRaw = cs.getPropertyValue('border-width');
      if (bwRaw && bwRaw !== '0px') {
        bwRaw.split(/\s+/).forEach((part) => {
          const v = _px(part);
          if (!isNaN(v) && v > 0) widthsSet.add(Math.round(v));
        });
      }

      // -- Effects --
      if (cs.boxShadow && cs.boxShadow !== 'none') {
        shadowsSet.add(cs.boxShadow);
      }
      if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') {
        blendModesSet.add(cs.mixBlendMode);
      }
      if (cs.filter && cs.filter !== 'none') {
        filtersSet.add(cs.filter);
      }
      if (cs.backdropFilter && cs.backdropFilter !== 'none') {
        backdropFiltersSet.add(cs.backdropFilter);
      }
    });

    // ================================================================
    //  TYPOGRAPHY LOOP: heading/text elements only
    // ================================================================
    typoEls.forEach((el) => {
      const cs = getComputedStyle(el);
      const tag = el.tagName.toLowerCase();

      const fontSize = parseFloat(cs.fontSize);
      if (isNaN(fontSize) || fontSize <= 0) return;

      const lineHeight =
        cs.lineHeight === 'normal'
          ? 1.2
          : parseFloat(cs.lineHeight) / fontSize;

      const letterSpacing =
        cs.letterSpacing === 'normal'
          ? '0em'
          : (parseFloat(cs.letterSpacing) / fontSize).toFixed(3) + 'em';

      const fontWeight = cs.fontWeight;
      const fontFamily = cs.fontFamily.split(',')[0].trim().replace(/['"]/g, '');

      // Type scale map
      const rounded = Math.round(fontSize * 10) / 10; // round to 0.1px
      const existing = typeMap.get(rounded);
      if (existing) {
        existing.count++;
        existing.tags.add(tag);
      } else {
        typeMap.set(rounded, {
          count: 1,
          lineHeight: Math.round(lineHeight * 100) / 100,
          letterSpacing,
          fontWeight,
          fontFamily,
          tags: new Set([tag]),
        });
      }

      // Font family map
      const isHeading = /^h[1-3]$/.test(tag);
      const isBody = /^(p|li|span)$/.test(tag);
      const fe = fontMap.get(fontFamily);
      if (fe) {
        fe.weights.add(fontWeight);
        fe.totalCount++;
        if (isHeading) fe.headingCount++;
        if (isBody) fe.bodyCount++;
      } else {
        fontMap.set(fontFamily, {
          weights: new Set([fontWeight]),
          headingCount: isHeading ? 1 : 0,
          bodyCount: isBody ? 1 : 0,
          totalCount: 1,
        });
      }
    });

    // ================================================================
    //  SECTION PADDINGS
    // ================================================================
    sectionEls.forEach((el) => {
      const rect = el.getBoundingClientRect();
      // Only consider elements spanning > 80% of viewport width
      if (rect.width < vpWidth * 0.8) return;

      const cs = getComputedStyle(el);
      const pt = _px(cs.paddingTop);
      const pb = _px(cs.paddingBottom);
      if (!isNaN(pt) && pt > 0) sectionPaddingsSet.add(Math.round(pt));
      if (!isNaN(pb) && pb > 0) sectionPaddingsSet.add(Math.round(pb));
    });

    // ================================================================
    //  SERIALIZE for return (Sets -> Arrays, Maps -> plain objects)
    // ================================================================

    // Colors: convert map to serializable array
    const colorEntries: {
      value: string;
      count: number;
      contexts: string[];
    }[] = [];
    colorMap.forEach((v, hex) => {
      colorEntries.push({
        value: hex,
        count: v.count,
        contexts: Array.from(v.contexts),
      });
    });

    // Type scale entries
    const scaleEntries: {
      size: number;
      lineHeight: number;
      letterSpacing: string;
      fontWeight: string;
      fontFamily: string;
      count: number;
      tags: string[];
    }[] = [];
    typeMap.forEach((v, size) => {
      scaleEntries.push({
        size,
        lineHeight: v.lineHeight,
        letterSpacing: v.letterSpacing,
        fontWeight: v.fontWeight,
        fontFamily: v.fontFamily,
        count: v.count,
        tags: Array.from(v.tags),
      });
    });

    // Font entries
    const fontEntries: {
      family: string;
      weights: string[];
      headingCount: number;
      bodyCount: number;
      totalCount: number;
    }[] = [];
    fontMap.forEach((v, family) => {
      fontEntries.push({
        family,
        weights: Array.from(v.weights),
        headingCount: v.headingCount,
        bodyCount: v.bodyCount,
        totalCount: v.totalCount,
      });
    });

    return {
      colorEntries,
      gradients: Array.from(gradients),
      spacingValues: Array.from(spacingValues),
      sectionPaddings: Array.from(sectionPaddingsSet),
      scaleEntries,
      fontEntries,
      radii: Array.from(radiiSet),
      widths: Array.from(widthsSet),
      shadows: Array.from(shadowsSet),
      blendModes: Array.from(blendModesSet),
      filters: Array.from(filtersSet),
      backdropFilters: Array.from(backdropFiltersSet),
    };
  });

  // ================================================================
  //  POST-PROCESS: classify and structure into DesignTokens
  // ================================================================

  // ------------------------------------------------------------------
  //  COLORS
  // ------------------------------------------------------------------
  const allColors: ColorEntry[] = raw.colorEntries.map((c) => ({
    value: c.value,
    count: c.count,
    contexts: c.contexts,
  }));

  // Sort descending by frequency for role classification
  const sorted = [...allColors].sort((a, b) => b.count - a.count);

  // Classify roles
  const bgColors = sorted.filter((c) =>
    c.contexts.includes('backgroundColor')
  );
  const textColors = sorted.filter((c) => c.contexts.includes('color'));

  if (bgColors.length > 0) bgColors[0].role = 'primary-bg';
  if (textColors.length > 0) textColors[0].role = 'primary-text';

  // Accent & muted: rare + saturated = accent, desaturated = muted
  for (const entry of sorted) {
    if (entry.role) continue; // already classified

    const hex = entry.value;
    // Need at least 7-char hex
    if (hex.length !== 7) continue;

    const sat = (() => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const l = (max + min) / 2;
      return l > 0.5
        ? (max - min) / (2 - max - min)
        : (max - min) / (max + min);
    })();

    if (sat < 0.15) {
      entry.role = 'muted';
    } else if (entry.count <= 3 && sat > 0.4) {
      entry.role = 'accent';
    }
  }

  // Separate into sub-arrays
  const backgrounds = allColors.filter((c) =>
    c.contexts.includes('backgroundColor')
  );
  const texts = allColors.filter((c) => c.contexts.includes('color'));
  const accents = allColors.filter((c) => c.role === 'accent');

  const colors: ColorTokens = {
    palette: allColors,
    backgrounds,
    texts,
    accents,
    gradients: raw.gradients,
  };

  // ------------------------------------------------------------------
  //  SPACING
  // ------------------------------------------------------------------
  const uniqueSpacing = [...new Set(raw.spacingValues)].sort((a, b) => a - b);

  // Detect base unit: try 4, 8, 6 -- whichever has the most multiples
  const candidates = [4, 8, 6];
  let bestBase = 4;
  let bestMultiples = 0;
  for (const base of candidates) {
    const multiples = uniqueSpacing.filter((v) => v % base === 0).length;
    if (multiples > bestMultiples) {
      bestMultiples = multiples;
      bestBase = base;
    }
  }

  // Build the cleaned scale (only multiples of the base unit)
  const scale = uniqueSpacing.filter((v) => v % bestBase === 0);

  // Detect geometric ratio between consecutive scale values
  let spacingRatio: number | null = null;
  if (scale.length >= 3) {
    const ratios: number[] = [];
    for (let i = 1; i < scale.length; i++) {
      if (scale[i - 1] > 0) {
        ratios.push(scale[i] / scale[i - 1]);
      }
    }
    // Check if ratios are reasonably consistent (std dev < 30% of mean)
    if (ratios.length > 0) {
      const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      const variance =
        ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev / mean < 0.3) {
        spacingRatio = Math.round(mean * 100) / 100;
      }
    }
  }

  const sectionPaddings = [...new Set(raw.sectionPaddings)].sort(
    (a, b) => a - b
  );

  const spacing: SpacingTokens = {
    values: uniqueSpacing,
    baseUnit: bestBase,
    ratio: spacingRatio,
    scale,
    sectionPaddings,
  };

  // ------------------------------------------------------------------
  //  TYPOGRAPHY
  // ------------------------------------------------------------------
  const scaleEntries: TypeScaleEntry[] = raw.scaleEntries
    .map((e) => ({
      size: e.size,
      lineHeight: e.lineHeight,
      letterSpacing: e.letterSpacing,
      fontWeight: e.fontWeight,
      fontFamily: e.fontFamily,
      count: e.count,
      tags: e.tags,
    }))
    .sort((a, b) => a.size - b.size);

  // Detect base size (most-used font size)
  const baseSize =
    scaleEntries.length > 0
      ? scaleEntries.reduce((best, e) => (e.count > best.count ? e : best))
          .size
      : 16;

  // Detect type scale ratio (ratio between consecutive sizes)
  let scaleRatio: number | null = null;
  if (scaleEntries.length >= 3) {
    const sizes = [...new Set(scaleEntries.map((e) => e.size))].sort(
      (a, b) => a - b
    );
    const ratios: number[] = [];
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i - 1] > 0) {
        ratios.push(sizes[i] / sizes[i - 1]);
      }
    }
    if (ratios.length > 0) {
      const mean = ratios.reduce((s, r) => s + r, 0) / ratios.length;
      const variance =
        ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev / mean < 0.4) {
        scaleRatio = Math.round(mean * 100) / 100;
      }
    }
  }

  // Classify font roles
  const fonts: FontToken[] = raw.fontEntries.map((f) => {
    let role: FontToken['role'] = 'unknown';
    if (/mono|consolas|courier/i.test(f.family)) {
      role = 'mono';
    } else if (f.headingCount > 0 && f.bodyCount === 0) {
      role = 'heading';
    } else if (f.bodyCount > 0 && f.headingCount === 0) {
      role = 'body';
    } else if (f.headingCount > 0 && f.bodyCount > 0) {
      // Used in both -- assign based on dominance
      role = f.headingCount >= f.bodyCount ? 'heading' : 'body';
    } else if (f.totalCount === 1) {
      role = 'accent';
    }

    return {
      family: f.family,
      weights: f.weights.sort(),
      role,
    };
  });

  const typography: TypographyTokens = {
    fonts,
    scale: scaleEntries,
    baseSize,
    scaleRatio,
  };

  // ------------------------------------------------------------------
  //  BORDERS
  // ------------------------------------------------------------------
  const borders: BorderTokens = {
    radii: [...new Set(raw.radii)].sort((a, b) => a - b),
    widths: [...new Set(raw.widths)].sort((a, b) => a - b),
  };

  // ------------------------------------------------------------------
  //  EFFECTS
  // ------------------------------------------------------------------
  const effects: EffectTokens = {
    shadows: raw.shadows,
    blendModes: raw.blendModes,
    filters: raw.filters,
    backdropFilters: raw.backdropFilters,
  };

  return {
    colors,
    spacing,
    typography,
    borders,
    effects,
  };
}
