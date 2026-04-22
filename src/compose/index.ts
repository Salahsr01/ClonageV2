import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { callLLM as callLLMShared } from '../utils/llm.js';
import { loadKB } from './kb-loader.js';
import { rewriteSection, extractHeadStyle } from './rewrite.js';
import { assembleHtml } from './assembler.js';
import type {
  ComposeOptions,
  ComposeResult,
  ComposeManifest,
  LLMFunction,
  LoadedSection,
} from './types.js';

const defaultLLM: LLMFunction = async (prompt: string, _section: LoadedSection) => {
  return callLLMShared({ prompt, silent: true });
};

export async function compose(opts: ComposeOptions): Promise<ComposeResult> {
  const loaded = loadKB(opts.baseSite, opts.kbRoot);
  const llm = opts.llm || defaultLLM;

  logger.info(`Composing ${loaded.sections.length} sections for "${opts.brief.brandName}"...`);

  const rewrittenList = [];
  const styleChunks: string[] = [];

  for (const sec of loaded.sections) {
    logger.step(rewrittenList.length + 1, loaded.sections.length, `Rewriting ${sec.meta.role}...`);
    const result = await rewriteSection(sec, opts.brief, loaded.index.site, llm, opts.sector);
    rewrittenList.push(result);
    const styleFromThisSec = extractHeadStyle(sec.html);
    if (styleFromThisSec) styleChunks.push(styleFromThisSec);
  }

  const mergedStyles = [...new Set(styleChunks)]
    .map((chunk) => chunk.replace(/<\/?style[^>]*>/gi, '').trim())
    .filter(Boolean);

  const finalHtml = assembleHtml({
    title: `${opts.brief.brandName} | ${opts.brief.tagline || opts.brief.industry}`,
    lang: 'fr',
    bodySections: rewrittenList.map((r) => ({ role: r.role, bodyHtml: r.bodyHtml })),
    styles: mergedStyles,
  });

  fs.mkdirSync(opts.outputDir, { recursive: true });
  const indexPath = path.join(opts.outputDir, 'index.html');
  fs.writeFileSync(indexPath, finalHtml, 'utf-8');

  const kbAssets = path.join(loaded.kbDir, 'assets');
  const outAssets = path.join(opts.outputDir, 'assets');
  if (fs.existsSync(kbAssets) && !fs.existsSync(outAssets)) {
    try {
      fs.symlinkSync(path.resolve(kbAssets), outAssets, 'dir');
    } catch {
      fs.cpSync(kbAssets, outAssets, { recursive: true });
    }
  }

  const manifest: ComposeManifest = {
    base_site: opts.baseSite,
    brand_name: opts.brief.brandName,
    industry: opts.brief.industry,
    sector: opts.sector,
    composed_at: new Date().toISOString(),
    sections: rewrittenList.map((r) => ({
      role: r.role,
      used_llm: r.usedLLM,
      original_size: r.originalSize,
      rewritten_size: r.rewrittenSize,
    })),
  };
  const manifestPath = path.join(opts.outputDir, '_compose.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

  logger.success(`Compose ecrit: ${indexPath}`);
  logger.dim(`  Manifest: ${manifestPath}`);
  logger.info(`  ${rewrittenList.filter((r) => r.usedLLM).length}/${rewrittenList.length} sections reecrites par le LLM`);

  return {
    site: loaded.index.site,
    outputDir: opts.outputDir,
    indexPath,
    manifestPath,
    sections: rewrittenList,
  };
}
