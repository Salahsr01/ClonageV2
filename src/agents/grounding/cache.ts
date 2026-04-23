import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { GroundSidecar } from './schema.js';
import { GroundSidecarSchema } from './schema.js';

/**
 * Hash the section HTML + the screenshot bytes so the cache invalidates
 * when either changes. Hash is stored in the sidecar; we re-grounding
 * only when hashes differ.
 */
export function hashSection(html: string, screenshotPath?: string): string {
  const h = crypto.createHash('sha256');
  h.update(html);
  if (screenshotPath && fs.existsSync(screenshotPath)) {
    h.update(fs.readFileSync(screenshotPath));
  }
  return h.digest('hex').substring(0, 16);
}

export function groundSidecarPath(sectionHtmlPath: string): string {
  const dir = path.dirname(sectionHtmlPath);
  const base = path.basename(sectionHtmlPath, '.html');
  return path.join(dir, `${base}.ground.json`);
}

export function readCachedSidecar(sidecarPath: string): GroundSidecar | null {
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(sidecarPath, 'utf-8'));
    return GroundSidecarSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeSidecar(sidecarPath: string, sidecar: GroundSidecar): void {
  // Validate on the way out — defensive.
  const parsed = GroundSidecarSchema.parse(sidecar);
  fs.writeFileSync(sidecarPath, JSON.stringify(parsed, null, 2), 'utf-8');
}
