import type { Cheerio } from 'cheerio';

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
  el: Cheerio<any>;
  depth: number;
  textLength: number;
  childCount: number;
  tag: string;
  classList: string[];
}

export interface ExtractedSection {
  role: SectionRole;
  file: string;
  size_bytes: number;
  has_animation: boolean;
  dominant_classes: string[];
  text_excerpt: string;
  tags: string[];
}

export interface KBv2Index {
  site: string;
  source_clone: string;
  extracted_at: string;
  palette: { primary?: string; secondary?: string; accent?: string };
  fonts: {
    primary?: { family: string; google: boolean };
    display?: { family: string; google: boolean };
  };
  sections: ExtractedSection[];
}

export interface DeepExtractOptions {
  cloneDir: string;
  sectionsTarget?: number;
  force?: boolean;
  kbRoot?: string;
}

export interface DeepExtractResult {
  site: string;
  kbDir: string;
  index: KBv2Index;
}
