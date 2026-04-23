import chalk from 'chalk';
import boxen from 'boxen';
import Table from 'cli-table3';

/**
 * Unified terminal UI primitives for the Clonage CLI.
 *
 * Design targets :
 *   - **Consistency** — one theme for success / info / warn / error (Vercel-like).
 *   - **Scannable** — each output line has ONE icon + ONE colour by severity.
 *   - **Non-destructive API** — existing callers keep using info/success/warn/
 *     error/step/dim/banner with the same signatures. New callers can lean on
 *     the richer primitives (panel / section / table / kv / hint).
 */

const ICON = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  error: '✗',
  arrow: '›',
  bullet: '•',
  rocket: '⇢',
  done: '◉',
};

const C = {
  info: chalk.cyanBright,
  success: chalk.greenBright,
  warn: chalk.yellow,
  error: chalk.redBright,
  step: chalk.magenta,
  muted: chalk.gray,
  brand: chalk.hex('#c49a3f'),
  accent: chalk.hex('#0d2e5c'),
  highlight: chalk.bold.white,
  dim: chalk.dim,
};

export const logger = {
  info(msg: string) {
    console.log(`${C.info(ICON.info)} ${msg}`);
  },
  success(msg: string) {
    console.log(`${C.success(ICON.success)} ${msg}`);
  },
  warn(msg: string) {
    console.log(`${C.warn(ICON.warn)} ${msg}`);
  },
  error(msg: string) {
    console.error(`${C.error(ICON.error)} ${msg}`);
  },
  step(step: number, total: number, msg: string) {
    console.log(`${C.step(`[${step}/${total}]`)} ${msg}`);
  },
  dim(msg: string) {
    console.log(C.muted('  ' + msg));
  },
  muted(msg: string) {
    console.log(C.muted(msg));
  },
  hint(msg: string) {
    console.log(`${C.muted(ICON.arrow)} ${C.muted(msg)}`);
  },

  /** Branded banner shown at the top of interactive / long commands. */
  banner() {
    const title = C.brand.bold('CLONAGE');
    const subtitle = C.muted('clone • rebrand • compose — for the modern web');
    const content = `${title}  ${C.dim('v3.1')}\n${subtitle}`;
    console.log(
      boxen(content, {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 1, bottom: 1, left: 0, right: 0 },
        borderColor: 'yellow',
        borderStyle: 'round',
        float: 'left',
      }),
    );
  },

  /** Section header with a light rule under it. */
  section(title: string) {
    console.log('');
    console.log(C.highlight(title));
    console.log(C.muted('─'.repeat(Math.max(title.length, 12))));
  },

  /** Key/value line, aligned. Useful for status output. */
  kv(key: string, value: string, keyWidth = 18) {
    console.log(`  ${C.muted(key.padEnd(keyWidth))}  ${value}`);
  },

  /** Boxed panel for summaries. */
  panel(title: string, body: string, opts: { color?: string } = {}) {
    const color = opts.color ?? 'cyan';
    console.log(
      boxen(body, {
        title: C.highlight(title),
        padding: { top: 0, bottom: 0, left: 1, right: 1 },
        margin: { top: 1, bottom: 0, left: 0, right: 0 },
        borderColor: color as any,
        borderStyle: 'round',
      }),
    );
  },

  /** Tabular output. `rows` is an array of row arrays. */
  table(headers: string[], rows: string[][], opts: { colWidths?: number[] } = {}) {
    const tableOpts: any = {
      head: headers.map((h) => C.highlight(h)),
      style: { head: [], border: ['gray'] },
      wordWrap: true,
    };
    if (opts.colWidths) tableOpts.colWidths = opts.colWidths;
    const t = new Table(tableOpts);
    for (const r of rows) t.push(r);
    console.log(t.toString());
  },

  /** Separator line. */
  hr() {
    console.log(C.muted('─'.repeat(60)));
  },

  /** Suggest a follow-up command. Style : "⇢ try `clonage foo`". */
  next(command: string, why?: string) {
    const cmd = chalk.cyan(command);
    const tail = why ? '  ' + C.muted('(' + why + ')') : '';
    console.log(`${C.accent(ICON.rocket)} ${cmd}${tail}`);
  },
};

export const theme = { C, ICON };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
