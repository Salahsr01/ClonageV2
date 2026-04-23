import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { logger } from './logger.js';

export interface CallLLMOptions {
  prompt: string;
  systemPrompt?: string;
  projectDir?: string;
  responseFile?: string;
  maxTokens?: number;
  silent?: boolean;
  /**
   * When true, throw LLMError on provider error or empty response instead of returning ''.
   * The legacy generator/ module relies on the return-empty behavior, so default is false.
   */
  strict?: boolean;
}

export class LLMError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly detail?: string;
  constructor(provider: string, message: string, opts: { status?: number; detail?: string } = {}) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMError';
    this.provider = provider;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

function findClaudeCli(): string {
  const envPath = process.env.CLAUDE_CLI_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidates = [
    path.join(process.env.HOME || '', '.local/bin/claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  const which = spawnSync('which', ['claude'], { encoding: 'utf-8' });
  if (which.status === 0) {
    const p = (which.stdout || '').trim();
    if (p && fs.existsSync(p)) return p;
  }
  return '';
}

function persist(text: string, opts: CallLLMOptions): void {
  if (!text) return;
  if (opts.responseFile) {
    fs.writeFileSync(opts.responseFile, text, 'utf-8');
    return;
  }
  if (opts.projectDir) {
    fs.writeFileSync(path.join(opts.projectDir, '_llm-response.txt'), text, 'utf-8');
  }
}

function log(opts: CallLLMOptions, msg: string, level: 'dim' | 'warn' = 'dim') {
  if (opts.silent) return;
  if (level === 'dim') logger.dim(msg);
  else logger.warn(msg);
}

export async function callLLM(opts: CallLLMOptions): Promise<string> {
  const { prompt, systemPrompt, maxTokens = 16000, strict = false } = opts;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const hfToken = process.env.HF_TOKEN;
  const errors: string[] = [];

  if (anthropicKey) {
    log(opts, '  → Claude API...');
    try {
      const messages: any[] = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });
      const body: any = {
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };
      if (systemPrompt) body.system = systemPrompt;
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = (await res.text()).substring(0, 200);
        log(opts, `Claude API ${res.status}: ${detail}`, 'warn');
        if (strict) throw new LLMError('claude-api', `HTTP ${res.status}`, { status: res.status, detail });
        errors.push(`claude-api HTTP ${res.status}`);
      } else {
        const data = (await res.json()) as any;
        const text = data.content?.[0]?.text || '';
        if (text) {
          persist(text, opts);
          return text;
        }
        if (strict) throw new LLMError('claude-api', 'empty response');
        errors.push('claude-api empty response');
      }
    } catch (err: any) {
      if (err instanceof LLMError) throw err;
      log(opts, `Claude call failed: ${err.message}`, 'warn');
      if (strict) throw new LLMError('claude-api', err.message || 'network error');
      errors.push(`claude-api ${err.message}`);
    }
  }

  const claudeCli = process.env.CLAUDE_CLI_DISABLE ? '' : findClaudeCli();
  if (claudeCli) {
    log(opts, `  → claude CLI (${claudeCli})...`);
    try {
      const args = ['-p', '--model', 'claude-sonnet-4-5'];
      const input = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
      const res = spawnSync(claudeCli, args, {
        input,
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      });
      if (res.status !== 0) {
        const detail = (res.stderr || '').substring(0, 200);
        log(opts, `claude CLI exit ${res.status}: ${detail}`, 'warn');
        errors.push(`claude-cli exit ${res.status}`);
        if (strict) throw new LLMError('claude-cli', `exit ${res.status}`, { detail });
      } else {
        const text = (res.stdout || '').trim();
        if (text) {
          persist(text, opts);
          return text;
        }
        errors.push('claude-cli empty response');
        if (strict) throw new LLMError('claude-cli', 'empty response');
      }
    } catch (err: any) {
      if (err instanceof LLMError) throw err;
      log(opts, `claude CLI failed: ${err.message}`, 'warn');
      errors.push(`claude-cli ${err.message}`);
      if (strict) throw new LLMError('claude-cli', err.message || 'spawn failed');
    }
  }

  if (hfToken) {
    const model = process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct';
    log(opts, `  → HuggingFace ${model.split('/').pop()}...`);
    try {
      const messages: any[] = [];
      messages.push({
        role: 'system',
        content:
          systemPrompt ||
          'Tu es un expert en adaptation de templates HTML. Tu reponds UNIQUEMENT avec le HTML complet, sans commentaire ni explication.',
      });
      messages.push({ role: 'user', content: prompt });
      const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${hfToken}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3,
          top_p: 0.9,
        }),
      });
      if (!res.ok) {
        const detail = (await res.text()).substring(0, 200);
        log(opts, `HF API ${res.status}: ${detail}`, 'warn');
        if (strict) throw new LLMError('huggingface', `HTTP ${res.status}`, { status: res.status, detail });
        errors.push(`huggingface HTTP ${res.status}`);
      } else {
        const data = (await res.json()) as any;
        const text = data.choices?.[0]?.message?.content || '';
        if (text) {
          persist(text, opts);
          return text;
        }
        if (strict) throw new LLMError('huggingface', 'empty response');
        errors.push('huggingface empty response');
      }
    } catch (err: any) {
      if (err instanceof LLMError) throw err;
      log(opts, `HF call failed: ${err.message}`, 'warn');
      if (strict) throw new LLMError('huggingface', err.message || 'network error');
      errors.push(`huggingface ${err.message}`);
    }
  }

  if (strict) {
    throw new LLMError(
      'none',
      errors.length ? `all providers failed: ${errors.join('; ')}` : 'no LLM provider configured',
    );
  }
  return '';
}
