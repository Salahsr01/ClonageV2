import * as fs from 'fs';
import * as path from 'path';

/**
 * Small helpers used by the interactive menu to populate autocomplete lists
 * from the user's current workspace.
 */

export interface CloneInfo {
  full: string;
  short: string;
  meta: string;
}

export function listExistingClones(): CloneInfo[] {
  const outputDir = path.resolve('./output');
  if (!fs.existsSync(outputDir)) return [];
  const out: CloneInfo[] = [];
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(outputDir, entry.name);
    const hasHar = fs.existsSync(path.join(full, 'recording.har'));
    const hasIndex = fs.existsSync(path.join(full, 'index.html'));
    if (!hasHar && !hasIndex) continue;
    out.push({
      full,
      short: entry.name,
      meta: hasHar ? 'HAR (replayable)' : 'static only',
    });
  }
  out.sort((a, b) => a.short.localeCompare(b.short));
  return out;
}

export interface BriefInfo {
  full: string;
  short: string;
}

export function listExistingBriefs(): BriefInfo[] {
  const dir = path.resolve('./briefs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ full: path.join(dir, f), short: f }))
    .sort((a, b) => a.short.localeCompare(b.short));
}

export interface KbSiteInfo {
  full: string;
  site: string;
  sections: number;
}

export function listKbSites(): KbSiteInfo[] {
  const root = path.resolve('./.clonage-kb/sections');
  if (!fs.existsSync(root)) return [];
  const out: KbSiteInfo[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const sections = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_')).length;
    out.push({ full: dir, site: entry.name, sections });
  }
  return out;
}
