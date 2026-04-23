import * as fs from 'fs';
import * as path from 'path';
import type { KBv2Index, SectionRole } from './types.js';

export interface WriteKBParams {
  siteName: string;
  index: KBv2Index;
  sections: Array<{ role: SectionRole; html: string }>;
  kbRoot?: string;
  force?: boolean;
  assetsSource?: string;
}

export function writeKB(params: WriteKBParams): { kbDir: string } {
  const kbRoot = params.kbRoot ?? path.join(process.cwd(), '.clonage-kb');
  const kbDir = path.join(kbRoot, 'sections', params.siteName);
  const indexPath = path.join(kbDir, 'index.json');

  if (fs.existsSync(indexPath) && !params.force) {
    throw new Error(`KB entry already exists at ${indexPath} — use force:true to overwrite`);
  }

  fs.mkdirSync(kbDir, { recursive: true });

  fs.writeFileSync(indexPath, JSON.stringify(params.index, null, 2), 'utf-8');
  for (const sec of params.sections) {
    const file = path.join(kbDir, `${sec.role}.html`);
    fs.writeFileSync(file, sec.html, 'utf-8');
  }

  if (params.assetsSource && fs.existsSync(params.assetsSource)) {
    const dest = path.join(kbDir, 'assets');
    try {
      if (fs.existsSync(dest)) {
        const stat = fs.lstatSync(dest);
        if (stat.isSymbolicLink()) fs.unlinkSync(dest);
      }
      fs.symlinkSync(path.resolve(params.assetsSource), dest, 'dir');
    } catch {
      fs.cpSync(params.assetsSource, dest, { recursive: true });
    }
  }

  return { kbDir };
}
