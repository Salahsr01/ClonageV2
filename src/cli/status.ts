import * as fs from 'fs';
import * as path from 'path';
import { logger, formatBytes } from '../utils/logger.js';

/**
 * `clonage status` — inventory of what the user has on disk.
 * Reports : clones under output/, KB sections, atlas stats, briefs, generated dirs.
 */
export async function runStatus(): Promise<void> {
  logger.banner();
  logger.section('Clonage workspace');

  const root = process.cwd();
  logger.kv('cwd', root, 12);

  // Clones
  const outputDir = path.join(root, 'output');
  const clones = listDirs(outputDir);
  logger.section(`Clones (output/) — ${clones.length}`);
  if (clones.length === 0) {
    logger.muted('  (none — run `clonage record <url>` or `clonage clone <url>`)');
  } else {
    const rows = clones.slice(0, 10).map((c) => {
      const hasHar = fs.existsSync(path.join(outputDir, c, 'recording.har'));
      const sizeB = dirSize(path.join(outputDir, c));
      return [c, hasHar ? 'HAR' : 'static', formatBytes(sizeB)];
    });
    logger.table(['name', 'kind', 'size'], rows);
    if (clones.length > 10) logger.muted(`  … and ${clones.length - 10} more`);
  }

  // KB sections
  const kbDir = path.join(root, '.clonage-kb', 'sections');
  const kbSites = listDirs(kbDir);
  logger.section(`Knowledge base — ${kbSites.length} sites`);
  if (kbSites.length === 0) {
    logger.muted('  (empty — run `clonage deep-extract <cloneDir>`)');
  } else {
    const rows = kbSites.map((site) => {
      const dir = path.join(kbDir, site);
      const html = fs.readdirSync(dir).filter((f) => f.endsWith('.html') && !f.startsWith('_')).length;
      const grounded = fs.readdirSync(dir).filter((f) => f.endsWith('.ground.json')).length;
      return [site, String(html), String(grounded)];
    });
    logger.table(['site', 'sections', 'grounded'], rows);
  }

  // Atlas
  const atlasPath = path.join(root, '.clonage-kb', 'atlas.jsonl');
  logger.section('Atlas');
  if (fs.existsSync(atlasPath)) {
    const lines = fs.readFileSync(atlasPath, 'utf-8').split('\n').filter(Boolean);
    let sites = new Set<string>();
    let embedders = new Set<string>();
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (row.site) sites.add(row.site);
        if (row.embedder_id) embedders.add(row.embedder_id);
      } catch {
        /* skip */
      }
    }
    logger.kv('path', atlasPath, 12);
    logger.kv('entries', String(lines.length), 12);
    logger.kv('sites', [...sites].sort().join(', ') || '(none)', 12);
    logger.kv('embedder', [...embedders].sort().join(', ') || '(none)', 12);
  } else {
    logger.muted('  (no atlas yet — run `clonage atlas index <kbDir> --site <name>`)');
  }

  // Briefs
  const briefsDir = path.join(root, 'briefs');
  logger.section('Briefs');
  if (fs.existsSync(briefsDir)) {
    const files = fs.readdirSync(briefsDir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) {
      logger.muted('  (no briefs — write one in briefs/<name>.json)');
    } else {
      for (const f of files) {
        logger.dim(`${f}  ${formatBytes(fs.statSync(path.join(briefsDir, f)).size)}`);
      }
    }
  } else {
    logger.muted('  (briefs/ does not exist)');
  }

  // Generated
  const genDir = path.join(root, 'generated');
  const gens = listDirs(genDir);
  logger.section(`Generated — ${gens.length}`);
  if (gens.length === 0) {
    logger.muted('  (no outputs yet)');
  } else {
    const rows = gens.slice(0, 10).map((g) => {
      const dir = path.join(genDir, g);
      const hasIndex = fs.existsSync(path.join(dir, 'index.html'));
      return [g, hasIndex ? 'index.html ✓' : '—', formatBytes(dirSize(dir))];
    });
    logger.table(['name', 'index', 'size'], rows);
  }

  logger.hr();
  logger.hint('`clonage doctor` checks your environment + API keys.');
}

function listDirs(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function dirSize(p: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const sub = path.join(p, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(sub);
        else total += fs.statSync(sub).size;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return total;
}
