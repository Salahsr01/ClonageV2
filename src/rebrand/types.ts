export interface BrandBrief {
  brand?: { name: string; source_name: string };
  palette?: { map: Record<string, string> };
  typography?: {
    primary?: { family: string; google?: boolean };
    display?: { family: string; google?: boolean };
  };
  copy?: Array<CopyEntry>;
  images?: Array<ImageEntry>;
}

export type CopyEntry =
  | { from: string; to: string }
  | { selector: string; to: string };

export type ImageEntry =
  | { from: string; to: string }
  | { selector: string; to: string };

export interface RebrandOptions {
  inputHtml: string;
  brief: BrandBrief;
  outputPath?: string;
}

export interface TransformerReport {
  name: 'brand' | 'palette' | 'typography' | 'copy' | 'images';
  applied: number;
  skipped: number;
  warnings: string[];
  info?: Record<string, unknown>;
}

export interface RebrandResult {
  outputHtml: string;
  metadataPath: string;
  reports: TransformerReport[];
}
