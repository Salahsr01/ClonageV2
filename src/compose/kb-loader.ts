import * as fs from 'fs';
import * as path from 'path';
import type { KBv2Index } from '../deep-extract/types.js';
import type { LoadedKB, LoadedSection } from './types.js';

export function loadKB(siteName: string, kbRoot?: string): LoadedKB {
  const root = kbRoot ?? path.join(process.cwd(), '.clonage-kb');
  const kbDir = path.join(root, 'sections', siteName);
  const indexPath = path.join(kbDir, 'index.json');

  if (!fs.existsSync(indexPath)) {
    throw new Error(`KB entry not found for "${siteName}" at ${indexPath} — run deep-extract first.`);
  }

  let index: KBv2Index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  } catch (err: any) {
    throw new Error(`Invalid index.json at ${indexPath}: ${err.message}`);
  }

  const sections: LoadedSection[] = index.sections.map((meta) => {
    const filePath = path.join(kbDir, meta.file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Section file missing: ${meta.file} (declared in index.json but not on disk)`);
    }
    return {
      meta,
      path: filePath,
      html: fs.readFileSync(filePath, 'utf-8'),
    };
  });

  return { index, kbDir, sections };
}
