export interface ReproduceExactOptions {
  clonePath: string;
  entryFile?: string;
  section?: string;
  outputDir: string;
  viewport?: { width: number; height: number };
  diffThreshold?: number;
}

export interface ReproduceExactResult {
  outputHtml: string;
  assetsDir?: string;
  metadataPath: string;
  diffScore: number;
  passed: boolean;
  sectionSelector: string;
  detectionMethod: 'lcp' | 'selector' | 'fallback';
}

export interface SectionCandidate {
  selector: string;
  method: 'lcp' | 'selector' | 'fallback';
  boundingBox: { x: number; y: number; width: number; height: number };
  lcpSize?: number;
  viewportCoverage: number;
  runnerUp?: { selector: string; viewportCoverage: number };
}
