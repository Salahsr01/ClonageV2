/**
 * Anti-generic validator — flags code patterns that make AI output look generic.
 *
 * The core insight: what makes Awwwards sites look different from generic ones
 * is NOT different concepts, but PRECISE values. The exact -0.03em letter-spacing,
 * the exact cubic-bezier(0.16, 1, 0.3, 1), the exact padding: 15vh 0.
 *
 * This validator catches the "safe defaults" that LLMs fall back to.
 */

import { DesignTokens, ValidationReport, ValidationViolation } from '../types.js';

// ── Generic patterns that betray AI-generated code ──────────────────────

interface GenericPattern {
  pattern: RegExp;
  type: ValidationViolation['type'];
  message: string;
  suggestion: string;
}

const GENERIC_PATTERNS: GenericPattern[] = [
  // Easing
  {
    pattern: /transition:[^;]*\sease[^-;]/g,
    type: 'generic-easing',
    message: 'Generic "ease" timing function detected',
    suggestion: 'Use a specific cubic-bezier. Premium curves: cubic-bezier(0.16, 1, 0.3, 1) for expo.out, cubic-bezier(0.83, 0, 0.17, 1) for expo.inOut',
  },
  {
    pattern: /ease-in-out/g,
    type: 'generic-easing',
    message: 'Generic "ease-in-out" detected',
    suggestion: 'Use cubic-bezier(0.22, 1, 0.36, 1) for quint.out or cubic-bezier(0.33, 1, 0.68, 1) for smooth decel',
  },
  {
    pattern: /transition:\s*all\s/g,
    type: 'generic-pattern',
    message: 'transition: all detected — transitions specific properties instead',
    suggestion: 'Specify exact properties: transition: transform 0.6s cubic-bezier(...), opacity 0.4s cubic-bezier(...)',
  },
  // Border radius
  {
    pattern: /border-radius:\s*8px/g,
    type: 'generic-pattern',
    message: 'Generic border-radius: 8px detected',
    suggestion: 'Use 0 for sharp edges or 16-24px+ for soft. Awwwards sites rarely use 8px.',
  },
  // Shadows
  {
    pattern: /box-shadow:[^;]*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.1\s*\)/g,
    type: 'generic-pattern',
    message: 'Generic shadow with rgba(0,0,0,0.1) detected',
    suggestion: 'Use dramatic shadows (0.25+ opacity, large blur) or no shadow at all. Subtle shadows look cheap.',
  },
  // Spacing
  {
    pattern: /padding:\s*\d{2}px\s+(0|0px)\s*[;}\n]/g,
    type: 'off-scale',
    message: 'Fixed px padding on section. Use viewport units for breathing room.',
    suggestion: 'Replace with padding: 12vh 0 or padding: clamp(60px, 12vh, 160px) 0',
  },
  // Layout
  {
    pattern: /class="[^"]*col-(?:xs|sm|md|lg)-\d/g,
    type: 'generic-pattern',
    message: 'Bootstrap grid classes detected',
    suggestion: 'Use CSS Grid with custom track sizes: grid-template-columns: 2fr 1fr or asymmetric layouts',
  },
  // Generic font sizes
  {
    pattern: /font-size:\s*(?:14|16)px\s*;/g,
    type: 'generic-pattern',
    message: 'Default font size (14/16px) used without context',
    suggestion: 'Use the extracted type scale. Body text should use rem or clamp() for responsive sizing.',
  },
  // Text centering abuse
  {
    pattern: /text-align:\s*center[^;]*;[^}]*max-width:\s*(?:800|900|1000|1200)px/gs,
    type: 'generic-pattern',
    message: 'Centered text in wide container — classic generic pattern',
    suggestion: 'Use left-alignment with intentional asymmetry. Max-width 480-600px for text blocks.',
  },
  // Duration too short (snappy = cheap)
  {
    pattern: /transition[^;]*0\.(?:1|15|2)s/g,
    type: 'generic-pattern',
    message: 'Transition duration too short (< 0.3s feels cheap)',
    suggestion: 'Use 0.3-0.5s for hovers, 0.6-1.0s for reveals, 0.8-1.2s for page transitions',
  },
];

// ── Validation engine ──────────────────────────────────────────────────

export function validateGenerated(code: string, tokens?: DesignTokens): ValidationReport {
  const violations: ValidationViolation[] = [];

  // Check generic patterns
  for (const gp of GENERIC_PATTERNS) {
    const regex = new RegExp(gp.pattern.source, gp.pattern.flags);
    let match;
    while ((match = regex.exec(code)) !== null) {
      // Find line number
      const lineNumber = code.substring(0, match.index).split('\n').length;
      violations.push({
        type: gp.type,
        message: gp.message,
        line: lineNumber,
        suggestion: gp.suggestion,
      });
    }
  }

  // Check colors against palette (if tokens provided)
  if (tokens?.colors?.palette && tokens.colors.palette.length > 0) {
    const paletteHexes = new Set(tokens.colors.palette.map(c => c.value.toLowerCase()));
    const usedColors = extractColorsFromCode(code);
    for (const color of usedColors) {
      if (!paletteHexes.has(color.toLowerCase()) && !isNeutral(color)) {
        violations.push({
          type: 'off-palette',
          message: `Color ${color} not in extracted design tokens`,
          suggestion: `Use one of: ${tokens.colors.palette.slice(0, 5).map(c => c.value).join(', ')}`,
        });
      }
    }
  }

  // Check for missing GSAP/animation imports
  const hasGsap = code.includes('gsap') || code.includes('ScrollTrigger');
  const hasAnyAnimation = code.includes('transition') || code.includes('animation') || code.includes('@keyframes');
  if (!hasGsap && !hasAnyAnimation) {
    violations.push({
      type: 'missing-animation',
      message: 'No animations detected in generated code',
      suggestion: 'Add GSAP ScrollTrigger for scroll reveals, custom hover transitions, and text split animations',
    });
  }

  // Check for cubic-bezier usage (premium sites always use custom easing)
  const hasCubicBezier = code.includes('cubic-bezier');
  if (hasAnyAnimation && !hasCubicBezier) {
    violations.push({
      type: 'generic-easing',
      message: 'Animations present but no custom cubic-bezier easing found',
      suggestion: 'Add cubic-bezier curves: expo.out = cubic-bezier(0.16, 1, 0.3, 1)',
    });
  }

  // Check letter-spacing on large headings
  const hasLargeHeading = /font-size:\s*(?:4[0-9]|[5-9][0-9]|[1-9]\d{2})px/g.test(code)
    || /font-size:\s*(?:3|4|5|6|7|8)\s*rem/g.test(code);
  const hasLetterSpacing = /letter-spacing:\s*-0\.0[1-5]em/g.test(code);
  if (hasLargeHeading && !hasLetterSpacing) {
    violations.push({
      type: 'generic-pattern',
      message: 'Large heading without negative letter-spacing',
      suggestion: 'Add letter-spacing: -0.03em on headings > 40px for a tighter, premium feel',
    });
  }

  // Score: start at 100, deduct per violation (capped at 0)
  const score = Math.max(0, 100 - violations.length * 8);

  return {
    violations,
    passed: violations.length === 0,
    score,
  };
}

// ── Format violations as readable report ────────────────────────────────

export function formatValidationReport(report: ValidationReport): string {
  if (report.passed) {
    return `✅ Validation passed (score: ${report.score}/100) — no generic patterns detected.`;
  }

  const lines = [
    `⚠️  Validation: ${report.violations.length} issues found (score: ${report.score}/100)`,
    '',
  ];

  const grouped = new Map<string, ValidationViolation[]>();
  for (const v of report.violations) {
    if (!grouped.has(v.type)) grouped.set(v.type, []);
    grouped.get(v.type)!.push(v);
  }

  for (const [type, violations] of grouped) {
    lines.push(`── ${type} (${violations.length}) ──`);
    for (const v of violations) {
      lines.push(`  ${v.line ? `L${v.line}: ` : ''}${v.message}`);
      if (v.suggestion) {
        lines.push(`    → ${v.suggestion}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Extract hex colors from CSS/HTML code */
function extractColorsFromCode(code: string): string[] {
  const hexPattern = /#([0-9a-fA-F]{3,8})\b/g;
  const colors = new Set<string>();
  let match;
  while ((match = hexPattern.exec(code)) !== null) {
    const hex = match[0].toLowerCase();
    // Normalize 3-char hex to 6-char
    if (hex.length === 4) {
      colors.add(`#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`);
    } else {
      colors.add(hex);
    }
  }
  return Array.from(colors);
}

/** Check if a color is a neutral gray (don't flag these as off-palette) */
function isNeutral(hex: string): boolean {
  if (hex.length !== 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // If R, G, B are within 15 of each other, it's a gray
  const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  return maxDiff < 15;
}
