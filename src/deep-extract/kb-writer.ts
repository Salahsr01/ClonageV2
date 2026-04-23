import * as fs from 'fs';
import * as path from 'path';
import { buildInventory } from '../compose/inventory.js';
import type { KBv2Index, SectionRole } from './types.js';

export interface WriteKBParams {
  siteName: string;
  index: KBv2Index;
  sections: Array<{ role: SectionRole; html: string }>;
  kbRoot?: string;
  force?: boolean;
  assetsSource?: string;
  /** Emit a `<role>.inv.json` sidecar next to each section HTML. Default true. */
  writeInventory?: boolean;
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
  const writeInv = params.writeInventory !== false;
  for (const sec of params.sections) {
    const file = path.join(kbDir, `${sec.role}.html`);
    fs.writeFileSync(file, sec.html, 'utf-8');
    if (writeInv) {
      try {
        const inv = buildInventory(sec.html);
        fs.writeFileSync(
          path.join(kbDir, `${sec.role}.inv.json`),
          JSON.stringify(
            { role: sec.role, site: params.siteName, ...inv },
            null,
            2,
          ),
          'utf-8',
        );
      } catch {
        // Inventory build is best-effort; failures don't block KB write.
      }
    }
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
