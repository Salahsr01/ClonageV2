/**
 * Multi-pass AI regenerator — creates new Awwwards-level sites
 * using exact design tokens extracted from cloned sites.
 *
 * Pipeline: structure → layout → style → animations → polish
 * Each pass focuses on ONE concern to avoid quality dilution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import {
  RegenerateBrief,
  RegenerateOutput,
  DeepExtraction,
  ValidationReport,
} from '../types.js';
import {
  buildStructurePrompt,
  buildLayoutPrompt,
  buildStylePrompt,
  buildAnimationPrompt,
  buildPolishPrompt,
  buildVisualComparisonPrompt,
} from './prompts.js';
import { validateGenerated, formatValidationReport } from './validator.js';
import { logger } from '../utils/logger.js';

export class Regenerator {
  private extraction: DeepExtraction;
  private brief: RegenerateBrief;
  private outputDir: string;

  constructor(brief: RegenerateBrief, extraction: DeepExtraction, outputDir: string) {
    this.brief = brief;
    this.extraction = extraction;
    this.outputDir = outputDir;
  }

  /**
   * Reproduce the original site faithfully (not a new site).
   * Uses the extracted component HTML as reference + design tokens.
   * Can work in single-pass (full site) or chunked (section by section).
   */
  async reproduce(): Promise<RegenerateOutput> {
    fs.mkdirSync(this.outputDir, { recursive: true });

    const {
      buildReproductionPrompt,
      buildSectionReproductionPrompt,
    } = await import('./prompts.js');

    // Decide: single-pass (small sites) or chunked (large sites)
    const totalHtmlSize = this.extraction.components.reduce((s, c) => s + c.html.length, 0);
    const useChunked = totalHtmlSize > 30000; // Chunked if too much HTML for one prompt

    if (useChunked) {
      logger.info(`Site volumineux (${(totalHtmlSize / 1024).toFixed(0)}KB HTML). Reproduction section par section...`);
      return this.reproduceChunked();
    }

    // Single-pass reproduction
    const sectionTypes = [...new Set(this.extraction.components.map(c => c.type))];
    logger.step(1, 3, `Reproduction fidele (${sectionTypes.join(', ')})...`);

    const prompt = buildReproductionPrompt(
      this.extraction.components,
      this.extraction.tokens,
      this.extraction.animations,
      sectionTypes
    );

    const html = await this.callLLM(prompt, 'reproduce-full');

    // Validate
    logger.step(2, 3, 'Validation anti-generique...');
    const report = validateGenerated(html, this.extraction.tokens);
    logger.info(formatValidationReport(report));

    // Save
    logger.step(3, 3, 'Sauvegarde...');
    const outputPath = path.join(this.outputDir, 'index.html');
    fs.writeFileSync(outputPath, html, 'utf-8');
    fs.writeFileSync(
      path.join(this.outputDir, '_validation.json'),
      JSON.stringify(report, null, 2)
    );

    logger.success(`Site reproduit: ${outputPath}`);

    return {
      html,
      css: '',
      js: '',
      outputDir: this.outputDir,
      validationReport: report,
    };
  }

  /**
   * Chunked reproduction: generate each section separately, then assemble.
   */
  private async reproduceChunked(): Promise<RegenerateOutput> {
    const {
      buildSectionReproductionPrompt,
    } = await import('./prompts.js');

    // Select best component per type
    const typeMap = new Map<string, typeof this.extraction.components[0]>();
    for (const comp of this.extraction.components) {
      const existing = typeMap.get(comp.type);
      if (!existing || comp.html.length > existing.html.length) {
        typeMap.set(comp.type, comp);
      }
    }

    const sections = Array.from(typeMap.values());
    const sectionHtmls: string[] = [];

    for (let i = 0; i < sections.length; i++) {
      const comp = sections[i];
      logger.step(i + 1, sections.length + 2, `Reproduction: ${comp.type}...`);

      const prompt = buildSectionReproductionPrompt(
        comp,
        this.extraction.tokens,
        this.extraction.animations,
        i,
        sections.length
      );

      const sectionHtml = await this.callLLM(prompt, `reproduce-${comp.type}`);
      sectionHtmls.push(sectionHtml);
    }

    // Assemble all sections into a complete page
    logger.step(sections.length + 1, sections.length + 2, 'Assemblage...');
    const assembledHtml = this.assembleSections(sectionHtmls, sections.map(s => s.type));

    // Validate
    logger.step(sections.length + 2, sections.length + 2, 'Validation...');
    const report = validateGenerated(assembledHtml, this.extraction.tokens);
    logger.info(formatValidationReport(report));

    // Save
    const outputPath = path.join(this.outputDir, 'index.html');
    fs.writeFileSync(outputPath, assembledHtml, 'utf-8');
    fs.writeFileSync(
      path.join(this.outputDir, '_validation.json'),
      JSON.stringify(report, null, 2)
    );

    logger.success(`Site reproduit: ${outputPath}`);

    return {
      html: assembledHtml,
      css: '',
      js: '',
      outputDir: this.outputDir,
      validationReport: report,
    };
  }

  /**
   * Assemble independently generated sections into a complete HTML page.
   */
  private assembleSections(sectionHtmls: string[], types: string[]): string {
    // Extract <style> blocks and section HTML from each response
    const allStyles: string[] = [];
    const allSections: string[] = [];

    for (let i = 0; i < sectionHtmls.length; i++) {
      let html = sectionHtmls[i];

      // Extract style blocks
      const styleMatches = html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      for (const m of styleMatches) {
        allStyles.push(`/* ${types[i]} */\n${m[1].trim()}`);
      }

      // Remove style blocks from HTML
      html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').trim();

      // Remove full HTML wrappers if present
      html = html.replace(/<!DOCTYPE[^>]*>/i, '');
      html = html.replace(/<\/?html[^>]*>/gi, '');
      html = html.replace(/<head>[\s\S]*?<\/head>/gi, '');
      html = html.replace(/<\/?body[^>]*>/gi, '');
      html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.trim();

      if (html) allSections.push(html);
    }

    // Build tokens as CSS custom properties
    const tokens = this.extraction.tokens;
    const cssVars = [
      ...tokens.colors.backgrounds.slice(0, 3).map((c, i) => `--bg-${i}: ${c.value}`),
      ...tokens.colors.texts.slice(0, 3).map((c, i) => `--text-${i}: ${c.value}`),
      ...tokens.colors.accents.slice(0, 3).map((c, i) => `--accent-${i}: ${c.value}`),
    ].join(';\n  ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.extraction.domain} — Reproduction</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>
  <style>
  :root {
    ${cssVars};
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    background: var(--bg-0, #fff);
    color: var(--text-0, #000);
  }
  img { max-width: 100%; height: auto; display: block; }

  ${allStyles.join('\n\n')}
  </style>
</head>
<body>
  ${allSections.join('\n\n')}

  <script>
    gsap.registerPlugin(ScrollTrigger);
    // Scroll reveal on all sections
    document.querySelectorAll('section, header, footer, nav').forEach((el, i) => {
      gsap.from(el, {
        opacity: 0,
        y: 40,
        duration: 0.8,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 85%',
          toggleActions: 'play none none none'
        }
      });
    });
  </script>
</body>
</html>`;
  }

  /**
   * Run the full regeneration pipeline (new site with extracted style).
   */
  async regenerate(): Promise<RegenerateOutput> {
    fs.mkdirSync(this.outputDir, { recursive: true });

    logger.step(1, 6, 'Generation de la structure HTML...');
    const structurePrompt = buildStructurePrompt(
      this.brief.description,
      this.brief.sections,
      this.extraction.components
    );
    const html = await this.callLLM(structurePrompt, 'pass1-structure');

    logger.step(2, 6, 'Application du layout...');
    const layoutPrompt = buildLayoutPrompt(html, this.extraction.tokens);
    const layoutCss = await this.callLLM(layoutPrompt, 'pass2-layout');

    logger.step(3, 6, 'Application de la typographie et des couleurs...');
    const stylePrompt = buildStylePrompt(html, layoutCss, this.extraction.tokens);
    const styleCss = await this.callLLM(stylePrompt, 'pass3-style');

    logger.step(4, 6, 'Ajout des animations GSAP...');
    const combinedCss = `${layoutCss}\n\n/* Typography + Color */\n${styleCss}`;
    const animPrompt = buildAnimationPrompt(html, combinedCss, this.extraction.animations);
    const animJs = await this.callLLM(animPrompt, 'pass4-animations');

    logger.step(5, 6, 'Polish final...');
    const polishPrompt = buildPolishPrompt(html, combinedCss, animJs, this.brief.description);
    const finalHtml = await this.callLLM(polishPrompt, 'pass5-polish');

    // Validate the output
    logger.step(6, 6, 'Validation anti-generique...');
    const report = validateGenerated(finalHtml, this.extraction.tokens);
    logger.info(formatValidationReport(report));

    // Save the final output
    const outputPath = path.join(this.outputDir, 'index.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');

    // Save validation report
    fs.writeFileSync(
      path.join(this.outputDir, '_validation.json'),
      JSON.stringify(report, null, 2)
    );

    // If there are violations, generate a fix prompt
    if (!report.passed) {
      const fixPrompt = this.buildFixPrompt(finalHtml, report);
      this.savePrompt(fixPrompt, 'pass6-fix-violations');
      logger.warn(`${report.violations.length} violations detectees. Prompt de correction genere: pass6-fix-violations.md`);
    }

    // Run visual comparison loop if screenshots exist
    if (this.brief.maxIterations > 0) {
      await this.visualLoop(finalHtml, report);
    }

    logger.success(`Site regenere: ${outputPath}`);

    return {
      html: finalHtml,
      css: combinedCss,
      js: animJs,
      outputDir: this.outputDir,
      validationReport: report,
    };
  }

  /**
   * Try to call an LLM API. Supports HuggingFace (HF_TOKEN) and Anthropic (ANTHROPIC_API_KEY).
   * If no API key, saves prompt for manual use.
   */
  private async callLLM(prompt: string, passName: string): Promise<string> {
    // Save the prompt regardless
    this.savePrompt(prompt, passName);

    // Check if a response file already exists (manual workflow or re-run)
    const responsePath = path.join(this.outputDir, `${passName}-response.txt`);
    if (fs.existsSync(responsePath)) {
      logger.info(`Reponse existante trouvee: ${passName}-response.txt`);
      return this.extractCode(fs.readFileSync(responsePath, 'utf-8'));
    }

    // Try HuggingFace first, then Anthropic
    const hfToken = process.env.HF_TOKEN;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (hfToken) {
      return this.callHuggingFace(prompt, passName, hfToken);
    } else if (anthropicKey) {
      return this.callAnthropic(prompt, passName, anthropicKey);
    } else {
      logger.warn(`Pas de HF_TOKEN ni ANTHROPIC_API_KEY. Prompt sauvegarde: ${passName}.md`);
      logger.info(`Copiez le contenu dans un LLM et sauvez la reponse dans ${passName}-response.txt`);
      return `<!-- PLACEHOLDER: Run the prompt in ${passName}.md and save the response to ${passName}-response.txt -->`;
    }
  }

  /**
   * Call HuggingFace Inference API (OpenAI-compatible router).
   * Model: Qwen/Qwen2.5-Coder-32B-Instruct — best open-source code model, 128K context.
   */
  private async callHuggingFace(prompt: string, passName: string, token: string, attempt = 1): Promise<string> {
    const model = process.env.HF_MODEL || 'Qwen/Qwen2.5-Coder-32B-Instruct';
    const maxAttempts = 3;
    if (attempt === 1) logger.dim(`  → HuggingFace ${model.split('/').pop()}...`);
    else logger.dim(`  → Retry ${attempt}/${maxAttempts}...`);

    try {
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert frontend developer specializing in Awwwards-level websites. You write clean, production-ready HTML/CSS/JS with GSAP animations. Output ONLY code, no explanations.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 16384,
          temperature: 0.3,       // Low temperature for precise code generation
          top_p: 0.9,
          stream: false,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        // Retry on 504 (timeout) or 503 (overloaded) — common with HF free tier
        if ((response.status === 504 || response.status === 503) && attempt < maxAttempts) {
          const delay = attempt * 5000; // 5s, 10s
          logger.dim(`  ⏳ Timeout, attente ${delay / 1000}s avant retry...`);
          await new Promise(r => setTimeout(r, delay));
          return this.callHuggingFace(prompt, passName, token, attempt + 1);
        }
        logger.warn(`HuggingFace API error (${response.status}): ${err.substring(0, 200)}`);
        return `<!-- HF API ERROR ${response.status}: check ${passName}.md -->`;
      }

      const data = await response.json() as any;
      const text = data.choices?.[0]?.message?.content || '';

      if (!text) {
        logger.warn(`HuggingFace returned empty response for ${passName}`);
        return `<!-- EMPTY RESPONSE: check ${passName}.md -->`;
      }

      // Save the raw response
      fs.writeFileSync(
        path.join(this.outputDir, `${passName}-response.txt`),
        text,
        'utf-8'
      );

      logger.dim(`  ✓ ${text.length} chars received`);
      return this.extractCode(text);
    } catch (err: any) {
      logger.warn(`HuggingFace call failed: ${err.message}`);
      return `<!-- HF ERROR: ${err.message} -->`;
    }
  }

  /**
   * Call Anthropic Claude API.
   */
  private async callAnthropic(prompt: string, passName: string, apiKey: string): Promise<string> {
    logger.dim(`  → Claude API...`);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 16000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        logger.warn(`Anthropic API error (${response.status}): ${err.substring(0, 200)}`);
        return `<!-- ANTHROPIC ERROR: ${response.status} -->`;
      }

      const data = await response.json() as any;
      const text = data.content?.[0]?.text || '';

      fs.writeFileSync(
        path.join(this.outputDir, `${passName}-response.txt`),
        text,
        'utf-8'
      );

      return this.extractCode(text);
    } catch (err: any) {
      logger.warn(`Anthropic call failed: ${err.message}`);
      return `<!-- ANTHROPIC ERROR: ${err.message} -->`;
    }
  }

  /**
   * Visual comparison loop: screenshot generated site, compare to reference.
   */
  private async visualLoop(currentHtml: string, report: ValidationReport): Promise<void> {
    const refScreenshots = this.extraction.screenshotPaths.filter(p => fs.existsSync(p));
    if (refScreenshots.length === 0) {
      logger.dim('Pas de screenshots de reference — boucle visuelle ignoree.');
      return;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY; // Vision requires Anthropic (HF models don't support image input well)
    if (!apiKey) {
      logger.dim('Boucle visuelle necessite ANTHROPIC_API_KEY (vision). Screenshots sauvegardes pour comparaison manuelle.');
      // Still save the visual comparison prompt for manual use
      const vizPrompt = buildVisualComparisonPrompt();
      this.savePrompt(
        `${vizPrompt}\n\nNOTE: Take a screenshot of the generated site at ${path.join(this.outputDir, 'index.html')} and compare with the reference screenshots in the recording directory.`,
        'visual-comparison'
      );
      return;
    }

    logger.info('Boucle de verification visuelle...');

    // Take screenshot of generated site
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const htmlPath = path.join(this.outputDir, 'index.html');
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const generatedScreenshot = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(this.outputDir, '_generated-screenshot.png'), generatedScreenshot);

    await browser.close();

    // Save comparison prompt with both screenshots
    const comparisonPrompt = buildVisualComparisonPrompt();
    this.savePrompt(
      `${comparisonPrompt}\n\nGenerated screenshot saved: _generated-screenshot.png\nReference screenshots: ${refScreenshots.join(', ')}`,
      'visual-comparison'
    );

    // If API key is available, try to call Vision API
    try {
      const refImage = fs.readFileSync(refScreenshots[0]);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: generatedScreenshot.toString('base64'),
                },
              },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: refImage.toString('base64'),
                },
              },
              { type: 'text', text: comparisonPrompt },
            ],
          }],
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const feedback = data.content?.[0]?.text || '';
        fs.writeFileSync(
          path.join(this.outputDir, '_visual-feedback.json'),
          feedback,
          'utf-8'
        );

        // Parse score
        try {
          const parsed = JSON.parse(feedback);
          logger.info(`Score visuel: ${parsed.totalScore}/100`);
          if (parsed.issues?.length > 0) {
            logger.info('Issues a corriger:');
            for (const issue of parsed.issues) {
              logger.dim(`  - ${issue.description}`);
            }
          }
        } catch {
          logger.dim('Feedback visuel sauvegarde (format non-JSON)');
        }
      }
    } catch (err: any) {
      logger.dim(`Vision API error: ${err.message}`);
    }
  }

  /**
   * Build a fix prompt for validation violations.
   */
  private buildFixPrompt(html: string, report: ValidationReport): string {
    const violationList = report.violations.map(v =>
      `- ${v.message}${v.line ? ` (line ${v.line})` : ''}\n  FIX: ${v.suggestion || 'Fix this pattern'}`
    ).join('\n');

    return `
Fix these generic patterns in the following HTML page:

VIOLATIONS:
${violationList}

CURRENT CODE:
\`\`\`html
${html}
\`\`\`

Fix ALL violations listed above. Keep everything else unchanged.
Output the COMPLETE fixed HTML file.
`.trim();
  }

  /**
   * Save a prompt to a markdown file for manual use.
   */
  private savePrompt(prompt: string, name: string): void {
    const filePath = path.join(this.outputDir, `${name}.md`);
    fs.writeFileSync(filePath, prompt, 'utf-8');
  }

  /**
   * Extract code from markdown code blocks.
   */
  private extractCode(text: string): string {
    // Try to extract from ```html blocks
    const htmlMatch = text.match(/```html\n([\s\S]*?)```/);
    if (htmlMatch) return htmlMatch[1].trim();

    // Try to extract from ```css blocks
    const cssMatch = text.match(/```css\n([\s\S]*?)```/);
    if (cssMatch) return cssMatch[1].trim();

    // Try to extract from ```javascript blocks
    const jsMatch = text.match(/```(?:javascript|js)\n([\s\S]*?)```/);
    if (jsMatch) return jsMatch[1].trim();

    // Try any code block
    const anyMatch = text.match(/```\w*\n([\s\S]*?)```/);
    if (anyMatch) return anyMatch[1].trim();

    // No code block — return as-is
    return text.trim();
  }
}
