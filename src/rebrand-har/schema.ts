import { z } from 'zod';

/**
 * Schema for the HAR-rebrand brief. Minimal — the only thing a rebrand-har
 * operation does is string substitution over text responses in the HAR.
 *
 * `brand.source_name → brand.name` expands into case variations (UPPER / lower /
 * Original / with © suffix) so the caller can just say "NAUGHTYDUK → LUMEN STUDIO".
 *
 * `copy` entries are raw from/to pairs — color hex codes count, rgb strings
 * count, snippet text counts. Keep substring-safe (don't match "and" inside "band").
 */
export const RebrandHarBriefSchema = z.object({
  brand: z
    .object({
      source_name: z.string().min(1),
      name: z.string().min(1),
    })
    .optional(),
  copy: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string(),
      }),
    )
    .default([]),
});

export type RebrandHarBrief = z.infer<typeof RebrandHarBriefSchema>;
