import * as fs from 'fs';
import * as path from 'path';
import { load } from 'cheerio';
import { RebrandOptions, RebrandResult, TransformerReport } from './types.js';
import { applyBrand } from './transformers/brand.js';
import { applyPalette } from './transformers/palette.js';
import { applyTypography } from './transformers/typography.js';
import { applyCopy } from './transformers/copy.js';
import { applyImages } from './transformers/images.js';
import { logger } from '../utils/logger.js';

export async function rebrand(options: RebrandOptions): Promise<RebrandResult> {
  const inputAbs = path.resolve(options.inputHtml);
  if (!fs.existsSync(inputAbs)) {
    throw new Error(`rebrand: input HTML not found: ${inputAbs}`);
  }
  const html = fs.readFileSync(inputAbs, 'utf-8');
  const $ = load(html);

  const reports: TransformerReport[] = [];

  logger.step(1, 5, 'Brand (nom / logo text)...');
  if (options.brief.brand) reports.push(applyBrand($, options.brief.brand));
  else reports.push({ name: 'brand', applied: 0, skipped: 1, warnings: [] });

  logger.step(2, 5, 'Palette (couleurs)...');
  if (options.brief.palette) reports.push(applyPalette($, options.brief.palette));
  else reports.push({ name: 'palette', applied: 0, skipped: 1, warnings: [] });

  logger.step(3, 5, 'Typography (polices)...');
  if (options.brief.typography) reports.push(applyTypography($, options.brief.typography));
  else reports.push({ name: 'typography', applied: 0, skipped: 1, warnings: [] });

  logger.step(4, 5, 'Copy (textes)...');
  if (options.brief.copy?.length) reports.push(applyCopy($, options.brief.copy));
  else reports.push({ name: 'copy', applied: 0, skipped: 1, warnings: [] });

  logger.step(5, 5, 'Images...');
  if (options.brief.images?.length) reports.push(applyImages($, options.brief.images));
  else reports.push({ name: 'images', applied: 0, skipped: 1, warnings: [] });

  const outputPath = options.outputPath ?? defaultOutputPath(inputAbs);
  fs.writeFileSync(outputPath, $.html(), 'utf-8');

  const metadataPath = outputPath.replace(/\.html$/i, '._rebrand.json');
  fs.writeFileSync(metadataPath, JSON.stringify({
    inputHtml: inputAbs,
    outputHtml: outputPath,
    brandName: options.brief.brand?.name ?? null,
    reports,
    timestamp: new Date().toISOString(),
  }, null, 2));

  const applied = reports.reduce((s, r) => s + r.applied, 0);
  const warnings = reports.reduce((s, r) => s + r.warnings.length, 0);
  if (warnings) logger.warn(`Rebrand: ${applied} substitutions, ${warnings} warnings — voir ${metadataPath}`);
  else logger.success(`Rebrand: ${applied} substitutions — ${outputPath}`);

  return { outputHtml: outputPath, metadataPath, reports };
}

function defaultOutputPath(input: string): string {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, `${base}.rebranded.html`);
}
