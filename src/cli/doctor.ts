import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { logger, theme, formatBytes } from '../utils/logger.js';

/**
 * `clonage doctor` — diagnose the environment. Non-destructive, read-only.
 * Reports : Node version, API keys, Playwright install, disk space for common dirs.
 */
export async function runDoctor(): Promise<{ ok: boolean; warnings: number; errors: number }> {
  logger.banner();
  logger.section('Environment diagnostics');

  let errors = 0;
  let warnings = 0;

  // Node
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor >= 20) {
    logger.success(`Node.js v${process.versions.node}`);
  } else {
    logger.error(`Node.js v${process.versions.node} — need ≥ 20`);
    errors++;
  }

  // Playwright
  const pwCheck = spawnSync('npx', ['--no-install', 'playwright', '--version'], {
    encoding: 'utf-8',
    timeout: 10_000,
  });
  if (pwCheck.status === 0) {
    logger.success(`Playwright: ${pwCheck.stdout.trim()}`);
  } else {
    logger.error('Playwright not found — run `npx playwright install chromium`');
    errors++;
  }

  // Chromium specifically
  const chromiumPath = process.env.HOME + '/Library/Caches/ms-playwright';
  if (fs.existsSync(chromiumPath)) {
    const dirs = fs.readdirSync(chromiumPath).filter((d) => d.startsWith('chromium'));
    if (dirs.length > 0) {
      logger.success(`Chromium browsers: ${dirs.length} installed`);
    } else {
      logger.warn('Chromium browsers not installed — replay will fail');
      warnings++;
    }
  } else {
    logger.warn('Playwright browser cache missing — first run will download ~300 MB');
    warnings++;
  }

  logger.section('API keys');
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const openai = process.env.OPENAI_API_KEY;
  if (anthropic) {
    logger.success(`ANTHROPIC_API_KEY  ${theme.C.muted('(' + mask(anthropic) + ')')}`);
  } else {
    logger.warn('ANTHROPIC_API_KEY  not set — brief-gen & text-diff will fail');
    warnings++;
  }
  if (openai) {
    logger.success(`OPENAI_API_KEY     ${theme.C.muted('(' + mask(openai) + ')')}`);
  } else {
    logger.info('OPENAI_API_KEY     not set — atlas falls back to hash embeddings (test-grade)');
  }

  logger.section('Disk usage');
  const paths = [
    { label: 'output/',       p: path.resolve('./output') },
    { label: 'generated/',    p: path.resolve('./generated') },
    { label: '.clonage-kb/',  p: path.resolve('./.clonage-kb') },
    { label: 'node_modules/', p: path.resolve('./node_modules') },
  ];
  for (const { label, p } of paths) {
    if (!fs.existsSync(p)) {
      logger.dim(`${label.padEnd(16)} not present`);
      continue;
    }
    const size = dirSize(p);
    logger.kv(label, formatBytes(size), 16);
  }

  logger.section('Summary');
  if (errors === 0 && warnings === 0) {
    logger.success('All checks passed');
  } else if (errors === 0) {
    logger.warn(`${warnings} warning(s) — non-blocking`);
  } else {
    logger.error(`${errors} error(s) — clonage will not run correctly`);
  }
  logger.hint('Set env keys in a local .env file and `source .env` before running.');

  return { ok: errors === 0, warnings, errors };
}

function mask(key: string): string {
  if (key.length < 12) return '***';
  return key.substring(0, 6) + '…' + key.substring(key.length - 4);
}

/** Best-effort recursive size; skips inaccessible entries. */
function dirSize(p: string): number {
  let total = 0;
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return stat.size;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      // Skip symlinks to avoid infinite loops / external targets.
      if (entry.isSymbolicLink()) continue;
      const sub = path.join(p, entry.name);
      try {
        if (entry.isDirectory()) total += dirSize(sub);
        else total += fs.statSync(sub).size;
      } catch {
        // permission denied etc — ignore
      }
    }
  } catch {
    // unreadable dir
  }
  return total;
}
