import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger.js';

export interface SiteAnalysis {
  domain: string;
  analyzedAt: string;
  pages: PageAnalysis[];
  designTokens: DesignTokens;
  animationCatalog: AnimationSnippet[];
  componentLibrary: ComponentPattern[];
  summary: SiteSummary;
}

export interface PageAnalysis {
  path: string;
  title: string;
  sections: SectionPattern[];
  layoutType: string;
}

export interface SectionPattern {
  type: string; // hero, nav, features, testimonials, gallery, cta, footer, etc.
  html: string;
  css: string;
  estimatedHeight: string;
  hasAnimation: boolean;
  hasVideo: boolean;
  hasImage: boolean;
  textContent: string;
  childCount: number;
}

export interface DesignTokens {
  colors: ColorToken[];
  fonts: FontToken[];
  spacing: string[];
  borderRadius: string[];
  shadows: string[];
}

export interface ColorToken {
  value: string;
  usage: string; // background, text, accent, border
  frequency: number;
}

export interface FontToken {
  family: string;
  weights: string[];
  usage: string; // heading, body, accent
  sizes: string[];
}

export interface AnimationSnippet {
  name: string;
  type: 'hover' | 'scroll-reveal' | 'transition' | 'loading' | 'micro-interaction';
  trigger: string;
  css: string;
  description: string;
  source: string; // which site/page it came from
}

export interface ComponentPattern {
  name: string;
  type: string; // card, slider, accordion, nav, hero, footer, etc.
  html: string;
  css: string;
  description: string;
  source: string;
}

export interface SiteSummary {
  totalPages: number;
  totalSections: number;
  totalAnimations: number;
  totalComponents: number;
  dominantColors: string[];
  primaryFont: string;
  layoutStyle: string; // minimal, magazine, grid, asymmetric, etc.
  techStack: string[];
  vibe: string; // dark-luxury, light-minimal, bold-creative, corporate-clean, etc.
}

export class Analyzer {
  private cloneDir: string;
  private cssContent: string = '';

  constructor(cloneDir: string) {
    this.cloneDir = cloneDir;
  }

  async analyze(): Promise<SiteAnalysis> {
    logger.banner();
    logger.info('Analyse du site cloné...');

    // Load CSS
    const cssPath = path.join(this.cloneDir, 'styles.css');
    if (fs.existsSync(cssPath)) {
      this.cssContent = fs.readFileSync(cssPath, 'utf-8');
    }

    // Analyze each page
    const htmlFiles = fs.readdirSync(this.cloneDir).filter(f => f.endsWith('.html'));
    const pages: PageAnalysis[] = [];

    for (const file of htmlFiles) {
      const filePath = path.join(this.cloneDir, file);
      const html = fs.readFileSync(filePath, 'utf-8');
      const page = this.analyzePage(file, html);
      pages.push(page);
      logger.info(`Analysé: ${file} (${page.sections.length} sections)`);
    }

    // Extract design tokens from CSS
    const designTokens = this.extractDesignTokens();

    // Build animation catalog
    const animationCatalog = this.extractAnimations(pages);

    // Build component library
    const componentLibrary = this.extractComponents(pages);

    // Generate summary
    const domain = path.basename(this.cloneDir).split('_')[0];
    const summary = this.generateSummary(pages, designTokens, animationCatalog, componentLibrary);

    const analysis: SiteAnalysis = {
      domain,
      analyzedAt: new Date().toISOString(),
      pages,
      designTokens,
      animationCatalog,
      componentLibrary,
      summary,
    };

    logger.success(`Analyse terminée: ${pages.length} pages, ${summary.totalSections} sections, ${summary.totalAnimations} animations, ${summary.totalComponents} composants`);

    return analysis;
  }

  private analyzePage(filename: string, html: string): PageAnalysis {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : filename;

    // Extract body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : html;

    // Detect sections by common patterns
    const sections = this.detectSections(body);

    // Determine layout type
    const layoutType = this.detectLayoutType(body);

    return {
      path: '/' + filename.replace('.html', '').replace('index', ''),
      title,
      sections,
      layoutType,
    };
  }

  private detectSections(body: string): SectionPattern[] {
    const sections: SectionPattern[] = [];

    // Split by <section> tags first
    const sectionRegex = /<section[^>]*>([\s\S]*?)<\/section>/gi;
    let match;
    while ((match = sectionRegex.exec(body)) !== null) {
      sections.push(this.analyzeSection(match[0], match[1]));
    }

    // If no <section> tags, try common div patterns
    if (sections.length === 0) {
      const divPatterns = [
        /<div[^>]*class="[^"]*(?:hero|header|banner)[^"]*"[^>]*>[\s\S]*?<\/div>\s*(?=<div|<section|<footer|$)/gi,
        /<nav[^>]*>[\s\S]*?<\/nav>/gi,
        /<header[^>]*>[\s\S]*?<\/header>/gi,
        /<footer[^>]*>[\s\S]*?<\/footer>/gi,
        /<main[^>]*>[\s\S]*?<\/main>/gi,
      ];
      for (const pattern of divPatterns) {
        let m;
        while ((m = pattern.exec(body)) !== null) {
          sections.push(this.analyzeSection(m[0], m[0]));
        }
      }
    }

    // If still nothing, treat the whole body as one section
    if (sections.length === 0) {
      sections.push(this.analyzeSection(body, body));
    }

    return sections;
  }

  private analyzeSection(fullHtml: string, innerHtml: string): SectionPattern {
    // Detect section type from classes and content
    const type = this.detectSectionType(fullHtml);

    // Extract text content (strip tags)
    const textContent = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);

    // Count children
    const childCount = (innerHtml.match(/<(?:div|section|article|aside|figure|ul|ol)\b/g) || []).length;

    return {
      type,
      html: fullHtml.substring(0, 2000), // Keep first 2000 chars for reference
      css: '', // Will be populated from CSS matching
      estimatedHeight: this.estimateHeight(fullHtml),
      hasAnimation: /gsap|animation|transition|transform|scroll-trigger|data-scroll/i.test(fullHtml),
      hasVideo: /<video|\.mp4|\.webm/i.test(fullHtml),
      hasImage: /<img|background-image/i.test(fullHtml),
      textContent: textContent.substring(0, 300),
      childCount,
    };
  }

  private detectSectionType(html: string): string {
    const lower = html.toLowerCase();
    // Check class names and content patterns
    if (/class="[^"]*hero[^"]*"/i.test(html) || /class="[^"]*banner[^"]*"/i.test(html)) return 'hero';
    if (/<nav\b/i.test(html) || /class="[^"]*nav[^"]*"/i.test(html)) return 'navigation';
    if (/<footer\b/i.test(html) || /class="[^"]*footer[^"]*"/i.test(html)) return 'footer';
    if (/class="[^"]*slider[^"]*"/i.test(html) || /class="[^"]*carousel[^"]*"/i.test(html) || /class="[^"]*swiper[^"]*"/i.test(html)) return 'slider';
    if (/class="[^"]*testimonial[^"]*"/i.test(html) || /class="[^"]*review[^"]*"/i.test(html)) return 'testimonials';
    if (/class="[^"]*gallery[^"]*"/i.test(html) || /class="[^"]*grid[^"]*"/i.test(html)) return 'gallery';
    if (/class="[^"]*cta[^"]*"/i.test(html) || /class="[^"]*contact[^"]*"/i.test(html)) return 'cta';
    if (/class="[^"]*feature[^"]*"/i.test(html) || /class="[^"]*service[^"]*"/i.test(html)) return 'features';
    if (/class="[^"]*about[^"]*"/i.test(html) || /class="[^"]*team[^"]*"/i.test(html)) return 'about';
    if (/class="[^"]*process[^"]*"/i.test(html) || /class="[^"]*step[^"]*"/i.test(html) || /class="[^"]*timeline[^"]*"/i.test(html)) return 'process';
    if (/class="[^"]*project[^"]*"/i.test(html) || /class="[^"]*work[^"]*"/i.test(html) || /class="[^"]*case[^"]*"/i.test(html) || /class="[^"]*portfolio[^"]*"/i.test(html)) return 'portfolio';
    if (/<h1\b/i.test(html) && /<video|<img/i.test(html)) return 'hero';
    if (/<form\b/i.test(html)) return 'form';
    return 'content';
  }

  private estimateHeight(html: string): string {
    if (/<video/i.test(html) || /100vh|100svh/i.test(html)) return 'full-screen';
    const tagCount = (html.match(/<(?:p|h[1-6]|li|div|img)\b/g) || []).length;
    if (tagCount < 5) return 'compact';
    if (tagCount < 15) return 'medium';
    return 'tall';
  }

  private detectLayoutType(body: string): string {
    if (/display:\s*grid/i.test(body) || /class="[^"]*grid[^"]*"/i.test(body)) return 'grid';
    if (/class="[^"]*split[^"]*"/i.test(body) || /class="[^"]*two-col[^"]*"/i.test(body)) return 'split-screen';
    if (/class="[^"]*magazine[^"]*"/i.test(body)) return 'magazine';
    if (/class="[^"]*minimal[^"]*"/i.test(body)) return 'minimal';
    return 'standard';
  }

  private extractDesignTokens(): DesignTokens {
    // Extract colors from CSS
    const colorSet = new Map<string, number>();
    const colorPatterns = [
      /(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8})/g,
      /(?:color|background(?:-color)?)\s*:\s*(rgb[a]?\([^)]+\))/g,
      /(?:color|background(?:-color)?)\s*:\s*(hsl[a]?\([^)]+\))/g,
    ];
    for (const pattern of colorPatterns) {
      let m;
      while ((m = pattern.exec(this.cssContent)) !== null) {
        const color = m[1].toLowerCase();
        colorSet.set(color, (colorSet.get(color) || 0) + 1);
      }
    }
    const colors: ColorToken[] = Array.from(colorSet.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([value, freq]) => ({
        value,
        usage: this.guessColorUsage(value, freq),
        frequency: freq,
      }));

    // Extract fonts
    const fontFamilies = new Map<string, string[]>();
    const fontRegex = /font-family\s*:\s*['"]?([^;'"}\n,]+)/g;
    let fm;
    while ((fm = fontRegex.exec(this.cssContent)) !== null) {
      const family = fm[1].trim().replace(/['"]/g, '');
      if (!family.includes('webflow-icons') && !family.includes('sans-serif') && !family.includes('monospace')) {
        if (!fontFamilies.has(family)) fontFamilies.set(family, []);
      }
    }

    // Extract font weights
    const weightRegex = /font-weight\s*:\s*(\d+|bold|normal|light)/g;
    const weights = new Set<string>();
    while ((fm = weightRegex.exec(this.cssContent)) !== null) {
      weights.add(fm[1]);
    }

    // Extract font sizes
    const sizeRegex = /font-size\s*:\s*([^;}\n]+)/g;
    const sizes = new Set<string>();
    while ((fm = sizeRegex.exec(this.cssContent)) !== null) {
      sizes.add(fm[1].trim());
    }

    const fonts: FontToken[] = Array.from(fontFamilies.keys()).map(family => ({
      family,
      weights: Array.from(weights),
      usage: family.toLowerCase().includes('display') || family.toLowerCase().includes('serif') ? 'heading' : 'body',
      sizes: Array.from(sizes).slice(0, 10),
    }));

    // Extract spacing values
    const spacingRegex = /(?:margin|padding|gap)\s*:\s*([^;}\n]+)/g;
    const spacingSet = new Set<string>();
    while ((fm = spacingRegex.exec(this.cssContent)) !== null) {
      spacingSet.add(fm[1].trim());
    }

    // Extract border-radius
    const radiusRegex = /border-radius\s*:\s*([^;}\n]+)/g;
    const radiusSet = new Set<string>();
    while ((fm = radiusRegex.exec(this.cssContent)) !== null) {
      radiusSet.add(fm[1].trim());
    }

    return {
      colors,
      fonts,
      spacing: Array.from(spacingSet).slice(0, 15),
      borderRadius: Array.from(radiusSet).slice(0, 10),
      shadows: [],
    };
  }

  private guessColorUsage(color: string, freq: number): string {
    // Simple heuristic
    if (color === '#fff' || color === '#ffffff' || color === '#000' || color === '#000000') return 'base';
    if (freq > 10) return 'primary';
    if (freq > 5) return 'secondary';
    return 'accent';
  }

  private extractAnimations(pages: PageAnalysis[]): AnimationSnippet[] {
    const animations: AnimationSnippet[] = [];

    // Extract CSS animations
    const keyframeRegex = /@keyframes\s+([^\s{]+)\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
    let m;
    while ((m = keyframeRegex.exec(this.cssContent)) !== null) {
      animations.push({
        name: m[1],
        type: 'loading',
        trigger: 'page-load',
        css: `@keyframes ${m[1]} { ${m[2].substring(0, 500)} }`,
        description: `CSS keyframe animation: ${m[1]}`,
        source: 'global CSS',
      });
    }

    // Extract transition patterns from CSS
    const transitionRegex = /([^{]+)\{[^}]*transition\s*:\s*([^;}{]+);[^}]*\}/g;
    while ((m = transitionRegex.exec(this.cssContent)) !== null) {
      const selector = m[1].trim().split('\n').pop()?.trim() || '';
      if (selector.includes(':hover') || selector.includes('.hover')) {
        animations.push({
          name: `hover-${selector.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30)}`,
          type: 'hover',
          trigger: 'hover',
          css: `${m[0].substring(0, 400)}`,
          description: `Hover transition on ${selector}`,
          source: 'global CSS',
        });
      }
    }

    // Check pages for GSAP/scroll-trigger patterns
    for (const page of pages) {
      for (const section of page.sections) {
        if (section.hasAnimation) {
          animations.push({
            name: `${section.type}-animation`,
            type: section.type === 'hero' ? 'loading' : 'scroll-reveal',
            trigger: section.type === 'hero' ? 'page-load' : 'scroll',
            css: '',
            description: `Animation detected in ${section.type} section`,
            source: page.path,
          });
        }
      }
    }

    return animations;
  }

  private extractComponents(pages: PageAnalysis[]): ComponentPattern[] {
    const components: ComponentPattern[] = [];
    const seenTypes = new Set<string>();

    for (const page of pages) {
      for (const section of page.sections) {
        // Keep one example of each section type
        if (!seenTypes.has(section.type)) {
          seenTypes.add(section.type);
          components.push({
            name: section.type,
            type: section.type,
            html: section.html,
            css: '',
            description: `${section.type} section with ${section.childCount} children. ${section.hasAnimation ? 'Animated.' : ''} ${section.hasVideo ? 'Has video.' : ''} ${section.hasImage ? 'Has images.' : ''}`,
            source: page.path,
          });
        }
      }
    }

    return components;
  }

  private generateSummary(
    pages: PageAnalysis[],
    tokens: DesignTokens,
    animations: AnimationSnippet[],
    components: ComponentPattern[]
  ): SiteSummary {
    const allSections = pages.flatMap(p => p.sections);

    // Detect vibe from colors and layout
    const darkColors = tokens.colors.filter(c => {
      const hex = c.value;
      if (hex.startsWith('#')) {
        const r = parseInt(hex.slice(1, 3), 16) || 0;
        const g = parseInt(hex.slice(3, 5), 16) || 0;
        const b = parseInt(hex.slice(5, 7), 16) || 0;
        return (r + g + b) / 3 < 80;
      }
      return false;
    });
    const isDark = darkColors.length > tokens.colors.length / 3;

    // Detect tech stack from HTML content
    const techStack: string[] = [];
    const allHtml = pages.map(p => p.sections.map(s => s.html).join('')).join('');
    if (/gsap|greensock/i.test(allHtml)) techStack.push('GSAP');
    if (/lenis/i.test(allHtml)) techStack.push('Lenis');
    if (/barba/i.test(allHtml)) techStack.push('Barba.js');
    if (/swiper/i.test(allHtml)) techStack.push('Swiper');
    if (/three/i.test(allHtml)) techStack.push('Three.js');
    if (/webflow/i.test(allHtml)) techStack.push('Webflow');
    if (/_next/i.test(allHtml)) techStack.push('Next.js');

    return {
      totalPages: pages.length,
      totalSections: allSections.length,
      totalAnimations: animations.length,
      totalComponents: components.length,
      dominantColors: tokens.colors.slice(0, 5).map(c => c.value),
      primaryFont: tokens.fonts[0]?.family || 'unknown',
      layoutStyle: isDark ? 'dark' : 'light',
      techStack,
      vibe: isDark ? 'dark-luxury' : 'light-minimal',
    };
  }
}
