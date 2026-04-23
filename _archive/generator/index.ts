import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeBase } from '../knowledge/index.js';
import { logger } from '../utils/logger.js';
import { killExistingServer, startServer } from '../server.js';

export interface GenerateBrief {
  description: string;   // "Site pour une agence d'architecture parisienne"
  style?: string;        // "dark-luxury", "light-minimal", "bold-creative"
  sections?: string[];   // ["hero", "features", "portfolio", "testimonials", "contact", "footer"]
  reference?: string;    // Domain d'un clone comme référence
  animations?: boolean;  // Include GSAP animations
}

const SYSTEM_PROMPT = `Tu es un expert en création de sites web de niveau Awwwards.
Tu génères du HTML/CSS/JS de qualité exceptionnelle avec des animations fluides.

RÈGLES STRICTES :
1. Le code doit être COMPLET et FONCTIONNEL -- pas de placeholder, pas de "..."
2. Utilise des animations GSAP (ScrollTrigger, SplitText) pour les reveals et interactions
3. Utilise Lenis pour le smooth scroll
4. La typographie doit être soignée -- hiérarchie claire, spacing généreux
5. Le design doit être MODERNE et ORIGINAL -- pas de template Bootstrap/Tailwind générique
6. Les couleurs doivent être harmonieuses avec des contrastes forts
7. Le responsive est obligatoire (mobile-first)
8. Chaque section doit avoir des micro-interactions (hover effects, scroll reveals)
9. Le code CSS doit utiliser des variables CSS pour les design tokens
10. Charge GSAP, ScrollTrigger, SplitText, et Lenis depuis CDN

FORMAT DE SORTIE : Un seul fichier HTML complet avec CSS et JS inline.
Ne mets AUCUN commentaire de type "// Add more..." ou "<!-- More content -->".
Chaque section doit avoir du vrai contenu (même si fictif).`;

export class Generator {
  private kb: KnowledgeBase;
  private outputDir: string;

  constructor(outputDir: string = './generated') {
    this.kb = new KnowledgeBase();
    this.outputDir = outputDir;
  }

  buildPrompt(brief: GenerateBrief): string {
    // Build the context from knowledge base
    const kbContext = this.kb.buildPromptContext(
      `${brief.description} ${brief.style || ''} ${(brief.sections || []).join(' ')}`
    );

    // Build section list
    const sections = brief.sections || ['hero', 'features', 'portfolio', 'testimonials', 'contact', 'footer'];

    const prompt = `${SYSTEM_PROMPT}

${kbContext}

---

## Brief du site à générer

**Description :** ${brief.description}
**Style visuel :** ${brief.style || 'Détermine le meilleur style basé sur la description'}
**Sections à inclure :** ${sections.join(', ')}
**Animations :** ${brief.animations !== false ? 'Oui -- GSAP ScrollTrigger + hover effects + text reveals' : 'Minimales'}

## Instructions de génération

Génère un fichier HTML COMPLET avec :

1. **\`<head>\`** : meta tags, Google Fonts (choisis une combinaison serif + sans-serif premium), CSS variables
2. **CDN Scripts** (dans \`<head>\`) :
   - GSAP 3.12+ avec ScrollTrigger, SplitText
   - Lenis pour smooth scroll
3. **CSS** (dans \`<style>\`) :
   - Variables CSS pour couleurs, fonts, spacing
   - Design responsive (mobile-first)
   - Animations CSS (transitions, hover effects)
   - Layout moderne (CSS Grid + Flexbox)
4. **HTML** (dans \`<body>\`) :
   - Navigation sticky avec logo et liens
   ${sections.map(s => `- Section ${s.toUpperCase()}`).join('\n   ')}
5. **JavaScript** (dans \`<script>\` à la fin) :
   - Initialisation GSAP + ScrollTrigger
   - Text split animations (SplitText)
   - Scroll reveal animations pour chaque section
   - Hover effects sur les éléments interactifs
   - Lenis smooth scroll
   - Cursor custom (optionnel)

IMPORTANT : Le HTML doit être un fichier UNIQUE et COMPLET. Pas de fichiers externes sauf les CDN.
Génère le code MAINTENANT.`;

    return prompt;
  }

  async savePrompt(brief: GenerateBrief): Promise<string> {
    const prompt = this.buildPrompt(brief);
    fs.mkdirSync(this.outputDir, { recursive: true });

    const timestamp = new Date().toISOString().split('T')[0];
    const briefSlug = brief.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
    const promptPath = path.join(this.outputDir, `prompt-${briefSlug}-${timestamp}.md`);

    fs.writeFileSync(promptPath, prompt, 'utf-8');
    logger.success(`Prompt sauvegardé: ${promptPath}`);

    // Also save the brief
    const briefPath = path.join(this.outputDir, `brief-${briefSlug}-${timestamp}.json`);
    fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf-8');

    return promptPath;
  }

  async generate(brief: GenerateBrief): Promise<string> {
    logger.banner();
    logger.info('Génération du site...');

    const stats = this.kb.getStats();
    logger.info(`Knowledge Base: ${stats.sites} sites, ${stats.sections} sections, ${stats.animations} animations`);

    const prompt = this.buildPrompt(brief);

    // Save the prompt for reference
    fs.mkdirSync(this.outputDir, { recursive: true });
    const timestamp = new Date().toISOString().split('T')[0];
    const briefSlug = brief.description.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
    const projectDir = path.join(this.outputDir, `site-${briefSlug}-${timestamp}`);
    fs.mkdirSync(projectDir, { recursive: true });

    // Save prompt
    fs.writeFileSync(path.join(projectDir, '_prompt.md'), prompt, 'utf-8');
    fs.writeFileSync(path.join(projectDir, '_brief.json'), JSON.stringify(brief, null, 2), 'utf-8');

    logger.info(`Prompt prêt (${(prompt.length / 1024).toFixed(1)}KB de contexte)`);
    logger.info(`Dossier: ${projectDir}`);
    console.log('');
    logger.info('Pour générer le site, lance Claude Code avec le prompt :');
    logger.dim(`  cat "${path.join(projectDir, '_prompt.md')}" | claude`);
    logger.dim(`  Puis sauvegarde le résultat dans ${path.join(projectDir, 'index.html')}`);
    console.log('');
    logger.info('Ou utilise la commande intégrée :');
    logger.dim(`  npm run generate -- --brief "${brief.description}" --auto`);

    return projectDir;
  }

  getKnowledgeBaseStats() {
    return this.kb.getStats();
  }

  searchPatterns(query: string) {
    return this.kb.search(query);
  }
}
