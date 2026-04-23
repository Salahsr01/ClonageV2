import { z } from 'zod';

// Canonical narrative roles used by Planning (§4.4). Open list — VLMs can
// introduce new roles; we keep them but flag non-canonical via `usable_as`.
export const CANONICAL_ROLES = [
  'navbar',
  'hero',
  'about',
  'works',
  'services',
  'cta',
  'contact',
  'footer',
  'testimonials',
  'pricing',
  'features',
  'gallery',
  'stats',
  'team',
  'faq',
  'logo-wall',
  'other',
] as const;

export const AnimationType = z.enum([
  'scroll-pin',
  'stagger',
  'magnetic',
  'split-text',
  'parallax',
  'fade-in',
  'marquee',
  'hover-reveal',
  'video-bg',
  'none',
  'other',
]);

export const AnimationLibrary = z.enum([
  'gsap',
  'framer',
  'lenis',
  'anime',
  'motion-one',
  'css',
  'none',
  'other',
]);

export const AnimationSchema = z.object({
  type: AnimationType,
  library: AnimationLibrary,
});

export const TypoSchema = z.object({
  display: z.string(),
  body: z.string(),
  axes: z.array(z.string()).default([]),
});

export const LayoutSchema = z.object({
  composition: z.enum([
    'fullscreen',
    'split',
    'masonry',
    'centered',
    'asymmetric',
    'stacked',
    'grid',
    'hero-copy',
    'other',
  ]),
  density: z.enum(['tight', 'airy', 'spacious']),
});

// The core ground fiche produced by the grounding agent per section.
export const GroundFicheSchema = z.object({
  role: z.string(), // from CANONICAL_ROLES when possible but we accept any string
  mood: z.array(z.string()).min(1).max(8),
  animations: z.array(AnimationSchema),
  palette_dominant: z.array(z.string()).min(1).max(8),
  typo: TypoSchema,
  layout: LayoutSchema,
  signature: z.string().min(10).max(280),
  usable_as: z.array(z.string()),
});

export type GroundFiche = z.infer<typeof GroundFicheSchema>;
export type Animation = z.infer<typeof AnimationSchema>;
export type Layout = z.infer<typeof LayoutSchema>;

// Metadata prepended to the fiche on disk. Not sent to the LLM.
export const GroundSidecarSchema = z.object({
  site: z.string(),
  role: z.string(),
  source_hash: z.string(),
  grounded_at: z.string(),
  fiche: GroundFicheSchema,
});

export type GroundSidecar = z.infer<typeof GroundSidecarSchema>;
