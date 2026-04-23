import { z } from 'zod';

/**
 * Canonical roles for Planning. The narrative of a full site is a slice of
 * this set — not every site has services or testimonials.
 */
export const CANONICAL_PLAN_ROLES = [
  'navbar',
  'hero',
  'about',
  'works',
  'services',
  'features',
  'testimonials',
  'pricing',
  'cta',
  'contact',
  'footer',
] as const;

export const PlanSectionSchema = z.object({
  role: z.string(),
  /** Stable id into the atlas: `${site}#${role}`. */
  source: z.string().regex(/^[^#]+#[^#]+$/, 'source must match site#role'),
  reason: z.string().min(10).max(600),
});

export const DesignConstraintsSchema = z.object({
  /** Site id (matches atlas.site) whose palette we lift. */
  palette_reference: z.string(),
  /** Site id whose typography we lift. */
  typo_reference: z.string(),
  /** Site id whose vertical rhythm/spacing we lift. */
  rhythm_reference: z.string(),
});

export const PlanSchema = z.object({
  brand: z.string(),
  sections: z.array(PlanSectionSchema).min(3).max(12),
  design_constraints: DesignConstraintsSchema,
  coherence_notes: z.string().min(30).max(1500),
});

export type PlanSection = z.infer<typeof PlanSectionSchema>;
export type DesignConstraints = z.infer<typeof DesignConstraintsSchema>;
export type Plan = z.infer<typeof PlanSchema>;
