import type { KBv2Index, ExtractedSection } from '../deep-extract/types.js';

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
  llm?: LLMFunction;
  launchServer?: boolean;
}

export type LLMFunction = (prompt: string, section: LoadedSection) => Promise<string>;

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

export interface RewrittenSection {
  role: string;
  originalSize: number;
  rewrittenSize: number;
  usedLLM: boolean;
  bodyHtml: string;
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
  sections: Array<{ role: string; used_llm: boolean; original_size: number; rewritten_size: number }>;
}
