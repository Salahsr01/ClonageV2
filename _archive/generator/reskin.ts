import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface ReskinConfig {
  sourceClone: string;    // path to cloned site directory
  outputDir: string;      // where to write the reskinned site
  brandName: string;      // "NOIR STUDIO"
  brandTagline?: string;  // "Design sans compromis"
  textReplacements: Record<string, string>; // original text → new text
  colorOverrides?: Record<string, string>;  // CSS color value → new value
  fontOverrides?: Record<string, string>;   // font-family → new font-family
}

export class Reskin {
  private config: ReskinConfig;

  constructor(config: ReskinConfig) {
    this.config = config;
  }

  async execute(): Promise<string> {
    logger.step(1, 3, 'Copie du clone comme base...');

    const outDir = this.config.outputDir;
    fs.mkdirSync(outDir, { recursive: true });

    // Copy the entire clone directory
    this.copyDirSync(this.config.sourceClone, outDir);
    logger.success(`Base copiée: ${path.basename(this.config.sourceClone)}`);

    // Process all HTML files
    logger.step(2, 3, 'Application du reskin...');
    const htmlFiles = this.findFiles(outDir, '.html');

    for (const htmlFile of htmlFiles) {
      let html = fs.readFileSync(htmlFile, 'utf-8');
      html = this.reskinHtml(html);
      fs.writeFileSync(htmlFile, html, 'utf-8');
    }
    logger.info(`${htmlFiles.length} pages reskinées`);

    // Process CSS
    logger.step(3, 3, 'Modification des styles...');
    const cssFiles = this.findFiles(outDir, '.css');
    for (const cssFile of cssFiles) {
      let css = fs.readFileSync(cssFile, 'utf-8');
      css = this.reskinCss(css);
      fs.writeFileSync(cssFile, css, 'utf-8');
    }
    logger.info(`${cssFiles.length} fichiers CSS modifiés`);

    // Delete the report and screenshots (they're from the original)
    const report = path.join(outDir, '_report.md');
    if (fs.existsSync(report)) fs.unlinkSync(report);
    const analysis = path.join(outDir, '_analysis.json');
    if (fs.existsSync(analysis)) fs.unlinkSync(analysis);

    logger.success(`Reskin terminé: ${outDir}`);
    return outDir;
  }

  private reskinHtml(html: string): string {
    // Text replacements must NOT touch <script> or <style> contents (they could
    // contain the brand name inside variable names, API keys, CSS selectors…
    // which would break the page). Same for tag attributes: replacing inside
    // `class="barba-wrapper"` would rename selectors scripts rely on.
    //
    // Strategy: tokenize the HTML into protected regions + plain text regions,
    // apply replacements only to plain-text regions, restore.
    const protectedBlocks: string[] = [];
    const PLACEHOLDER = (i: number) => `__RESKIN_PROTECTED_${i}__`;

    // Protect <script>…</script> and <style>…</style> (case-insensitive, multiline).
    let tokenized = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
      const i = protectedBlocks.push(m) - 1;
      return PLACEHOLDER(i);
    });

    // Protect tag attribute content: every `<foo attr="value" …>` block.
    // We match opening tags (incl. self-closing) and protect their internals.
    tokenized = tokenized.replace(/<[a-zA-Z][^>]*>/g, (m) => {
      const i = protectedBlocks.push(m) - 1;
      return PLACEHOLDER(i);
    });

    // Now tokenized only contains text-node content + placeholders. Safe to regex-replace.
    for (const [original, replacement] of Object.entries(this.config.textReplacements)) {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      tokenized = tokenized.replace(new RegExp(escaped, 'gi'), replacement);
    }

    // <title> content is actually text between tags, already handled above.
    // But the opening/closing <title> tags themselves were protected; make sure
    // the text between them also got replaced — it did, because it's a text node.

    // Restore protected blocks
    tokenized = tokenized.replace(/__RESKIN_PROTECTED_(\d+)__/g, (_m, idx) => protectedBlocks[+idx]);

    return tokenized;
  }

  private reskinCss(css: string): string {
    // Apply color overrides
    if (this.config.colorOverrides) {
      for (const [original, replacement] of Object.entries(this.config.colorOverrides)) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        css = css.replace(new RegExp(escaped, 'gi'), replacement);
      }
    }

    // Apply font overrides
    if (this.config.fontOverrides) {
      for (const [original, replacement] of Object.entries(this.config.fontOverrides)) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        css = css.replace(new RegExp(escaped, 'gi'), replacement);
      }
    }

    return css;
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        // Skip symlinks
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  private findFiles(dir: string, ext: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
        results.push(...this.findFiles(fullPath, ext));
      } else if (entry.name.endsWith(ext)) {
        results.push(fullPath);
      }
    }
    return results;
  }
}
