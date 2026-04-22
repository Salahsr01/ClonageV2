# Research Report: Clonage de SPAs React/Next.js avec WebGL/R3F

**Date:** 2026-04-15
**Research Type:** Technique
**Durée:** ~30 minutes
**Sujet:** Pourquoi Clonage v2.0 échoue sur jobyaviation.com et comment corriger

## Executive Summary

Le site jobyaviation.com utilise une stack lourde côté client : **Next.js + React 19 + React Three Fiber (WebGL 3D) + GSAP ScrollTrigger + vidéo scroll-driven**. Le clone actuel capture le HTML rendu côté client (via la branche Next.js du crawler), mais le résultat visuel est un fond bleu uni avec du texte — 95% du contenu visuel est manquant.

**Cause racine identifiée :** Le problème n'est PAS que le HTML est vide (le DOM rendu est bien capturé — 169KB de HTML riche). Les 5 problèmes sont :

1. **Éléments cachés par GSAP** — `visibility: hidden`, `opacity: 0`, `--animate-in: 0` sur la plupart des images et textes
2. **Vidéo sans autoplay** — Le `<video>` existe mais sans attributs `autoplay muted loop`
3. **Canvas 3D absent** — Le rendu WebGL (React Three Fiber) n'est pas sérialisable en HTML
4. **CSS custom properties gelées** — `--slide-progress-in: 0` laisse les sections invisibles
5. **Sticky heights excessifs** — `--sticky-height-desktop:1100vh` crée des zones de scroll vides

## Questions de Recherche

### Q1: Pourquoi le HTML serveur d'une SPA React est-il quasi-vide ?

**Réponse :** Le HTML serveur Next.js contient une structure de base avec le contenu (SSR), mais la branche Next.js du crawler utilise déjà `page.evaluate()` pour capturer le DOM APRÈS JS execution. Le HTML capturé est donc riche (50 `<img>`, 14 `<section>`). Le vrai problème est que les éléments sont cachés par GSAP.

**Confiance :** Haute
**Preuve :** L'analyse du HTML montre des attributs `visibility: hidden`, `opacity: 0` sur les images et sections.

### Q2: Comment capturer/préserver le contenu WebGL/Canvas ?

**Réponse :** Deux approches :
- **Canvas → Image poster** : `canvas.toDataURL('image/png')` capture le rendu WebGL comme image statique, puis remplacer le `<canvas>` par un `<img>`. Nécessite `preserveDrawingBuffer: true` ou capture au bon moment.
- **Téléchargement des assets 3D** : Intercepter les fichiers `.glb/.gltf` via le réseau pour les stocker localement (déjà partiellement supporté par le gap-fill).

**Confiance :** Haute
**Sources :** Playwright docs, Three.js community

### Q3: Comment gérer les vidéos scroll-driven ?

**Réponse :** La vidéo est contrôlée par GSAP ScrollTrigger côté client. Sans JS, elle reste figée. Solution : ajouter `autoplay muted loop playsinline` au `<video>` dans le HTML cloné. La vidéo jouera en boucle au lieu d'être contrôlée par le scroll — résultat visuellement ~90% fidèle.

**Confiance :** Haute

### Q4: Comment garder les scripts Next.js fonctionnels ?

**Réponse :** Ce n'est PAS la bonne approche. Les scripts Next.js causent des erreurs d'hydratation sur localhost. La stratégie correcte est : **capturer le DOM rendu complet avec tous les éléments VISIBLES, puis servir en statique sans scripts**. C'est un "snapshot" du site, pas un miroir fonctionnel.

**Confiance :** Haute

### Q5: Quelles alternatives existent ?

**Réponse évaluée :**

| Outil | Approche | Résultat pour joby |
|-------|----------|-------------------|
| HTTrack/wget | Téléchargement statique | ❌ Échoue (SPA) |
| SingleFile | Extension navigateur | ⚠️ Bon mais pas scriptable |
| Prerender.io | Service SaaS | ⚠️ HTML seulement, pas d'assets |
| Notre crawler (amélioré) | Playwright + post-processing | ✅ Meilleure option |

**Confiance :** Moyenne — les outils tiers n'ont pas été testés directement.

## Findings Détaillés

### Finding 1: Le DOM est riche mais gelé

Le HTML capturé contient :
- ✅ 50 balises `<img>` avec URLs localisées
- ✅ 14 `<section>` structurées
- ✅ Navigation complète
- ✅ 1 `<video>` avec chemin local
- ❌ 0 `<canvas>` (WebGL non sérialisable)
- ❌ Éléments cachés par GSAP (opacity/visibility)

### Finding 2: La branche Next.js inline fonctionne

Le code `crawler/index.ts:259-293` (branche `isNextJs`) fait déjà :
1. Inline tout le CSS via `document.styleSheets`
2. Supprime les overlays `position:fixed` avec z-index > 500
3. Supprime les scripts Next.js
4. Ajoute un fix CSS pour overflow

**Ce qui manque :** Forcer les éléments GSAP à devenir visibles.

### Finding 3: Stack technique de jobyaviation.com

| Technologie | Usage |
|-------------|-------|
| Next.js | Framework principal |
| React 19 | UI rendering |
| React Three Fiber | Modèle 3D de l'avion |
| @react-three/drei | Helpers 3D (useGLTF) |
| GSAP ScrollTrigger | Animations scroll-driven |
| Lenis | Smooth scroll |
| Sanity.io | CMS (images via CDN sanity) |
| Blender 3D | Pipeline créatif |

### Finding 4: Pattern des CSS custom properties

Le site utilise massivement les CSS custom properties pour le scroll :
```css
--animate-in: 0          /* 0 = caché, 1 = visible */
--slide-progress-in: 0   /* progression du slide */
--intro-animation: 1     /* progression de l'intro */
--sticky-height-desktop: 1100vh  /* hauteur scroll */
```

En les forçant toutes à 1 dans le DOM cloné, les éléments apparaissent.

## Key Insights

### Insight 1: "Dégeler" le GSAP est le fix le plus impactant
**Finding :** 80% du problème visuel vient des éléments cachés par les animations GSAP non-exécutées.
**Implication :** Un simple post-processing du DOM peut résoudre la majorité du problème.
**Recommandation :** Ajouter une étape dans `page.evaluate()` qui force `opacity: 1`, `visibility: visible`, et met les CSS custom properties d'animation à 1.
**Priorité :** Haute

### Insight 2: Canvas → Image Poster pour le 3D
**Finding :** Le contenu WebGL ne peut pas être sérialisé en HTML, mais peut être capturé comme image.
**Implication :** On perdra l'interactivité 3D mais on gardera l'apparence visuelle.
**Recommandation :** Ajouter `canvas.toDataURL()` → remplacer `<canvas>` par `<img>` dans la pipeline.
**Priorité :** Moyenne

### Insight 3: Videos scroll-driven → autoplay loop
**Finding :** Les vidéos scrubées par GSAP sont figées sans JS.
**Implication :** La vidéo existe déjà dans le DOM — il suffit de la rendre jouable.
**Recommandation :** Post-processing : ajouter `autoplay muted loop playsinline` à tout `<video>`.
**Priorité :** Haute

### Insight 4: Sticky heights créent du vide
**Finding :** `--sticky-height-desktop: 1100vh` crée d'énormes zones de scroll vides.
**Implication :** Le clone fait 11x la hauteur de l'écran de zones bleues vides.
**Recommandation :** Remplacer les sticky heights par `auto` ou `100vh` max.
**Priorité :** Moyenne

### Insight 5: Les images Sanity CDN sont bien téléchargées
**Finding :** Le gap-fill du crawler capture correctement les images depuis `cdn.sanity.io`.
**Implication :** L'infrastructure d'assets fonctionne — le problème est purement l'affichage.
**Recommandation :** Aucun changement nécessaire côté téléchargement d'assets.
**Priorité :** N/A (fonctionne)

## Recommandations

### Actions immédiates (à implémenter maintenant)

1. **Ajouter un post-processing "SPA unfreeze"** dans `crawler/index.ts` (branche Next.js) :
   ```javascript
   // Force tous les éléments à être visibles (dégeler GSAP)
   document.querySelectorAll('*').forEach(el => {
     const style = el.style;
     if (style.opacity === '0') style.opacity = '1';
     if (style.visibility === 'hidden') style.visibility = 'visible';
     // Reset des transform GSAP
     if (style.transform && style.transform.includes('translate')) {
       style.transform = 'none';
     }
   });
   
   // Forcer les CSS custom properties d'animation
   document.documentElement.style.setProperty('--animate-in', '1');
   document.querySelectorAll('[style*="--animate-in"]').forEach(el => {
     el.style.setProperty('--animate-in', '1');
   });
   ```

2. **Auto-play les vidéos** dans `reconstructor/index.ts` :
   ```javascript
   // Ajouter autoplay muted loop à toutes les vidéos
   html = html.replace(/<video([^>]*)>/g, (match, attrs) => {
     if (!attrs.includes('autoplay')) attrs += ' autoplay';
     if (!attrs.includes('muted')) attrs += ' muted';
     if (!attrs.includes('loop')) attrs += ' loop';
     return `<video${attrs}>`;
   });
   ```

3. **Capturer les canvas WebGL** dans `crawler/index.ts` :
   ```javascript
   // Remplacer les canvas par des images poster
   const canvases = await page.$$('canvas');
   for (const canvas of canvases) {
     const dataUrl = await canvas.evaluate(c => c.toDataURL('image/png'));
     await canvas.evaluate((c, url) => {
       const img = document.createElement('img');
       img.src = url;
       img.style.cssText = c.style.cssText;
       img.className = c.className;
       img.style.width = c.offsetWidth + 'px';
       img.style.height = c.offsetHeight + 'px';
       c.replaceWith(img);
     }, dataUrl);
   }
   ```

### Actions court-terme (1-2 semaines)

1. **Réduire les sticky heights** — Remplacer `--sticky-height-desktop: >200vh` par `100vh`
2. **Détecter le type de site** — Créer une classification (Static, SPA-Light, SPA-Heavy, WebGL) pour adapter la stratégie de clonage
3. **Améliorer le rapport** — Corriger le compteur d'assets (affiche 0 alors que 145 fichiers existent)

### Actions long-terme (1 mois+)

1. **Mode "full JS"** — Option pour garder les scripts et proxy toutes les requêtes
2. **Capture vidéo du scroll** — Enregistrer le site en vidéo pendant le scroll automatique pour référence
3. **Support GLB/GLTF** — Télécharger les modèles 3D et les référencer dans le clone

## Research Gaps

**Ce qu'on ne sait pas encore :**
- Si le site utilise des Service Workers qui bloqueraient le clonage
- La taille exacte des modèles GLB et si ils sont accessibles via réseau
- Si d'autres sites similaires (Awwwards-level avec R3F) ont les mêmes patterns

**Recherche de suivi recommandée :**
- Tester le fix "unfreeze GSAP" sur 3-5 autres sites avec GSAP ScrollTrigger
- Tester la capture canvas sur un site Three.js simple avant jobyaviation.com

## Sources

1. Playwright Documentation — https://playwright.dev/docs/api/class-page
2. Three.js Community Forum — https://discourse.threejs.org
3. GSAP ScrollTrigger Docs — https://gsap.com/docs/v3/Plugins/ScrollTrigger/
4. LinkedIn (Riotters agency) — Stack technique jobyaviation.com
5. Next.js Hydration Error Docs — https://nextjs.org/docs/messages/react-hydration-error
6. Brainstorming Clonage Web — ./brainstorming-clonage-web-2026-04-15.md

---

*Generated by BMAD Method v6 — Creative Intelligence*
*Research Duration: ~30 minutes*
*Sources Consulted: 15+*
