import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { callLLM as callLLMShared } from '../utils/llm.js';

export interface TemplateBrief {
  brandName: string;
  industry: string;     // "agence de design", "studio d'architecture", "startup tech"
  tagline: string;      // "Design sans compromis"
  description: string;  // longer description of the business
  services: string[];   // ["Branding", "Web Design", "Direction artistique"]
  projects: { name: string; category: string; description: string }[];
  contact: { email: string; phone?: string; address?: string };
  style: 'keep' | string; // 'keep' = same colors, or new color scheme description
}

export class TemplateEngine {

  /**
   * Extract a reusable template from a cloned site.
   * Keeps: HTML structure, class names, data attributes, scripts, CSS
   * Removes: specific text content, brand references
   */
  extractTemplate(cloneDir: string): { html: string; css: string; domain: string } {
    const domain = path.basename(cloneDir).split('_')[0];
    const indexPath = path.join(cloneDir, 'index.html');
    const cssPath = path.join(cloneDir, 'styles.css');

    if (!fs.existsSync(indexPath)) throw new Error(`index.html not found in ${cloneDir}`);

    const html = fs.readFileSync(indexPath, 'utf-8');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';

    return { html, css, domain };
  }

  /**
   * Build a prompt for Claude to rewrite the template with new content.
   * Claude receives the FULL HTML and must rewrite ONLY the text content,
   * keeping ALL class names, data attributes, structure, and scripts.
   */
  buildRewritePrompt(template: { html: string; css: string; domain: string }, brief: TemplateBrief): string {
    // Truncate HTML if too long (keep first 30K chars which is usually the homepage)
    const html = template.html.length > 40000
      ? template.html.substring(0, 40000) + '\n<!-- ... rest of page ... -->'
      : template.html;

    return `Tu es un expert en adaptation de sites web premium.

## TA MISSION

Tu reçois le code HTML complet d'un site web primé (niveau Awwwards).
Tu dois RÉÉCRIRE UNIQUEMENT LE CONTENU TEXTUEL pour l'adapter à un nouveau client.

## RÈGLES ABSOLUES

1. **NE MODIFIE JAMAIS** les class, id, data-*, style, ou structure HTML
2. **NE SUPPRIME JAMAIS** de balises, de sections, ou de scripts
3. **NE MODIFIE JAMAIS** les URLs d'images (garde les images du template)
4. **NE MODIFIE JAMAIS** le CSS, les <style>, ou les <script>
5. **REMPLACE UNIQUEMENT** le texte visible entre les balises
6. **GARDE** la même longueur approximative de texte (un titre court reste court)
7. **GARDE** la même langue que le brief (français)
8. Le résultat doit sembler être un VRAI site pour ce client, pas un template rempli

## NOUVEAU CLIENT

- **Nom :** ${brief.brandName}
- **Secteur :** ${brief.industry}
- **Tagline :** ${brief.tagline}
- **Description :** ${brief.description}
- **Services :** ${brief.services.join(', ')}
- **Projets :**
${brief.projects.map((p, i) => `  ${i + 1}. ${p.name} — ${p.category} — ${p.description}`).join('\n')}
- **Contact :** ${brief.contact.email}${brief.contact.phone ? ` | ${brief.contact.phone}` : ''}${brief.contact.address ? ` | ${brief.contact.address}` : ''}

## CODE HTML DU TEMPLATE (site source : ${template.domain})

Réécris ce HTML en remplaçant UNIQUEMENT le texte visible.
Renvoie le HTML COMPLET modifié, rien d'autre. Pas de commentaire, pas d'explication.

\`\`\`html
${html}
\`\`\``;
  }

  /**
   * Save the prompt and create the project directory
   */
  prepareProject(cloneDir: string, brief: TemplateBrief, outputBase: string): string {
    logger.step(1, 2, 'Extraction du template...');
    const template = this.extractTemplate(cloneDir);

    logger.step(2, 2, 'Construction du prompt de réécriture...');
    const prompt = this.buildRewritePrompt(template, brief);

    // Create output directory
    const slug = brief.brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const projectDir = path.join(outputBase, `template-${slug}`);
    fs.mkdirSync(projectDir, { recursive: true });

    // Copy the entire clone as base (so we have assets, CSS, scripts)
    this.copyDirSync(cloneDir, projectDir);

    // Save the prompt
    fs.writeFileSync(path.join(projectDir, '_rewrite-prompt.md'), prompt, 'utf-8');
    fs.writeFileSync(path.join(projectDir, '_brief.json'), JSON.stringify(brief, null, 2), 'utf-8');

    // Remove old reports
    for (const f of ['_report.md', '_analysis.json']) {
      const p = path.join(projectDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    logger.success(`Template prêt: ${projectDir}`);
    logger.info(`Prompt: ${(prompt.length / 1024).toFixed(1)}KB`);

    return projectDir;
  }

  /**
   * Full pipeline: prepare project + call Claude/HF to rewrite text content.
   * Writes the final index.html with only textual content swapped; structure,
   * classes, scripts, and CSS stay untouched (that's the whole point of the
   * clone-as-template approach per feedback_generation.md).
   */
  async execute(cloneDir: string, brief: TemplateBrief, outputBase: string): Promise<string> {
    const projectDir = this.prepareProject(cloneDir, brief, outputBase);
    const template = this.extractTemplate(cloneDir);
    const prompt = this.buildRewritePrompt(template, brief);

    logger.step(1, 1, 'Appel du LLM pour reecrire le contenu textuel...');
    const rewritten = await this.callLLM(prompt, projectDir);

    if (!rewritten) {
      logger.warn('Pas de reponse LLM — le prompt est sauvegarde, applique-le manuellement.');
      logger.dim(`  Prompt: ${path.join(projectDir, '_rewrite-prompt.md')}`);
      return projectDir;
    }

    // The LLM may wrap in ```html ... ``` or emit a full document; normalize.
    const html = this.extractHtml(rewritten);

    // Preserve all non-HTML files already copied by prepareProject (CSS, scripts,
    // assets, media). Just overwrite the index.html.
    const outPath = path.join(projectDir, 'index.html');
    fs.writeFileSync(outPath, html, 'utf-8');
    logger.success(`Index reecrit: ${outPath}`);
    return projectDir;
  }

  private async callLLM(prompt: string, projectDir: string): Promise<string> {
    return callLLMShared({ prompt, projectDir });
  }

  /**
   * Normalize an LLM response into a pure HTML document.
   * Handles: ```html fenced blocks, leading/trailing chatter, partial output.
   */
  private extractHtml(raw: string): string {
    // Prefer fenced ```html block if present
    const fenced = raw.match(/```(?:html|HTML)?\s*\n([\s\S]*?)```/);
    if (fenced) return fenced[1].trim();

    // Otherwise slice from <!DOCTYPE or <html onward
    const docIdx = raw.search(/<!DOCTYPE|<html[\s>]/i);
    if (docIdx >= 0) return raw.substring(docIdx).trim();

    // Fallback: return as-is
    return raw.trim();
  }

  private copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this.copyDirSync(s, d);
      } else if (!entry.isSymbolicLink()) {
        fs.copyFileSync(s, d);
      }
    }
  }
}
