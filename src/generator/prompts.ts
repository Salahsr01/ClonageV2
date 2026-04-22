/**
 * Prompt templates for multi-pass AI regeneration.
 *
 * The key insight: NEVER describe the design — INJECT exact values.
 * "dark blue background" → generic. "#0a1628 background" → precise.
 * "smooth animation" → generic. "0.9s cubic-bezier(0.16, 1, 0.3, 1)" → precise.
 *
 * Each pass focuses on ONE concern to avoid quality dilution.
 */

import {
  DesignTokens,
  ExtractedAnimations,
  ExtractedComponent,
  ComponentType,
} from '../types.js';

// ── Anti-generic rules (injected into every prompt) ─────────────────────

const ANTI_GENERIC_RULES = `
FORBIDDEN PATTERNS (these make output look generic — violating ANY of these is a failure):
- Do NOT use "transition: all 0.3s ease" — specify exact properties + cubic-bezier
- Do NOT use "border-radius: 8px" — use 0px (sharp) or 16-24px+ (soft)
- Do NOT use "box-shadow: 0 2px 4px rgba(0,0,0,0.1)" — dramatic shadows or none
- Do NOT use "ease-in-out" or "ease" — always cubic-bezier with specific values
- Do NOT use padding: 40px 0 on sections — use vh units (12vh-20vh) for breathing room
- Do NOT use 12-column Bootstrap grids — CSS Grid with custom track sizes
- Do NOT center everything — left-align with intentional asymmetry
- Do NOT use transition durations < 0.3s — they feel cheap. Use 0.4-0.8s for hovers
- Do NOT use default letter-spacing on headings > 40px — tighten to -0.02em to -0.04em
- Do NOT make all sections the same padding — alternate tight (8vh) and spacious (16vh+)
`.trim();

// ── Pass 1: Semantic HTML structure ─────────────────────────────────────

export function buildStructurePrompt(
  brief: string,
  sections: string[],
  referenceComponents: ExtractedComponent[]
): string {
  const sectionList = sections.map((s, i) => `${i + 1}. <section data-section="${s}"> — ${s}`).join('\n');

  const refInfo = referenceComponents.length > 0
    ? `\nReference component types from the cloned site:\n${referenceComponents.map(c =>
        `- ${c.type}: ${c.childCount} children, ${c.meta.estimatedHeight} height, ${c.meta.hasImage ? 'has images' : 'no images'}, ${c.meta.hasVideo ? 'has video' : ''}`
      ).join('\n')}`
    : '';

  return `
You are generating the HTML STRUCTURE ONLY for a website. No CSS. No JavaScript. No styling classes.

BRIEF: ${brief}

SECTIONS (in order):
${sectionList}
${refInfo}

RULES:
- Use semantic HTML5: <section>, <nav>, <header>, <footer>, <article>, <figure>
- Each section gets: <section data-section="TYPE" data-anim="reveal">
- Add data-anim attributes for animation targets:
  - data-anim="reveal" — fade in on scroll
  - data-anim="parallax" — parallax effect
  - data-anim="stagger" — children animate in sequence
  - data-anim="split-text" — text reveals word by word
- Use realistic placeholder text (NOT lorem ipsum). Write text that fits the brief.
- Include <img> tags with descriptive alt text and data-placeholder="description" attributes
- Structure headings logically: one <h1> in hero, <h2> per section, <h3> for sub-items
- For repeating items (cards, features, testimonials), use 3-6 items with varied content lengths
- Wrap the entire page in a single <div id="smooth-wrapper"><div id="smooth-content">

OUTPUT: Complete HTML document with <!DOCTYPE html>, <head> (empty, will be filled later), and <body>.
Do NOT include any CSS or JavaScript. Structure only.
`.trim();
}

// ── Pass 2: Layout with exact tokens ────────────────────────────────────

export function buildLayoutPrompt(
  html: string,
  tokens: DesignTokens
): string {
  const spacingScale = tokens.spacing.scale.length > 0
    ? tokens.spacing.scale.map(v => `${v}px`).join(', ')
    : '4px, 8px, 16px, 24px, 32px, 48px, 64px, 96px, 128px';

  const sectionPaddings = tokens.spacing.sectionPaddings.length > 0
    ? tokens.spacing.sectionPaddings.map(v => `${v}px (~${Math.round(v / 10.8)}vh)`).join(', ')
    : '100px (~9vh), 160px (~15vh), 200px (~18vh)';

  return `
You are adding CSS LAYOUT to this HTML. Layout only — no colors, no fonts, no decorative properties.

HTML TO STYLE:
\`\`\`html
${html}
\`\`\`

EXACT SPACING SCALE (from the reference site):
${spacingScale}
Base unit: ${tokens.spacing.baseUnit}px

SECTION PADDINGS (vertical, from reference):
${sectionPaddings}

LAYOUT RULES:
- Use CSS Grid for section layouts, NOT flexbox for page-level structure
- Asymmetric column layouts: grid-template-columns: 2fr 1fr, or 1fr 0.8fr, or custom
- Container: max-width: clamp(1000px, 85vw, 1400px); margin: 0 auto; padding: 0 clamp(20px, 4vw, 80px)
- Section padding: use vh units from the section paddings above. VARY between sections.
- Gap values must come from the spacing scale
- Use CSS clamp() for responsive values
- Overlap elements intentionally with negative margins or transform: translate
- Leave generous whitespace — 30-40% of sections should be empty space

OUTPUT: A <style> tag with ONLY layout CSS (display, grid, flex, margin, padding, gap, width, max-width, position).
${ANTI_GENERIC_RULES}
`.trim();
}

// ── Pass 3: Typography + Colors ─────────────────────────────────────────

export function buildStylePrompt(
  html: string,
  layoutCss: string,
  tokens: DesignTokens
): string {
  const colorBlock = [
    ...tokens.colors.backgrounds.slice(0, 3).map(c => `Background: ${c.value} (${c.role || 'bg'})`),
    ...tokens.colors.texts.slice(0, 3).map(c => `Text: ${c.value} (${c.role || 'text'})`),
    ...tokens.colors.accents.slice(0, 2).map(c => `Accent: ${c.value} (${c.role || 'accent'})`),
  ].join('\n');

  const gradients = tokens.colors.gradients.length > 0
    ? `\nGradients from reference:\n${tokens.colors.gradients.slice(0, 3).join('\n')}`
    : '';

  const fontBlock = tokens.typography.fonts.map(f =>
    `${f.role}: "${f.family}" — weights: ${f.weights.join(', ')}`
  ).join('\n');

  const typeScale = tokens.typography.scale
    .sort((a, b) => b.size - a.size)
    .slice(0, 8)
    .map(t =>
      `${t.size}px (${t.tags.join('/')}) — weight ${t.fontWeight}, line-height ${t.lineHeight.toFixed(2)}, letter-spacing ${t.letterSpacing}`
    ).join('\n');

  const effects = [
    ...tokens.effects.blendModes.map(m => `mix-blend-mode: ${m}`),
    ...tokens.effects.shadows.slice(0, 3).map(s => `box-shadow: ${s}`),
    ...tokens.effects.filters.slice(0, 2).map(f => `filter: ${f}`),
  ].join('\n');

  return `
You are adding TYPOGRAPHY and COLOR to this page. Do NOT modify layout properties.

CURRENT HTML + LAYOUT CSS:
\`\`\`html
${html}
\`\`\`
\`\`\`css
${layoutCss}
\`\`\`

EXACT COLOR PALETTE (from reference — use ONLY these):
${colorBlock}
${gradients}

EXACT TYPOGRAPHY (from reference):
Fonts: ${fontBlock}
Scale ratio: ${tokens.typography.scaleRatio || 'custom'}

Type scale (use these EXACT sizes):
${typeScale}

VISUAL EFFECTS (from reference):
${effects || 'None extracted — keep it clean'}

Border radii used: ${tokens.borders.radii.join('px, ')}px

TYPOGRAPHY RULES:
- Use the EXACT font sizes from the scale — do not invent new sizes
- Headings > 40px MUST have negative letter-spacing (-0.02em to -0.04em)
- Body text line-height: 1.5-1.7
- Use font-display: swap on @font-face
- Add -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;

COLOR RULES:
- Background and text colors must come from the palette above
- Accent color used sparingly — only on CTAs, key words, or interactive elements
- If the reference uses blend modes, include them
- Use opacity layers for depth (multiple elements with opacity 0.05-0.15)

OUTPUT: Additional CSS rules for typography and color. Do NOT repeat layout rules.
${ANTI_GENERIC_RULES}
`.trim();
}

// ── Pass 4: Animations ──────────────────────────────────────────────────

export function buildAnimationPrompt(
  html: string,
  css: string,
  animations: ExtractedAnimations
): string {
  // Build animation reference from extracted data
  const gsapInfo = animations.gsap
    ? buildGsapReference(animations.gsap)
    : 'No GSAP detected. Use standard GSAP ScrollTrigger patterns.';

  const transitionInfo = animations.transitions.length > 0
    ? animations.transitions.slice(0, 10).map(t =>
        `${t.selector}: ${t.properties.join(', ')} — ${t.durations.join(', ')} — ${t.easings.join(', ')}`
      ).join('\n')
    : 'No transitions extracted. Create custom hover transitions.';

  const scrollPatternsInfo = animations.scrollPatterns.length > 0
    ? animations.scrollPatterns.map(sp =>
        `${sp.type}: ${sp.description} (${sp.selector})`
      ).join('\n')
    : '';

  return `
You are adding ANIMATIONS and INTERACTIONS to this page using GSAP + ScrollTrigger.

CURRENT PAGE:
\`\`\`html
${html}
\`\`\`
\`\`\`css
${css}
\`\`\`

ANIMATION PATTERNS FROM REFERENCE:
${gsapInfo}

HOVER TRANSITIONS FROM REFERENCE:
${transitionInfo}

SCROLL PATTERNS FROM REFERENCE:
${scrollPatternsInfo || 'Implement: reveal on scroll, parallax backgrounds, text split reveals'}

REQUIRED ANIMATIONS:
1. **Scroll reveals**: Elements with data-anim="reveal" fade in + translateY(40px→0) on scroll
   - Duration: 0.8-1.0s
   - Ease: cubic-bezier(0.16, 1, 0.3, 1) (expo.out)
   - Stagger: 0.1s for sibling items

2. **Text split**: Elements with data-anim="split-text" reveal word-by-word
   - Split text into <span> wrappers with overflow:hidden
   - Each word: translateY(100%)→0
   - Duration: 0.8s, stagger: 0.06s

3. **Parallax**: Elements with data-anim="parallax"
   - Subtle: translateY shifts at 0.1-0.3 scroll speed ratio
   - Use scrub: true

4. **Hover states**: All links, buttons, cards
   - Use specific properties (not "all")
   - Duration 0.4-0.6s
   - Custom cubic-bezier easing

5. **Page load entrance**: Hero section has a choreographed entrance
   - Nav: fade in (0.3s delay)
   - Heading: split text reveal (0.5s delay)
   - Subtext: fade up (after heading completes)
   - CTA: scale from 0.95 (last)

SCRIPT SETUP:
- Load GSAP + ScrollTrigger from CDN
- Register ScrollTrigger plugin
- Use gsap.registerPlugin(ScrollTrigger)
- If Lenis detected, initialize smooth scroll

OUTPUT: Complete <script> tag with all animation code. Include GSAP CDN links in <head>.
${ANTI_GENERIC_RULES}
`.trim();
}

// ── Pass 5: Polish ──────────────────────────────────────────────────────

export function buildPolishPrompt(
  html: string,
  css: string,
  js: string,
  brief: string
): string {
  return `
You are doing a FINAL POLISH pass on this page. Fix issues, add responsive, add details.

BRIEF: ${brief}

CURRENT PAGE (complete):
\`\`\`html
${html}
\`\`\`
\`\`\`css
${css}
\`\`\`
\`\`\`javascript
${js}
\`\`\`

POLISH CHECKLIST:
1. **Responsive** — Add @media queries:
   - Mobile (<768px): stack grids, reduce font sizes by 30-40%, reduce section padding to 8vh
   - Tablet (768-1024px): 2-column grids become 1, headings scale down 20%
   - Use clamp() where possible instead of media queries

2. **Performance hints**:
   - Add will-change: transform on animated elements
   - Add loading="lazy" on images below the fold
   - Add fetchpriority="high" on hero image

3. **Accessibility**:
   - Add @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }
   - Ensure color contrast meets WCAG AA
   - Add aria-label on icon buttons
   - Ensure focus-visible styles on interactive elements

4. **Typography polish**:
   - -webkit-font-smoothing: antialiased on body
   - text-rendering: optimizeLegibility on headings
   - ::selection with brand accent color

5. **Custom cursor** (if the reference site had one):
   - Create a cursor-following dot with lerped position
   - Scale up on hover over interactive elements

6. **Image placeholders**:
   - Replace data-placeholder images with https://images.unsplash.com/photo-... URLs
   - Choose images that match the brief (architecture, tech, nature, etc.)
   - Use ?w=800&q=80 for reasonable quality

OUTPUT: The COMPLETE final HTML file — all CSS in <style>, all JS in <script>, fully self-contained.
Return ONLY the HTML code, no markdown, no explanations.
`.trim();
}

// ── Visual comparison prompt ────────────────────────────────────────────

export function buildVisualComparisonPrompt(): string {
  return `
Compare these two website screenshots. The FIRST is the AI-generated site. The SECOND is the reference (original).

Evaluate on these criteria (score 0-100 each):
1. **Layout fidelity** — Same section structure, similar proportions?
2. **Typography quality** — Font sizes, weights, spacing feel premium?
3. **Color accuracy** — Same palette, same mood?
4. **Spacing/rhythm** — Whitespace feels intentional, not cramped?
5. **Animation presence** — (can't see in screenshot, but check for GSAP elements)
6. **Overall Awwwards-level** — Would this win an award?

OVERALL SCORE: Average of all criteria (0-100).

If score < 85, list the TOP 3 specific issues to fix, with CSS/HTML code suggestions.

Respond as JSON:
{
  "scores": { "layout": N, "typography": N, "color": N, "spacing": N, "overall": N },
  "totalScore": N,
  "issues": [
    { "description": "...", "fix": "CSS or HTML change to make" }
  ]
}
`.trim();
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildGsapReference(gsap: NonNullable<ExtractedAnimations['gsap']>): string {
  const lines: string[] = [];

  // Timeline summary
  const tweenCount = countTweens(gsap.timeline);
  lines.push(`GSAP Timeline: ${tweenCount} tweens detected`);

  // Show first few tweens as examples
  const examples = flattenTweens(gsap.timeline).slice(0, 5);
  if (examples.length > 0) {
    lines.push('\nExample tweens from reference:');
    for (const t of examples) {
      lines.push(`  gsap.to("${t.targets?.[0] || '*'}", {`);
      lines.push(`    duration: ${t.duration},`);
      if (t.ease) lines.push(`    ease: "${t.ease}",`);
      if (t.properties) {
        for (const prop of t.properties.slice(0, 3)) {
          lines.push(`    ${prop}: ...,`);
        }
      }
      lines.push(`  })`);
    }
  }

  // ScrollTrigger summary
  if (gsap.scrollTriggers.length > 0) {
    lines.push(`\nScrollTrigger: ${gsap.scrollTriggers.length} triggers`);
    for (const st of gsap.scrollTriggers.slice(0, 5)) {
      lines.push(`  trigger: "${st.trigger}", start: "${st.start}", end: "${st.end}", scrub: ${st.scrub}, pin: ${st.pin}`);
    }
  }

  return lines.join('\n');
}

// ── REPRODUCTION PROMPT — faithfully reproduce the original site ─────

/**
 * Build a single-pass reproduction prompt.
 * Unlike regeneration (multi-pass, new content), reproduction takes the REAL HTML
 * from extracted components and asks the AI to produce a clean standalone version.
 */
export function buildReproductionPrompt(
  components: ExtractedComponent[],
  tokens: DesignTokens,
  animations: ExtractedAnimations,
  sectionTypes: string[]
): string {
  // Filter and order components by requested sections
  const ordered = selectComponents(components, sectionTypes);

  // Build the color palette reference
  const colorRef = [
    ...tokens.colors.backgrounds.slice(0, 3).map(c => `  bg: ${c.value}`),
    ...tokens.colors.texts.slice(0, 3).map(c => `  text: ${c.value}`),
    ...tokens.colors.accents.slice(0, 3).map(c => `  accent: ${c.value}`),
  ].join('\n');

  // Build the typography reference
  const fontRef = tokens.typography.fonts.map(f =>
    `  ${f.role}: "${f.family}" — weights: ${f.weights.join(', ')}`
  ).join('\n');

  const typeScaleRef = tokens.typography.scale
    .sort((a, b) => b.size - a.size)
    .slice(0, 10)
    .map(t => `  ${t.size}px — weight ${t.fontWeight}, lh ${t.lineHeight.toFixed(2)}, ls ${t.letterSpacing} [${t.tags.join(',')}]`)
    .join('\n');

  // Build spacing reference
  const spacingRef = `  Base unit: ${tokens.spacing.baseUnit}px\n  Scale: ${tokens.spacing.scale.join(', ')}px\n  Section paddings: ${tokens.spacing.sectionPaddings.filter(v => v < 500).map(v => v + 'px').join(', ')}`;

  // Build transitions reference
  const transRef = animations.transitions
    .slice(0, 15)
    .map(t => `  ${t.properties.join(',')} ${t.durations[0]} ${t.easings[0]}`)
    .join('\n');

  // Build component HTML blocks
  const componentBlocks = ordered.map((comp, i) => {
    // Truncate very long HTML to stay within context limits
    const html = comp.html.length > 6000 ? comp.html.substring(0, 6000) + '\n<!-- ... truncated -->' : comp.html;
    return `
--- SECTION ${i + 1}: ${comp.type.toUpperCase()} ---
Text content: ${comp.textPreview}
Height: ${comp.meta.estimatedHeight} | Has images: ${comp.meta.hasImage} | Has video: ${comp.meta.hasVideo} | Animated: ${comp.meta.hasAnimation}

Original HTML:
\`\`\`html
${html}
\`\`\``;
  }).join('\n\n');

  return `
You are reproducing an existing website as a clean, standalone HTML file. Your goal is PIXEL-PERFECT visual reproduction using clean, readable code.

This is NOT a new design. You are COPYING an existing site. The output must look IDENTICAL to the original.

=== DESIGN TOKENS (extracted from the original site — use EXACTLY) ===

COLORS:
${colorRef}

TYPOGRAPHY:
${fontRef}
Type scale:
${typeScaleRef}

SPACING:
${spacingRef}

BORDER RADII: ${tokens.borders.radii.join('px, ')}px

CSS TRANSITIONS (extracted from original):
${transRef}

EFFECTS:
  Shadows: ${tokens.effects.shadows.slice(0, 3).join(' | ') || 'none'}
  Blend modes: ${tokens.effects.blendModes.join(', ') || 'none'}

=== ORIGINAL SECTIONS TO REPRODUCE ===
${componentBlocks}

=== INSTRUCTIONS ===

1. Produce a SINGLE self-contained HTML file with all CSS in <style> and all JS in <script>
2. The visual result must be IDENTICAL to the original sections above
3. Clean up the HTML:
   - Remove CSS module hashes (e.g. "Button-module-scss-module__n0x4Aa__button" → "button")
   - Remove framework-specific attributes (data-radix, data-state, etc.)
   - Keep semantic structure (sections, headings, lists)
   - Keep all text content EXACTLY as in the original
4. Write clean CSS:
   - Use the EXACT color values from the tokens above
   - Use the EXACT font sizes, weights, letter-spacing from the type scale
   - Use the EXACT spacing values from the scale
   - Use the EXACT transition timings from the original
   - Use CSS custom properties for repeated values
5. Add GSAP ScrollTrigger animations:
   - Load GSAP + ScrollTrigger from CDN
   - Scroll reveal: elements fade in + translateY(40px→0) on scroll entry
   - Easing: cubic-bezier(0.16, 1, 0.3, 1) — NOT ease or ease-in-out
   - Stagger child elements with 0.08-0.12s delay
   - Hero entrance: nav fades in, then heading reveals, then subtext
6. For images: use placeholder with correct aspect ratios and alt text
7. For videos: include <video> tag with autoplay muted loop playsinline
8. Use Google Fonts as fallback since original fonts are proprietary:
   - Replace "jobyText" → 'Inter', sans-serif
   - Replace "jobyDisplay" → 'Playfair Display', serif
   Include the Google Fonts <link> in <head>

${ANTI_GENERIC_RULES}

OUTPUT: Complete standalone HTML file. NO markdown, NO explanations. Just the HTML code.
`.trim();
}

/**
 * Build a reproduction prompt for a single section (for chunked processing).
 */
export function buildSectionReproductionPrompt(
  component: ExtractedComponent,
  tokens: DesignTokens,
  animations: ExtractedAnimations,
  sectionIndex: number,
  totalSections: number
): string {
  const colorRef = [
    ...tokens.colors.backgrounds.slice(0, 3).map(c => `bg: ${c.value}`),
    ...tokens.colors.texts.slice(0, 3).map(c => `text: ${c.value}`),
    ...tokens.colors.accents.slice(0, 3).map(c => `accent: ${c.value}`),
  ].join(', ');

  const transRef = animations.transitions
    .slice(0, 5)
    .map(t => `${t.properties[0]} ${t.durations[0]} ${t.easings[0]}`)
    .join(' | ');

  // Truncate aggressively for serverless API limits (Qwen on HF free tier timeouts on large prompts)
  const maxHtml = 3000;
  const html = component.html.length > maxHtml ? component.html.substring(0, maxHtml) + '\n<!-- truncated -->' : component.html;

  return `
Reproduce this website section as clean, standalone HTML + CSS. Section ${sectionIndex + 1} of ${totalSections}.

SECTION TYPE: ${component.type.toUpperCase()}
TEXT: ${component.textPreview}
SIZE: ${component.meta.estimatedHeight} height, ${component.childCount} children

DESIGN TOKENS: Colors: ${colorRef} | Radii: ${tokens.borders.radii.join(', ')}px | Transitions: ${transRef}
FONTS: Use 'Inter' for body, 'Playfair Display' for display headings.

ORIGINAL HTML:
\`\`\`html
${html}
\`\`\`

RULES:
- Reproduce the EXACT text, structure, and visual layout
- Clean up CSS module class names to readable names
- Use EXACT colors/spacing from tokens
- Transitions: cubic-bezier(0.33, 1, 0.68, 1) — NO ease-in-out
- For images: <img> with correct alt text and aspect ratio placeholder
- Output ONLY the <section> block (HTML + scoped CSS), no full page wrapper

OUTPUT: HTML section + <style> block. No markdown, no explanations.
`.trim();
}

/**
 * Select and order components matching requested section types.
 * Picks the best (largest HTML) component for each type.
 */
function selectComponents(components: ExtractedComponent[], sectionTypes: string[]): ExtractedComponent[] {
  const result: ExtractedComponent[] = [];

  for (const type of sectionTypes) {
    // Find all components of this type
    const matches = components.filter(c => c.type === type);
    if (matches.length === 0) continue;

    // Pick the one with the most HTML content (most complete)
    matches.sort((a, b) => b.html.length - a.html.length);
    result.push(matches[0]);
  }

  return result;
}

function countTweens(entries: import('../types.js').GsapTimelineEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.type === 'tween') count++;
    if (e.children) count += countTweens(e.children);
  }
  return count;
}

function flattenTweens(entries: import('../types.js').GsapTimelineEntry[]): import('../types.js').GsapTimelineEntry[] {
  const tweens: import('../types.js').GsapTimelineEntry[] = [];
  for (const e of entries) {
    if (e.type === 'tween') tweens.push(e);
    if (e.children) tweens.push(...flattenTweens(e.children));
  }
  return tweens;
}
