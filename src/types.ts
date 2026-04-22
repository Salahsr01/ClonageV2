export interface CloneConfig {
  url: string;
  outputDir: string;
  viewports: Viewport[];
  maxPages: number;
  timeout: number;
  waitForNetworkIdle: boolean;
  includeScripts: boolean;
  includeAnimations: boolean;
}

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface CrawlResult {
  pages: PageData[];
  siteMetadata: SiteMetadata;
}

export interface PageData {
  url: string;
  path: string;
  html: string;
  title: string;
  meta: Record<string, string>;
  links: string[];
  scripts: ScriptData[];
  stylesheets: StylesheetData[];
  assets: AssetData[];
  fonts: FontData[];
  screenshot?: Buffer;
}

export interface SiteMetadata {
  baseUrl: string;
  domain: string;
  pages: string[];
  techStack: string[];
  totalAssets: number;
}

export interface ScriptData {
  url?: string;
  content?: string;
  isExternal: boolean;
}

export interface StylesheetData {
  url?: string;
  content: string;
  isExternal: boolean;
}

export interface AssetData {
  url: string;
  localPath: string;
  type: AssetType;
  mimeType: string;
  content?: Buffer;
}

export type AssetType = 'image' | 'font' | 'video' | 'svg' | 'other';

export interface FontData {
  family: string;
  url?: string;
  weight?: string;
  style?: string;
  format?: string;
  content?: Buffer;
}

export interface ExtractedData {
  pages: ExtractedPage[];
  globalStyles: string;
  fonts: FontData[];
  assets: AssetData[];
  siteMetadata: SiteMetadata;
}

export interface ExtractedPage {
  url: string;
  path: string;
  title: string;
  meta: Record<string, string>;
  cleanHtml: string;
  styles: string;
  inlineStyles: Map<string, string> | Record<string, string>;
  animations: AnimationData[];
  screenshot?: Buffer;
}

export interface AnimationData {
  selector: string;
  type: 'css-transition' | 'css-animation' | 'scroll-triggered' | 'hover' | 'js-animation';
  properties: Record<string, string>;
  keyframes?: string;
}

export interface ReconstructedSite {
  pages: ReconstructedPage[];
  globalCss: string;
  assets: AssetData[];
  fonts: FontData[];
  siteMetadata: SiteMetadata;
}

export interface ReconstructedPage {
  path: string;
  filename: string;
  html: string;
  title: string;
}

// === v3.0: Clone Vivant types ===

export interface RecordConfig {
  url: string;
  outputDir: string;
  viewport: Viewport;
  timeout: number;
  maxPages: number;
  headless: boolean; // false to manually bypass anti-bot
}

export interface ReplayConfig {
  recordingDir: string;
  notFound: 'fallback' | 'abort'; // fallback = go to network, abort = offline
}

export interface RecordingMetadata {
  url: string;
  domain: string;
  recordedAt: string;
  techStack: string[];
  pageCount: number;
  harSize: number;
  screenshotCount: number;
}

// === v3.0: Deep Extraction types ===

export interface DesignTokens {
  colors: ColorTokens;
  spacing: SpacingTokens;
  typography: TypographyTokens;
  borders: BorderTokens;
  effects: EffectTokens;
}

export interface ColorTokens {
  palette: ColorEntry[];
  backgrounds: ColorEntry[];
  texts: ColorEntry[];
  accents: ColorEntry[];
  gradients: string[];
}

export interface ColorEntry {
  value: string;        // rgb or hex
  count: number;        // frequency
  contexts: string[];   // 'backgroundColor', 'color', 'borderColor'
  role?: string;        // 'primary-bg', 'primary-text', 'accent', 'muted'
}

export interface SpacingTokens {
  values: number[];     // sorted unique px values
  baseUnit: number;     // detected base (4, 8, etc.)
  ratio: number | null; // geometric ratio if detected
  scale: number[];      // the cleaned scale (multiples of baseUnit)
  sectionPaddings: number[]; // vertical padding of major sections (in vh or px)
}

export interface TypographyTokens {
  fonts: FontToken[];
  scale: TypeScaleEntry[];
  baseSize: number;
  scaleRatio: number | null; // 1.2 minor third, 1.25 major third, etc.
}

export interface FontToken {
  family: string;
  weights: string[];
  role: 'heading' | 'body' | 'accent' | 'mono' | 'unknown';
  source?: string; // URL of the font file
}

export interface TypeScaleEntry {
  size: number;
  lineHeight: number;     // ratio (e.g. 1.2)
  letterSpacing: string;  // e.g. '-0.03em'
  fontWeight: string;
  fontFamily: string;
  count: number;          // how many elements use this
  tags: string[];         // which HTML tags use it
}

export interface BorderTokens {
  radii: number[];       // unique border-radius values
  widths: number[];      // unique border widths
}

export interface EffectTokens {
  shadows: string[];     // unique box-shadow values
  blendModes: string[];  // mix-blend-mode values used
  filters: string[];     // unique filter values
  backdropFilters: string[];
}

// Animation extraction types
export interface ExtractedAnimations {
  gsap: GsapExtraction | null;
  cssAnimations: CssAnimationEntry[];
  transitions: TransitionEntry[];
  scrollPatterns: ScrollPattern[];
}

export interface GsapExtraction {
  timeline: GsapTimelineEntry[];
  scrollTriggers: ScrollTriggerEntry[];
}

export interface GsapTimelineEntry {
  type: 'tween' | 'timeline';
  label?: string;
  targets?: string[];        // CSS selectors
  duration?: number;
  delay?: number;
  ease?: string;
  properties?: string[];     // animated properties
  fromVars?: Record<string, any>;
  toVars?: Record<string, any>;
  startTime?: number;
  children?: GsapTimelineEntry[];
}

export interface ScrollTriggerEntry {
  trigger: string;           // CSS selector
  start: string;             // e.g. 'top 80%'
  end: string;               // e.g. 'bottom 20%'
  scrub: boolean | number;
  pin: boolean;
  animation: {
    targets: string[];
    duration: number;
    vars: Record<string, any>;
  } | null;
}

export interface CssAnimationEntry {
  target: string;            // CSS selector
  name: string;              // animation-name
  keyframes: Record<string, any>[];
  timing: {
    duration: number;
    delay: number;
    easing: string;
    iterations: number | string;
    fill: string;
  };
}

export interface TransitionEntry {
  selector: string;
  properties: string[];
  durations: string[];
  easings: string[];
  delays: string[];
}

export interface ScrollPattern {
  type: 'reveal' | 'parallax' | 'pin' | 'progress' | 'stagger';
  selector: string;
  description: string;
  params: Record<string, any>;
}

// Component extraction types
export interface ExtractedComponent {
  id: string;                // domain:type:index
  selector: string;
  type: ComponentType;
  html: string;              // outer HTML (truncated to 10KB)
  textPreview: string;       // first 200 chars of text content
  rect: { top: number; left: number; width: number; height: number };
  childCount: number;
  depth: number;
  meta: {
    hasAnimation: boolean;
    hasVideo: boolean;
    hasImage: boolean;
    hasForm: boolean;
    estimatedHeight: 'compact' | 'medium' | 'tall' | 'hero';
    classes: string[];
  };
}

export type ComponentType =
  | 'hero' | 'navigation' | 'footer' | 'features' | 'portfolio'
  | 'testimonials' | 'cta' | 'about' | 'contact' | 'slider'
  | 'video-section' | 'stats' | 'pricing' | 'faq' | 'logo-bar'
  | 'card-grid' | 'process' | 'team' | 'content';

// Deep extraction output
export interface DeepExtraction {
  domain: string;
  url: string;
  extractedAt: string;
  tokens: DesignTokens;
  animations: ExtractedAnimations;
  components: ExtractedComponent[];
  screenshotPaths: string[];
}

// === v3.0: Regeneration types ===

export interface RegenerateBrief {
  description: string;
  style?: 'dark' | 'light' | 'mixed';
  sections: string[];         // e.g. ['hero', 'features', 'portfolio', 'cta', 'footer']
  referenceDir: string;       // path to recording output dir
  maxIterations: number;      // visual loop iterations (default 3)
}

export interface RegenerateOutput {
  html: string;
  css: string;
  js: string;
  outputDir: string;
  validationReport: ValidationReport;
}

export interface ValidationReport {
  violations: ValidationViolation[];
  passed: boolean;
  score: number;              // 0-100
}

export interface ValidationViolation {
  type: 'generic-pattern' | 'off-palette' | 'off-scale' | 'generic-easing' | 'missing-animation';
  message: string;
  line?: number;
  suggestion?: string;
}

export const DEFAULT_RECORD_CONFIG: RecordConfig = {
  url: '',
  outputDir: './output',
  viewport: { name: 'desktop', width: 1920, height: 1080 },
  timeout: 60000,
  maxPages: 1,
  headless: true,
};

export const DEFAULT_CONFIG: CloneConfig = {
  url: '',
  outputDir: './output',
  viewports: [
    { name: 'desktop', width: 1920, height: 1080 },
  ],
  maxPages: 50,
  timeout: 30000,
  waitForNetworkIdle: true,
  includeScripts: false,
  includeAnimations: true,
};
