import * as fs from 'fs';
import { BrandBrief, CopyEntry, ImageEntry } from './types.js';

export function loadBrief(filePath: string): BrandBrief {
  const raw = fs.readFileSync(filePath, 'utf-8');
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch (err: any) { throw new Error(`brief: invalid JSON in ${filePath}: ${err.message}`); }
  return validateBrief(json);
}

export function validateBrief(input: unknown): BrandBrief {
  if (input === null || typeof input !== 'object') {
    throw new Error('brief: top-level must be a JSON object');
  }
  const b = input as Record<string, unknown>;
  const out: BrandBrief = {};

  if ('brand' in b) {
    const br = b.brand as Record<string, unknown>;
    if (!br || typeof br !== 'object') throw new Error('brief: brand must be an object');
    if (typeof br.name !== 'string') throw new Error('brief: brand.name must be a string');
    if (typeof br.source_name !== 'string') throw new Error('brief: brand.source_name must be a string');
    out.brand = { name: br.name, source_name: br.source_name };
  }

  if ('palette' in b) {
    const p = b.palette as Record<string, unknown>;
    if (!p || typeof p !== 'object') throw new Error('brief: palette must be an object');
    if (!p.map || typeof p.map !== 'object') throw new Error('brief: palette.map is required and must be an object');
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.map as Record<string, unknown>)) {
      if (typeof v !== 'string') throw new Error(`brief: palette.map["${k}"] must be a string`);
      map[k] = v;
    }
    out.palette = { map };
  }

  if ('typography' in b) {
    const t = b.typography as Record<string, unknown>;
    if (!t || typeof t !== 'object') throw new Error('brief: typography must be an object');
    out.typography = {};
    for (const role of ['primary', 'display'] as const) {
      if (role in t) {
        const r = t[role] as Record<string, unknown>;
        if (!r || typeof r !== 'object') throw new Error(`brief: typography.${role} must be an object`);
        if (typeof r.family !== 'string') throw new Error(`brief: typography.${role}.family must be a string`);
        out.typography[role] = { family: r.family, google: r.google === true };
      }
    }
  }

  if ('copy' in b) {
    if (!Array.isArray(b.copy)) throw new Error('brief: copy must be an array');
    out.copy = b.copy.map((e, i) => validateCopyEntry(e, i));
  }

  if ('images' in b) {
    if (!Array.isArray(b.images)) throw new Error('brief: images must be an array');
    out.images = b.images.map((e, i) => validateImageEntry(e, i));
  }

  return out;
}

function validateCopyEntry(e: unknown, i: number): CopyEntry {
  if (!e || typeof e !== 'object') throw new Error(`brief: copy[${i}] must be an object`);
  const ce = e as Record<string, unknown>;
  if (typeof ce.to !== 'string') throw new Error(`brief: copy[${i}].to must be a string`);
  if (typeof ce.from === 'string') return { from: ce.from, to: ce.to };
  if (typeof ce.selector === 'string') return { selector: ce.selector, to: ce.to };
  throw new Error(`brief: copy[${i}] must have either "from" or "selector"`);
}

function validateImageEntry(e: unknown, i: number): ImageEntry {
  if (!e || typeof e !== 'object') throw new Error(`brief: images[${i}] must be an object`);
  const ie = e as Record<string, unknown>;
  if (typeof ie.to !== 'string') throw new Error(`brief: images[${i}].to must be a string`);
  if (typeof ie.from === 'string') return { from: ie.from, to: ie.to };
  if (typeof ie.selector === 'string') return { selector: ie.selector, to: ie.to };
  throw new Error(`brief: images[${i}] must have either "from" or "selector"`);
}
