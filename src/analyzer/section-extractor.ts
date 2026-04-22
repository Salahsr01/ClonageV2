import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface ExtractedSection {
  id: string;
  type: string;
  source: { domain: string; page: string };
  html: string;
  preview: string; // first 200 chars of text content
  meta: {
    hasAnimation: boolean;
    hasVideo: boolean;
    hasImage: boolean;
    estimatedHeight: string;
    classes: string[];
  };
}

export interface SectionLibrary {
  sections: ExtractedSection[];
  globalCss: Map<string, string>; // domain -> full CSS
  scripts: Map<string, string[]>; // domain -> script URLs
}

export class SectionExtractor {
  /**
   * Extract all sections from a cloned site directory.
   * Each section is a self-contained HTML block.
   * The CSS is kept globally per-domain (class names are unique per site).
   */
  extractFromClone(cloneDir: string): { sections: ExtractedSection[]; css: string; scripts: string[] } {
    const domain = path.basename(cloneDir).split('_')[0];

    // Load global CSS
    const cssPath = path.join(cloneDir, 'styles.css');
    const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';

    // Extract scripts from index.html
    const indexPath = path.join(cloneDir, 'index.html');
    const indexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf-8') : '';
    const scripts = this.extractScriptUrls(indexHtml);

    // Process each HTML file
    const htmlFiles = fs.readdirSync(cloneDir).filter(f => f.endsWith('.html'));
    const allSections: ExtractedSection[] = [];

    for (const file of htmlFiles) {
      const filePath = path.join(cloneDir, file);
      const html = fs.readFileSync(filePath, 'utf-8');
      const pageSections = this.extractSections(html, domain, file);
      allSections.push(...pageSections);
    }

    // Deduplicate sections by type (keep the best example of each)
    const deduped = this.deduplicateSections(allSections);

    logger.info(`${domain}: ${deduped.length} sections uniques extraites`);
    return { sections: deduped, css, scripts };
  }

  private extractSections(html: string, domain: string, filename: string): ExtractedSection[] {
    const sections: ExtractedSection[] = [];
    const page = filename.replace('.html', '');

    // Extract body
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;

    // Strategy 1: Split by <section> tags
    const sectionRegex = /<section[^>]*>[\s\S]*?<\/section>/gi;
    let match;
    let idx = 0;
    while ((match = sectionRegex.exec(body)) !== null) {
      const sectionHtml = match[0];
      if (sectionHtml.length < 100) continue; // skip tiny sections

      const type = this.detectType(sectionHtml);
      const preview = this.getPreview(sectionHtml);

      sections.push({
        id: `${domain}:${page}:${type}:${idx}`,
        type,
        source: { domain, page },
        html: sectionHtml,
        preview,
        meta: {
          hasAnimation: /gsap|animation|scroll-trigger|data-scroll|ScrollTrigger/i.test(sectionHtml),
          hasVideo: /<video|\.mp4|\.webm/i.test(sectionHtml),
          hasImage: /<img\s/i.test(sectionHtml),
          estimatedHeight: this.estimateHeight(sectionHtml),
          classes: this.extractTopClasses(sectionHtml),
        },
      });
      idx++;
    }

    // Strategy 2: if no sections found, try nav/header/main/footer
    if (sections.length === 0) {
      const patterns: [RegExp, string][] = [
        [/<nav[^>]*>[\s\S]*?<\/nav>/gi, 'navigation'],
        [/<header[^>]*>[\s\S]*?<\/header>/gi, 'hero'],
        [/<main[^>]*>[\s\S]*?<\/main>/gi, 'content'],
        [/<footer[^>]*>[\s\S]*?<\/footer>/gi, 'footer'],
      ];
      for (const [regex, type] of patterns) {
        let m;
        while ((m = regex.exec(body)) !== null) {
          if (m[0].length < 100) continue;
          sections.push({
            id: `${domain}:${page}:${type}:${idx}`,
            type,
            source: { domain, page },
            html: m[0],
            preview: this.getPreview(m[0]),
            meta: {
              hasAnimation: /gsap|animation|scroll-trigger/i.test(m[0]),
              hasVideo: /<video/i.test(m[0]),
              hasImage: /<img\s/i.test(m[0]),
              estimatedHeight: this.estimateHeight(m[0]),
              classes: this.extractTopClasses(m[0]),
            },
          });
          idx++;
        }
      }
    }

    return sections;
  }

  private detectType(html: string): string {
    const h = html.toLowerCase();
    if (/class="[^"]*hero/i.test(html) || (/class="[^"]*home.*slider/i.test(html))) return 'hero';
    if (/<nav\b/i.test(html) || /class="[^"]*nav[^"]*"/i.test(html) && html.length < 3000) return 'navigation';
    if (/<footer\b/i.test(html) || /class="[^"]*footer/i.test(html)) return 'footer';
    if (/class="[^"]*slider|carousel|swiper/i.test(html)) return 'slider';
    if (/class="[^"]*testimonial|review|quote/i.test(html)) return 'testimonials';
    if (/class="[^"]*gallery|grid.*project|portfolio|work|case|archive/i.test(html)) return 'portfolio';
    if (/class="[^"]*cta|contact|form/i.test(html) || /<form\b/i.test(html)) return 'contact';
    if (/class="[^"]*feature|service|solution/i.test(html)) return 'features';
    if (/class="[^"]*about|team|agency/i.test(html)) return 'about';
    if (/class="[^"]*process|step|timeline/i.test(html)) return 'process';
    if (/class="[^"]*project.*hero|project.*detail/i.test(html)) return 'project-detail';
    if (/<h1\b/i.test(html)) return 'hero';
    return 'content';
  }

  private getPreview(html: string): string {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
  }

  private estimateHeight(html: string): string {
    if (/100vh|100svh|min-height:\s*100/i.test(html)) return 'full-screen';
    const tags = (html.match(/<(?:p|h[1-6]|li|div|img|video)\b/g) || []).length;
    if (tags < 5) return 'compact';
    if (tags < 20) return 'medium';
    return 'tall';
  }

  private extractTopClasses(html: string): string[] {
    const classMatch = html.match(/^<[^>]*class="([^"]*)"/i);
    if (!classMatch) return [];
    return classMatch[1].split(/\s+/).filter(c => c.length > 2).slice(0, 5);
  }

  private extractScriptUrls(html: string): string[] {
    const urls: string[] = [];
    const regex = /<script[^>]*src="(https?:\/\/[^"]+)"[^>]*>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      urls.push(m[1]);
    }
    return urls;
  }

  private deduplicateSections(sections: ExtractedSection[]): ExtractedSection[] {
    // Keep the best (longest) section of each type per domain
    const best = new Map<string, ExtractedSection>();
    for (const s of sections) {
      const key = `${s.source.domain}:${s.type}`;
      const existing = best.get(key);
      if (!existing || s.html.length > existing.html.length) {
        best.set(key, s);
      }
    }
    return Array.from(best.values());
  }
}
