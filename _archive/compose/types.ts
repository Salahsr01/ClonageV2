import type { KBv2Index, ExtractedSection } from '../deep-extract/types.js';
import type { ValidationReport } from './validate.js';

export interface ComposeBrief {
  brandName: string;
  industry: string;
  tagline?: string;
  description?: string;
  services?: string[];
  email?: string;
  projects?: Array<{ name: string; category?: string; description?: string }>;
}

export interface ComposeOptions {
  baseSite: string;
  brief: ComposeBrief;
  sector?: string;
  outputDir: string;
  kbRoot?: string;
  llm?: LLMCall;
  launchServer?: boolean;
  /** Max retries when validation rejects a rewrite. Default 3. */
  maxRetries?: number;
  /** Disable the LLM selection phase and use the deterministic fallback. Default false. */
  skipSelect?: boolean;
  /** Target number of sections after selection. Default = all available. */
  targetSectionCount?: number;
}

export type LLMCall = (args: {
  prompt: string;
  maxTokens?: number;
  tag?: string;
}) => Promise<string>;

export interface LoadedSection {
  meta: ExtractedSection;
  html: string;
  path: string;
}

export interface LoadedKB {
  index: KBv2Index;
  kbDir: string;
  sections: LoadedSection[];
}

export type RewriteOutcome = 'llm' | 'fallback-rebrand' | 'unchanged';

export interface RewrittenSection {
  role: string;
  site: string;
  originalSize: number;
  rewrittenSize: number;
  outcome: RewriteOutcome;
  attempts: number;
  bodyHtml: string;
  validation: ValidationReport | null;
  llmErrors: string[];
}

export interface ComposeResult {
  site: string;
  outputDir: string;
  indexPath: string;
  sections: RewrittenSection[];
  manifestPath: string;
}

export interface ComposeManifest {
  base_site: string;
  brand_name: string;
  industry: string;
  sector?: string;
  composed_at: string;
  sections: Array<{
    role: string;
    site: string;
    outcome: RewriteOutcome;
    attempts: number;
    original_size: number;
    rewritten_size: number;
    validation: { ok: boolean; errors: string[] } | null;
    llm_errors: string[];
  }>;
}
