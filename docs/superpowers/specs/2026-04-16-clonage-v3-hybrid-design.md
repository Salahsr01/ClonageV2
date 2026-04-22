# Clonage v3.0 — Clone Vivant + Regeneration IA

**Date:** 2026-04-16
**Auteur:** Salah + Claude
**Statut:** Draft

---

## Probleme

Clonage v2.0 a deux limitations fondamentales :

1. **Clonage "snapshot mort"** — Le crawler capture le HTML, strip le JavaScript, et sert du statique. Les animations GSAP, le scroll Lenis, le 3D WebGL, les micro-interactions sont perdus. Le "degel GSAP" (`opacity:1 !important`) est un hack fragile qui ne scale pas. Certains types de sites (SPA React, Next.js lourd, WebGL/R3F) ne fonctionnent pas du tout.

2. **Generation generique** — L'IA genere du code "fonctionnel mais pas beau". Le generator/composer/reskin produisent des resultats qui n'ont pas le niveau Awwwards car : pas de feedback visuel, granularite trop grande (site entier), pas d'iteration, et les valeurs injectees sont des descriptions ("dark blue") au lieu de valeurs exactes (`#0a1628`, `cubic-bezier(0.16, 1, 0.3, 1)`).

## Solution

Une architecture hybride en 3 couches :

1. **Clone Vivant** — Garder le JavaScript vivant via HAR replay + proxy local
2. **Extraction Profonde** — Extraire tokens, animations, composants depuis le clone vivant
3. **Regeneration IA** — Generer du code neuf section par section avec boucle visuelle

---

## Architecture

```
URL
 |
 v
[Phase 1: CLONE VIVANT]
 |-- Playwright enregistre HAR complet (toutes requetes reseau)
 |-- Proxy HTTP local sert les reponses du HAR
 |-- Le site tourne avec JS vivant (GSAP, Three.js, Lenis, tout)
 |-- Pas de reecriture d'URL (le proxy intercepte en amont)
 |
 v
[Phase 2: EXTRACTION PROFONDE]
 |-- Design tokens via getComputedStyle() sur chaque element
 |   |-- Palette couleurs avec relations (fond/texte/accent)
 |   |-- Spacing scale avec detection du ratio (4px, 8px, golden)
 |   |-- Type scale avec ratio modulaire (1.2, 1.25, 1.333)
 |   |-- Border/shadow/radius values
 |-- Animations via injection dans le clone vivant
 |   |-- gsap.globalTimeline → timelines completes
 |   |-- ScrollTrigger.getAll() → scroll patterns
 |   |-- element.getAnimations() → CSS animations/keyframes
 |   |-- Transitions CSS (hover, focus) via diff computed styles
 |-- Composants via analyse DOM
 |   |-- Detection de frontieres (styling boundary, repeated patterns)
 |   |-- Classification par type (hero, card-grid, cta, testimonials)
 |   |-- Extraction du HTML + CSS isole par composant
 |-- Screenshots a N positions scroll (reference visuelle)
 |-- rrweb recording optionnel (mutations DOM pour replay)
 |
 v
[Phase 3: REGENERATION IA]
 |-- Generation multi-passes par section :
 |   |-- Pass 1: HTML semantique (structure seule)
 |   |-- Pass 2: Layout CSS Grid/Flex avec tokens exacts
 |   |-- Pass 3: Typographie + couleurs (valeurs extraites)
 |   |-- Pass 4: Animations GSAP avec timing extraits
 |   |-- Pass 5: Polish + responsive + micro-interactions
 |-- Boucle visuelle automatique :
 |   |-- Playwright screenshot du resultat
 |   |-- Claude Vision compare vs screenshot du clone vivant
 |   |-- Feedback → re-generation (3-5 iterations)
 |-- Validateur anti-generique :
 |   |-- Flag "transition: all 0.3s ease" → exiger cubic-bezier
 |   |-- Flag "border-radius: 8px" → exiger valeur du token
 |   |-- Flag couleurs hors palette
 |   |-- Flag spacing hors echelle
 |
 v
SORTIE: Site editable, code propre, qualite Awwwards
```

---

## Phase 1 : Clone Vivant

### Objectif
Produire un clone 100% fidele de n'importe quel site web, avec JavaScript vivant, animations fonctionnelles, et interactions preservees.

### Approche technique

#### 1.1 Enregistrement HAR

Utiliser la capacite native de Playwright pour enregistrer tout le trafic reseau :

```typescript
// Nouveau fichier: src/recorder/index.ts
const context = await browser.newContext({
  recordHar: {
    path: harOutputPath,
    mode: 'full',
    content: 'embed' // Embed les bodies dans le HAR
  }
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

// Scroll complet pour trigger lazy-load + ScrollTrigger
await autoScroll(page);

// Attendre que tout se charge
await page.waitForTimeout(3000);

// Fermer le context → HAR ecrit sur disque
await context.close();
```

Le HAR capture : HTML, JS, CSS, images, fonts, API responses, headers, cookies. Tout.

#### 1.2 Replay via Playwright HAR

L'approche la plus simple : utiliser `page.routeFromHAR()` natif de Playwright pour rejouer les reponses enregistrees. Pas de proxy custom, pas de reecriture d'URL — Playwright gere tout.

```typescript
// Nouveau fichier: src/replay/index.ts
export async function replayFromHar(harPath: string, url: string, port: number = 4700) {
  const browser = await chromium.launch({ headless: false }); // Navigateur VISIBLE
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 }
  });

  // Intercepter toutes les requetes et servir depuis le HAR
  await context.routeFromHAR(harPath, {
    url: '**/*',
    notFound: 'fallback' // Les requetes non-matchees vont au reseau
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Le site tourne avec JS vivant dans un vrai navigateur
  // L'utilisateur peut scroller, cliquer, interagir
  console.log(`Clone vivant en cours sur ${url}`);
  console.log('Fermez le navigateur pour arreter.');
  
  // Garder le process vivant
  await new Promise(() => {}); 
}
```

**Pourquoi Playwright HAR et pas un proxy custom :**
- Zero lignes de code proxy a ecrire — `routeFromHAR()` est natif
- Pas de configuration proxy du navigateur
- Pas de certificat HTTPS a gerer
- Le matching est intelligent (URL + method, avec fallback)
- Le navigateur est VISIBLE — l'utilisateur browse normalement

**Limitation :** Le replay necessite Playwright en cours d'execution. C'est acceptable car Clonage est un outil CLI local, pas un service de production.

#### 1.3 Lancement du clone

Le workflow utilisateur :

```bash
# Etape 1: Enregistrer
clonage record https://jobyaviation.com -o ./output/joby

# Etape 2: Rejouer (ouvre un navigateur Chromium avec HAR replay)
clonage replay ./output/joby
# → Chromium s'ouvre avec le site fonctionnel
# → JS vivant, GSAP anime, Three.js rend, Lenis scrolle
# → L'utilisateur browse normalement
```

#### 1.4 Gestion des cas speciaux

| Cas | Solution |
|-----|----------|
| HTTPS | `ignoreHTTPSErrors: true` dans le context Playwright |
| Requetes POST | Le HAR les enregistre. `routeFromHAR` matche par URL + method. |
| WebSockets | Non supporte par le HAR. Features temps reel (chat, notifications) ne marcheront pas. Acceptable pour le clonage de design. |
| Requetes non-matchees | `notFound: 'fallback'` → va au reseau (mode hybride). Ou `'abort'` pour mode offline strict. |
| Sites avec anti-bot | Utiliser `headless: false` lors du recording pour passer les challenges Cloudflare/reCAPTCHA manuellement. |

#### 1.5 Structure de sortie

```
output/domain_timestamp/
  recording.har        # HAR complet (toutes requetes/reponses)
  metadata.json        # URL, date, tech stack detectee
  screenshots/         # Captures a differentes positions scroll
  _report.md           # Rapport de clonage
```

### Fichiers a creer/modifier

| Fichier | Action | Description |
|---------|--------|-------------|
| `src/recorder/index.ts` | Creer | Enregistrement HAR via Playwright |
| `src/replay/index.ts` | Creer | Replay via Playwright `routeFromHAR` |
| `src/cli.ts` | Modifier | Ajouter commandes `record` et `replay` |
| `src/types.ts` | Modifier | Ajouter types RecordConfig, ReplayConfig |

### Ce que ca remplace

La commande `record` + `replay` remplace la pipeline actuelle `clone` pour les sites complexes (SPA, WebGL, GSAP lourd). La commande `clone` existante reste pour les sites simples (statiques, Webflow) ou elle fonctionne deja bien. Le choix est automatique via detection de tech stack, ou manuel via flag.

---

## Phase 2 : Extraction Profonde

### Objectif
Extraire depuis le clone vivant tout ce qui fait la "recette" d'un site Awwwards : tokens exacts, animations avec timings, composants avec structure.

### 2.1 Design Tokens

Injecter un script dans le clone vivant via Playwright pour extraire les styles computes :

```typescript
// Nouveau fichier: src/extractor/tokens.ts
export async function extractDesignTokens(page: Page): Promise<DesignTokens> {
  return page.evaluate(() => {
    const tokens = { colors: {}, spacing: {}, typography: {}, borders: {} };
    
    // --- COULEURS avec relations ---
    const colorMap = new Map(); // rgb → { count, contexts[] }
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const val = s[prop];
        if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
          if (!colorMap.has(val)) colorMap.set(val, { count: 0, contexts: new Set() });
          colorMap.get(val).count++;
          colorMap.get(val).contexts.add(prop);
        }
      }
    }
    // Classifier : fond (backgroundColor > 50%) → primary bg
    //              texte (color > 50%) → primary text
    //              rare + vif → accent
    
    // --- SPACING SCALE ---
    const spacingValues = [];
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      for (const prop of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap']) {
        const val = parseFloat(s[prop]);
        if (val > 0 && val < 500) spacingValues.push(val);
      }
    }
    // Detecter le ratio : val[i+1] / val[i] constant → ratio geometrique
    // Base 4px, 8px, ou custom
    
    // --- TYPE SCALE ---
    const fontSizes = new Map();
    for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,a,li,span,blockquote')) {
      const s = getComputedStyle(el);
      const size = parseFloat(s.fontSize);
      if (!fontSizes.has(size)) fontSizes.set(size, {
        lineHeight: parseFloat(s.lineHeight) / size,
        letterSpacing: s.letterSpacing,
        fontWeight: s.fontWeight,
        fontFamily: s.fontFamily,
        count: 0
      });
      fontSizes.get(size).count++;
    }
    
    return tokens;
  });
}
```

### 2.2 Animations

L'extraction se fait en 3 couches depuis le clone vivant :

**Couche 1 : GSAP (si present)**
```typescript
// src/extractor/animations.ts
export async function extractGsapAnimations(page: Page) {
  return page.evaluate(() => {
    if (!window.gsap) return null;
    
    // Extraire la timeline globale
    function walkTimeline(tl) {
      return tl.getChildren(false).map(child => {
        if (child.getChildren) {
          return { type: 'timeline', label: child.vars.id, children: walkTimeline(child) };
        }
        return {
          type: 'tween',
          targets: child.targets().map(t => generateSelector(t)),
          duration: child.duration(),
          delay: child.delay(),
          ease: child.vars.ease?.toString(),
          properties: Object.keys(child.vars).filter(k => 
            !['ease', 'duration', 'delay', 'onComplete', 'onStart'].includes(k)
          ),
          fromVars: child.vars,
          startTime: child.startTime()
        };
      });
    }
    
    const timeline = walkTimeline(gsap.globalTimeline);
    
    // Extraire les ScrollTriggers
    const scrollTriggers = (window.ScrollTrigger?.getAll() || []).map(st => ({
      trigger: generateSelector(st.trigger),
      start: st.vars.start,
      end: st.vars.end,
      scrub: st.vars.scrub,
      pin: !!st.vars.pin,
      animation: st.animation ? {
        targets: st.animation.targets().map(t => generateSelector(t)),
        duration: st.animation.duration(),
        vars: st.animation.vars
      } : null
    }));
    
    return { timeline, scrollTriggers };
  });
}
```

**Couche 2 : Web Animations API (CSS animations)**
```typescript
export async function extractCssAnimations(page: Page) {
  return page.evaluate(() => {
    return document.getAnimations().map(anim => {
      const effect = anim.effect;
      const timing = effect.getTiming();
      return {
        target: generateSelector(effect.target),
        keyframes: effect.getKeyframes(),
        timing: {
          duration: timing.duration,
          delay: timing.delay,
          easing: timing.easing,
          iterations: timing.iterations,
          fill: timing.fill
        }
      };
    });
  });
}
```

**Couche 3 : Transitions CSS (hover/focus)**
```typescript
export async function extractTransitions(page: Page) {
  return page.evaluate(() => {
    const transitions = [];
    for (const el of document.querySelectorAll('a, button, [class*="link"], [class*="btn"]')) {
      const s = getComputedStyle(el);
      if (s.transitionDuration !== '0s') {
        transitions.push({
          selector: generateSelector(el),
          properties: s.transitionProperty.split(',').map(p => p.trim()),
          durations: s.transitionDuration.split(',').map(d => d.trim()),
          easings: s.transitionTimingFunction.split(',').map(e => e.trim()),
          delays: s.transitionDelay.split(',').map(d => d.trim())
        });
      }
    }
    return transitions;
  });
}
```

### 2.3 Composants

Detection des frontieres de composants par analyse DOM :

```typescript
// src/extractor/components.ts
export async function extractComponents(page: Page) {
  return page.evaluate(() => {
    function detectComponents(root) {
      const components = [];
      
      function analyze(node, depth) {
        const children = [...node.children];
        if (children.length === 0) return;
        
        // Frontiere de composant = semantic class + styling boundary + repeated patterns
        const hasSemanticClass = /hero|nav|footer|card|grid|slider|testimonial|cta|feature|about|portfolio/.test(
          node.className?.toLowerCase() || ''
        );
        const rect = node.getBoundingClientRect();
        const isSignificant = rect.height > 100 && rect.width > window.innerWidth * 0.5;
        
        if ((hasSemanticClass || isRepeatedPattern(node, children)) && isSignificant) {
          components.push({
            selector: generateSelector(node),
            type: classifyComponent(node),
            html: node.outerHTML.substring(0, 5000), // Tronque pour les gros composants
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            childCount: children.length,
            depth
          });
        }
        
        children.forEach(c => analyze(c, depth + 1));
      }
      
      analyze(root, 0);
      return components;
    }
    
    return detectComponents(document.body);
  });
}
```

### 2.4 Structure de sortie enrichie

```
output/domain_timestamp/
  recording.har
  metadata.json
  extraction/
    design-tokens.json     # Couleurs, spacing, typo avec relations
    animations.json        # GSAP timelines, ScrollTriggers, CSS anims
    components.json        # Composants detectes avec HTML + type
    transitions.json       # Hover/focus transitions
  screenshots/
    scroll-0.png           # Viewport au scroll 0
    scroll-1000.png        # Scroll 1000px
    scroll-2000.png        # etc.
    ...
```

### Fichiers a creer/modifier

| Fichier | Action | Description |
|---------|--------|-------------|
| `src/extractor/tokens.ts` | Creer | Extraction design tokens via computed styles |
| `src/extractor/animations.ts` | Creer | Extraction GSAP + Web Animations + transitions |
| `src/extractor/components.ts` | Creer | Detection et classification de composants |
| `src/extractor/screenshots.ts` | Creer | Screenshots a N positions scroll |
| `src/cli.ts` | Modifier | Ajouter commande `extract` |
| `src/types.ts` | Modifier | Types DesignTokens, AnimationData, ComponentData |

---

## Phase 3 : Regeneration IA

### Objectif
Generer du code neuf qui reproduit la qualite visuelle du clone, avec du code propre et editable.

### 3.1 Generation multi-passes

Chaque section est generee en 5 passes. L'avantage : chaque passe est focalisee, le LLM ne dilue pas sa qualite sur trop de concerns a la fois.

**Commande CLI :**
```bash
clonage regenerate ./output/joby \
  --brief "Site pour une startup de drones de livraison" \
  --style dark \
  --sections hero,features,video,testimonials,cta,footer
```

**Pipeline interne :**

```typescript
// src/generator/regenerator.ts
export class Regenerator {
  private tokens: DesignTokens;
  private animations: AnimationData;
  private components: ComponentData[];
  private referenceScreenshots: string[]; // paths

  async regenerateSection(sectionType: string, brief: string): Promise<string> {
    // Pass 1: Structure HTML
    const html = await this.generateStructure(sectionType, brief);
    
    // Pass 2: Layout
    const withLayout = await this.applyLayout(html, sectionType);
    
    // Pass 3: Typography + Colors
    const styled = await this.applyStyle(withLayout);
    
    // Pass 4: Animations
    const animated = await this.applyAnimations(styled, sectionType);
    
    // Pass 5: Polish
    const polished = await this.polish(animated);
    
    // Validation anti-generique
    const violations = this.validate(polished);
    if (violations.length > 0) {
      return this.fixViolations(polished, violations);
    }
    
    return polished;
  }
}
```

### 3.2 Injection de valeurs exactes

Chaque prompt de generation inclut les tokens extraits comme contraintes absolues :

```
Generate a hero section. Use these EXACT design tokens (do not approximate):

TYPOGRAPHY:
- Heading: "Satoshi", 84px, weight 700, letter-spacing -0.03em, line-height 0.95
- Subtext: "Inter", 18px, weight 400, line-height 1.6, color #888888
- Body: "Inter", 16px, weight 400, line-height 1.7

COLORS:
- Background: #0a0a0a
- Primary text: #f5f5f5
- Accent: #e4ff1a
- Muted: #666666

SPACING:
- Section padding: 160px top, 120px bottom (use vh units: ~15vh)
- Content max-width: 1240px
- Element gap: 32px

ANIMATION (heading reveal):
- Split text into words, each wrapped in overflow:hidden span
- Each word: translateY(100%) → translateY(0)
- Duration: 0.9s
- Ease: cubic-bezier(0.16, 1, 0.3, 1)
- Stagger: 0.08s between words
- Use GSAP SplitText or manual split

FORBIDDEN (these make output generic):
- NO transition: all 0.3s ease
- NO border-radius: 8px
- NO box-shadow: 0 2px 4px rgba(0,0,0,0.1)
- NO centered text blocks wider than 600px
- NO Bootstrap-like 12-column grid
```

### 3.3 Boucle visuelle automatique

Apres chaque section generee, comparaison visuelle automatique :

```typescript
// src/generator/visual-loop.ts
export async function visualVerificationLoop(
  generatedHtml: string,
  referenceScreenshot: string,
  maxIterations: number = 5
): Promise<string> {
  let current = generatedHtml;
  
  for (let i = 0; i < maxIterations; i++) {
    // 1. Screenshot du code genere
    const screenshot = await takeScreenshot(current);
    
    // 2. Comparaison via Claude Vision
    const feedback = await compareScreenshots(screenshot, referenceScreenshot);
    
    // 3. Si assez proche, on arrete
    if (feedback.score >= 85) break;
    
    // 4. Sinon, on corrige
    current = await applyVisualFeedback(current, feedback.issues);
  }
  
  return current;
}

async function compareScreenshots(generated: Buffer, reference: string): Promise<Feedback> {
  // Envoyer les deux images a Claude Vision
  // Prompt : "Compare ces deux screenshots. Le premier est le code genere,
  //           le second est la reference. Score de similarite 0-100.
  //           Liste les differences visuelles a corriger."
  // Retourne { score, issues[] }
}
```

### 3.4 Validateur anti-generique

```typescript
// src/generator/validator.ts
const GENERIC_PATTERNS = [
  { pattern: /transition:\s*all\s+[\d.]+s\s+ease[^-]/g, message: 'Generic easing. Use cubic-bezier from tokens.' },
  { pattern: /border-radius:\s*8px/g, message: 'Generic radius. Use 0 or token value.' },
  { pattern: /rgba\(0,\s*0,\s*0,\s*0\.1\)/g, message: 'Generic shadow opacity. Use dramatic or none.' },
  { pattern: /padding:\s*\d{2}px\s+0/g, message: 'Fixed px padding on section. Use vh units.' },
  { pattern: /ease-in-out/g, message: 'Generic easing. Use cubic-bezier.' },
];

export function validateGenerated(code: string, tokens: DesignTokens): Violation[] {
  const violations: Violation[] = [];
  
  // Check generic patterns
  for (const { pattern, message } of GENERIC_PATTERNS) {
    if (pattern.test(code)) {
      violations.push({ type: 'generic-pattern', message });
    }
  }
  
  // Check colors against palette
  const usedColors = extractColorsFromCode(code);
  for (const color of usedColors) {
    if (!tokens.colors.palette.includes(color)) {
      violations.push({ type: 'off-palette', message: `Color ${color} not in design tokens` });
    }
  }
  
  return violations;
}
```

### Fichiers a creer/modifier

| Fichier | Action | Description |
|---------|--------|-------------|
| `src/generator/regenerator.ts` | Creer | Pipeline de regeneration multi-passes |
| `src/generator/prompts.ts` | Creer | Templates de prompts avec injection de tokens |
| `src/generator/visual-loop.ts` | Creer | Boucle de verification visuelle |
| `src/generator/validator.ts` | Creer | Validateur anti-generique |
| `src/cli.ts` | Modifier | Ajouter commande `regenerate` |

---

## Nouvelles commandes CLI

```
clonage record <url>        # Phase 1: Enregistrer HAR
  -o, --output <dir>        # Dossier de sortie
  --scroll                  # Auto-scroll (defaut: true)
  --timeout <ms>            # Timeout (defaut: 60000)

clonage replay <dir>        # Phase 1: Rejouer via proxy
  -p, --port <n>            # Port (defaut: 4700)
  --offline                 # Mode offline strict (pas de fallback)

clonage extract <dir>       # Phase 2: Extraction profonde
  --tokens                  # Extraire design tokens
  --animations              # Extraire animations
  --components              # Extraire composants
  --screenshots <n>         # Nombre de screenshots scroll (defaut: 10)
  --all                     # Tout extraire (defaut)

clonage regenerate <dir>    # Phase 3: Regeneration IA
  -b, --brief <text>        # Description du nouveau site
  --sections <list>         # Sections a generer
  --iterations <n>          # Iterations visuelles (defaut: 3)
  -o, --output <dir>        # Sortie (defaut: ./generated)
```

Les commandes existantes (`clone`, `analyze`, `search`, `generate`, `compose`, `reskin`, `kb`) restent inchangees. Les nouvelles commandes sont un chemin parallele pour les sites complexes.

---

## Plan d'implementation

### Sprint 1 : Clone Vivant (Phase 1) — ~1-2 semaines

1. Creer `src/recorder/index.ts` — enregistrement HAR via Playwright
2. Creer `src/proxy/index.ts` — proxy HTTP qui sert depuis le HAR
3. Ajouter commandes `record` et `replay` dans `src/cli.ts`
4. Tester sur les 4 sites : mersi (Webflow), ravi (UnicornStudio), icomat (Next.js), joby (React+R3F+GSAP)
5. Gerer les cas speciaux : HTTPS, CORS, requetes non-matchees

### Sprint 2 : Extraction Profonde (Phase 2) — ~1 semaine

1. Creer `src/extractor/tokens.ts` — extraction design tokens
2. Creer `src/extractor/animations.ts` — extraction GSAP + CSS animations
3. Creer `src/extractor/components.ts` — detection composants
4. Creer `src/extractor/screenshots.ts` — screenshots scroll multiples
5. Ajouter commande `extract` dans `src/cli.ts`
6. Tester sur les 4 sites, valider la richesse des donnees extraites

### Sprint 3 : Regeneration IA (Phase 3) — ~2-3 semaines

1. Creer `src/generator/regenerator.ts` — pipeline multi-passes
2. Creer `src/generator/prompts.ts` — templates avec injection tokens
3. Creer `src/generator/visual-loop.ts` — boucle visuelle
4. Creer `src/generator/validator.ts` — validateur anti-generique
5. Ajouter commande `regenerate` dans `src/cli.ts`
6. Tester : generer un site inspire de mersi avec un brief different
7. Iterer sur la qualite des prompts

### Sprint 4 : Integration + Polish — ~1 semaine

1. Auto-detection : `clone` vs `record` selon la tech stack
2. Pipeline chainee : `clonage record <url> --extract --regenerate`
3. Ameliorer le KB avec les donnees d'extraction enrichies
4. Documentation et exemples

---

## Decisions techniques

| Decision | Choix | Raison |
|----------|-------|--------|
| Format d'archive | HAR (pas WARC) | Natif Playwright, plus simple a parser, suffisant pour notre use case |
| Replay approach | Playwright `routeFromHAR()` (pas de proxy custom) | Zero code de proxy, natif Playwright, gere HTTPS/matching automatiquement |
| IA pour regeneration | Claude API (pas local) | Meilleure qualite, support Vision pour la boucle visuelle |
| Framework de sortie | HTML/CSS/JS pur + GSAP CDN | Pas de Next.js/React — le but est du code simple et editable |
| Stockage KB | JSON fichier (actuel) | Pas besoin de DB vectorielle pour le volume actuel |

---

## Risques et mitigations

| Risque | Impact | Mitigation |
|--------|--------|------------|
| HAR trop volumineux (>500MB pour sites avec beaucoup de medias) | Performance proxy | Stocker les assets volumineux (videos, images) separement, pas inline dans le HAR |
| GSAP pas accessible via `window.gsap` (bundled/minified) | Extraction animations partielle | Fallback sur Web Animations API + diff de styles avant/apres scroll |
| Cout API Claude pour la boucle visuelle | Budget | Limiter a 3 iterations par section, utiliser Haiku pour la comparaison |
| Sites avec anti-bot (Cloudflare, reCAPTCHA) | Echec du recording | Utiliser un vrai navigateur (non-headless) pour le recording initial |
| WebSockets non supportes | Features temps reel manquantes | Acceptable — on clone le design, pas les features backend |

---

## Criteres de succes

1. **Clone Vivant** : jobyaviation.com tourne localement avec GSAP animations, 3D WebGL, et scroll Lenis fonctionnels
2. **Extraction** : les design tokens extraits de mersi-architecture.com incluent le spacing scale exact, les couleurs avec roles, et les timing GSAP
3. **Regeneration** : un site genere avec le brief "agence d'architecture minimaliste" en utilisant les tokens de mersi produit du code qui, envoye a Claude Vision avec le prompt "Score de qualite visuelle 0-100 par rapport a un site Awwwards", obtient > 80/100
4. **Anti-generique** : le validateur flag 0 patterns generiques dans le code final (aucun `ease-in-out`, aucun `border-radius: 8px`, aucune couleur hors palette)
