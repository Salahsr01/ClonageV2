import * as fs from 'fs';
import * as path from 'path';
import { SiteAnalysis, SectionPattern, AnimationSnippet, ComponentPattern } from '../analyzer/index.js';
import { logger } from '../utils/logger.js';

const KB_DIR = path.join(process.cwd(), '.clonage-kb');

export interface KBEntry {
  id: string;
  domain: string;
  type: 'section' | 'animation' | 'component' | 'tokens';
  tags: string[];
  content: any;
  searchText: string; // flattened text for search
}

export class KnowledgeBase {
  private entries: KBEntry[] = [];
  private indexPath: string;

  constructor() {
    this.indexPath = path.join(KB_DIR, 'index.json');
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        this.entries = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      } catch {
        this.entries = [];
      }
    }
  }

  private save(): void {
    fs.mkdirSync(KB_DIR, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(this.entries, null, 2));
  }

  ingest(analysis: SiteAnalysis): void {
    logger.info(`Indexation de ${analysis.domain}...`);

    // Remove old entries for this domain
    this.entries = this.entries.filter(e => e.domain !== analysis.domain);

    // Index sections
    for (const page of analysis.pages) {
      for (const section of page.sections) {
        this.entries.push({
          id: `${analysis.domain}:${page.path}:${section.type}`,
          domain: analysis.domain,
          type: 'section',
          tags: [section.type, section.hasAnimation ? 'animated' : 'static', section.hasVideo ? 'video' : '', section.hasImage ? 'image' : '', section.estimatedHeight].filter(Boolean),
          content: section,
          searchText: `${section.type} ${section.textContent} ${section.estimatedHeight} ${section.hasAnimation ? 'animated' : ''} ${section.hasVideo ? 'video' : ''}`.toLowerCase(),
        });
      }
    }

    // Index animations
    for (const anim of analysis.animationCatalog) {
      this.entries.push({
        id: `${analysis.domain}:anim:${anim.name}`,
        domain: analysis.domain,
        type: 'animation',
        tags: [anim.type, anim.trigger],
        content: anim,
        searchText: `${anim.name} ${anim.type} ${anim.trigger} ${anim.description}`.toLowerCase(),
      });
    }

    // Index components
    for (const comp of analysis.componentLibrary) {
      this.entries.push({
        id: `${analysis.domain}:comp:${comp.name}`,
        domain: analysis.domain,
        type: 'component',
        tags: [comp.type],
        content: comp,
        searchText: `${comp.name} ${comp.type} ${comp.description}`.toLowerCase(),
      });
    }

    // Index design tokens as a single entry
    this.entries.push({
      id: `${analysis.domain}:tokens`,
      domain: analysis.domain,
      type: 'tokens',
      tags: [analysis.summary.vibe, analysis.summary.layoutStyle, ...analysis.summary.techStack],
      content: {
        tokens: analysis.designTokens,
        summary: analysis.summary,
      },
      searchText: `${analysis.summary.vibe} ${analysis.summary.layoutStyle} ${analysis.summary.primaryFont} ${analysis.summary.dominantColors.join(' ')} ${analysis.summary.techStack.join(' ')}`.toLowerCase(),
    });

    this.save();
    logger.success(`${this.entries.filter(e => e.domain === analysis.domain).length} entrées indexées pour ${analysis.domain}`);
  }

  search(query: string, type?: 'section' | 'animation' | 'component' | 'tokens', limit = 10): KBEntry[] {
    const queryLower = query.toLowerCase();
    const terms = queryLower.split(/\s+/);

    let filtered = this.entries;
    if (type) filtered = filtered.filter(e => e.type === type);

    // Score each entry by term matches
    const scored = filtered.map(entry => {
      let score = 0;
      for (const term of terms) {
        if (entry.searchText.includes(term)) score += 2;
        if (entry.tags.some(t => t.includes(term))) score += 3;
      }
      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }

  getSiteSummaries(): { domain: string; summary: any }[] {
    return this.entries
      .filter(e => e.type === 'tokens')
      .map(e => ({ domain: e.domain, summary: e.content.summary }));
  }

  getAnimationCatalog(): AnimationSnippet[] {
    return this.entries
      .filter(e => e.type === 'animation')
      .map(e => e.content as AnimationSnippet);
  }

  getStats(): { sites: number; sections: number; animations: number; components: number } {
    const domains = new Set(this.entries.map(e => e.domain));
    return {
      sites: domains.size,
      sections: this.entries.filter(e => e.type === 'section').length,
      animations: this.entries.filter(e => e.type === 'animation').length,
      components: this.entries.filter(e => e.type === 'component').length,
    };
  }

  buildPromptContext(brief: string, maxSections = 5): string {
    // Search for relevant sections, animations, and tokens
    const sections = this.search(brief, 'section', maxSections);
    const animations = this.search(brief, 'animation', 3);
    const tokens = this.search(brief, 'tokens', 2);

    let context = '## Patterns de référence (extraits de sites Awwwards)\n\n';

    if (tokens.length > 0) {
      const t = tokens[0].content;
      context += `### Design Tokens de référence (${tokens[0].domain})\n`;
      context += `- Vibe: ${t.summary.vibe}\n`;
      context += `- Couleurs dominantes: ${t.summary.dominantColors.join(', ')}\n`;
      context += `- Font principale: ${t.summary.primaryFont}\n`;
      context += `- Style de layout: ${t.summary.layoutStyle}\n`;
      context += `- Stack: ${t.summary.techStack.join(', ')}\n\n`;
    }

    if (sections.length > 0) {
      context += `### Sections de référence\n`;
      for (const s of sections) {
        const sec = s.content as SectionPattern;
        context += `\n#### ${sec.type} (${s.domain})\n`;
        context += `Type: ${sec.type} | Hauteur: ${sec.estimatedHeight} | Animé: ${sec.hasAnimation}\n`;
        context += `Contenu: ${sec.textContent.substring(0, 200)}\n`;
        context += `\`\`\`html\n${sec.html.substring(0, 800)}\n\`\`\`\n`;
      }
    }

    if (animations.length > 0) {
      context += `\n### Animations de référence\n`;
      for (const a of animations) {
        const anim = a.content as AnimationSnippet;
        context += `- **${anim.name}** (${anim.type}, trigger: ${anim.trigger}): ${anim.description}\n`;
        if (anim.css) context += `  \`${anim.css.substring(0, 200)}\`\n`;
      }
    }

    return context;
  }
}
