import prompts from 'prompts';
import { logger, theme } from '../utils/logger.js';

/**
 * Interactive menu shown when the user runs `clonage` without a subcommand.
 * Picks an action, collects the required inputs, and returns a CLI args array
 * the main parser can handle. Returns null if the user aborts.
 */

export interface MenuResult {
  /** Argv-style array, e.g. ["clone-and-rebrand", "https://x.com", "--for", "..."]. */
  argv: string[] | null;
}

interface Action {
  label: string;
  value: string;
  hint: string;
}

const ACTIONS: Action[] = [
  {
    value: 'clone-and-rebrand',
    label: 'Clone + Rebrand (one-shot)',
    hint: 'Record a URL → LLM drafts a brief → HAR is rewritten → replay opens',
  },
  { value: 'record', label: 'Record a URL', hint: 'HAR capture — full JS + assets' },
  { value: 'replay', label: 'Replay an existing clone', hint: 'Open a HAR in Chromium' },
  { value: 'brief-gen', label: 'Generate a brief from a clone', hint: 'LLM from screenshot + description' },
  { value: 'rebrand-har', label: 'Rebrand a HAR with a brief', hint: 'Apply brand/copy swaps inside the HAR' },
  { value: 'atlas-index', label: 'Atlas — index a KB site', hint: 'Add a deep-extract output to the RAG store' },
  { value: 'atlas-search', label: 'Atlas — semantic search', hint: 'Query the atlas for sections matching a brief' },
  { value: 'plan', label: 'Plan — compose a site plan', hint: 'LLM picks sections from atlas per brief' },
  { value: 'generate', label: 'Generate — compile a plan to a site', hint: 'Deterministic HTML assembly' },
  { value: 'status', label: 'Status — what I have on disk', hint: 'Inventory of clones, KB, atlas, briefs' },
  { value: 'doctor', label: 'Doctor — check environment', hint: 'Node, Playwright, API keys, disk' },
  { value: 'exit', label: '— exit', hint: '' },
];

export async function runInteractiveMenu(): Promise<MenuResult> {
  logger.banner();
  logger.hint('Choose an action (↑↓ to navigate, Enter to select, ctrl-c to exit)');

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'What do you want to do?',
    choices: ACTIONS.map((a) => ({
      title: a.label,
      value: a.value,
      description: a.hint,
    })),
    initial: 0,
  });
  if (!action || action === 'exit') return { argv: null };

  // Collect the required inputs per action.
  switch (action) {
    case 'clone-and-rebrand':
      return { argv: await collectCloneAndRebrand() };
    case 'record':
      return { argv: await collectRecord() };
    case 'replay':
      return { argv: await collectReplay() };
    case 'brief-gen':
      return { argv: await collectBriefGen() };
    case 'rebrand-har':
      return { argv: await collectRebrandHar() };
    case 'atlas-index':
      return { argv: await collectAtlasIndex() };
    case 'atlas-search':
      return { argv: await collectAtlasSearch() };
    case 'plan':
      return { argv: await collectPlan() };
    case 'generate':
      return { argv: await collectGenerate() };
    case 'status':
      return { argv: ['status'] };
    case 'doctor':
      return { argv: ['doctor'] };
  }
  return { argv: null };
}

async function ask(name: string, message: string, initial?: string): Promise<string | null> {
  const r = await prompts({ type: 'text', name, message, initial });
  return r[name] ?? null;
}

async function askCloneDir(): Promise<string | null> {
  const { listExistingClones } = await import('./picker.js');
  const clones = listExistingClones();
  if (clones.length === 0) {
    return ask('cloneDir', 'Clone directory path (required):');
  }
  const r = await prompts({
    type: 'autocomplete',
    name: 'cloneDir',
    message: 'Pick a clone directory',
    choices: [
      ...clones.map((c) => ({ title: c.short, value: c.full, description: c.meta })),
      { title: '— type a custom path', value: '__custom__', description: '' },
    ],
  });
  if (!r.cloneDir) return null;
  if (r.cloneDir === '__custom__') return ask('cloneDir', 'Custom path:');
  return r.cloneDir;
}

async function askBrief(): Promise<string | null> {
  const { listExistingBriefs } = await import('./picker.js');
  const briefs = listExistingBriefs();
  if (briefs.length === 0) {
    return ask('brief', 'Brief JSON path (required):');
  }
  const r = await prompts({
    type: 'autocomplete',
    name: 'brief',
    message: 'Pick a brief',
    choices: [
      ...briefs.map((b) => ({ title: b.short, value: b.full })),
      { title: '— type a custom path', value: '__custom__' },
    ],
  });
  if (!r.brief) return null;
  if (r.brief === '__custom__') return ask('brief', 'Custom path:');
  return r.brief;
}

async function collectCloneAndRebrand(): Promise<string[] | null> {
  const url = await ask('url', 'URL to clone (e.g. https://naughtyduk.com/):');
  if (!url) return null;
  const forDesc = await ask(
    'for',
    'Target brand description (one line, what kind of brand you want):',
  );
  if (!forDesc) return null;
  const { replayAfter } = await prompts({
    type: 'toggle',
    name: 'replayAfter',
    message: 'Open replay automatically when done?',
    initial: true,
    active: 'yes',
    inactive: 'no',
  });
  const argv = ['clone-and-rebrand', url, '--for', forDesc];
  if (replayAfter === false) argv.push('--no-replay');
  return argv;
}

async function collectRecord(): Promise<string[] | null> {
  const url = await ask('url', 'URL to record:');
  if (!url) return null;
  return ['record', url];
}

async function collectReplay(): Promise<string[] | null> {
  const dir = await askCloneDir();
  if (!dir) return null;
  return ['replay', dir];
}

async function collectBriefGen(): Promise<string[] | null> {
  const dir = await askCloneDir();
  if (!dir) return null;
  const forDesc = await ask('for', 'Target description:');
  if (!forDesc) return null;
  const out = (await ask('out', 'Output path:', 'briefs/auto.json')) || 'briefs/auto.json';
  return ['brief-gen', dir, '--for', forDesc, '-o', out];
}

async function collectRebrandHar(): Promise<string[] | null> {
  const dir = await askCloneDir();
  if (!dir) return null;
  const brief = await askBrief();
  if (!brief) return null;
  const { openReplay } = await prompts({
    type: 'toggle',
    name: 'openReplay',
    message: 'Open replay after rebrand?',
    initial: true,
    active: 'yes',
    inactive: 'no',
  });
  const argv = ['rebrand-har', dir, '-b', brief];
  if (openReplay) argv.push('--replay');
  return argv;
}

async function collectAtlasIndex(): Promise<string[] | null> {
  const { listKbSites } = await import('./picker.js');
  const sites = listKbSites();
  if (sites.length === 0) {
    logger.warn('No deep-extract KB sites found under .clonage-kb/sections/');
    const manual = await ask('kbDir', 'KB section dir (full path):');
    const site = await ask('site', 'Site identifier:');
    if (!manual || !site) return null;
    return ['atlas', 'index', manual, '--site', site];
  }
  const r = await prompts({
    type: 'select',
    name: 'site',
    message: 'Which KB site to index?',
    choices: sites.map((s) => ({ title: s.site, value: s.site, description: `${s.sections} sections` })),
  });
  if (!r.site) return null;
  const dir = sites.find((s) => s.site === r.site)!.full;
  return ['atlas', 'index', dir, '--site', r.site];
}

async function collectAtlasSearch(): Promise<string[] | null> {
  const query = await ask('q', 'Search query (free text):');
  if (!query) return null;
  const { role } = await prompts({
    type: 'text',
    name: 'role',
    message: 'Filter by role (empty for any):',
  });
  const argv = ['atlas', 'search', query];
  if (role) argv.push('-r', role);
  return argv;
}

async function collectPlan(): Promise<string[] | null> {
  const brief = await askBrief();
  if (!brief) return null;
  return ['plan', '-b', brief];
}

async function collectGenerate(): Promise<string[] | null> {
  const plan = await ask('plan', 'Plan JSON path (generated/<brand>/_plan.json):');
  if (!plan) return null;
  const brief = await askBrief();
  if (!brief) return null;
  return ['generate', plan, '-b', brief];
}
