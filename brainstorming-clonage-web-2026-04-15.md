# Brainstorming : Outil de Clonage Web pour l'Apprentissage

**Date :** 2026-04-15
**Objectif :** Créer un outil personnel capable de cloner intégralement un site web (code, styles, animations, interactions, assets) à des fins d'apprentissage -- comprendre comment les meilleurs sites sont construits en 2026.
**Contexte :** Projet solo, zéro budget, usage personnel, motivation = apprendre les techniques des sites primés (Awwwards, FWA, etc.)

---

## Techniques utilisées

1. **Mind Mapping** -- Cartographie complète de ce qu'implique un "clonage total"
2. **SCAMPER** -- Transformations créatives d'outils/concepts existants
3. **Reverse Brainstorming** -- Identifier les pièges pour en déduire les bonnes décisions

---

## Idées générées

### Catégorie 1 : Moteur de capture (le coeur)
1. Navigateur headless via Playwright comme fondation
2. Interception réseau CDP pour capturer TOUT ce qui transite
3. Multi-viewport (mobile, tablette, desktop)
4. Crawl intelligent de toutes les routes/pages
5. Enregistrement de sessions via rrweb pour les interactions
6. Capture des animations via l'Animation API
7. Exécution complète du JS avant capture du DOM

### Catégorie 2 : Extraction et analyse
8. Détection automatique de la stack (Wappalyzer-like)
9. Extraction des styles calculés (CSS computed)
10. Extraction des design tokens (couleurs, typo, spacing)
11. Identification des librairies d'animation (GSAP, Framer Motion, Lenis)
12. Analyse des source maps quand disponibles
13. CSS coverage pour éliminer le CSS inutilisé
14. Détection des breakpoints responsive

### Catégorie 3 : Reconstruction et export
15. Génération d'un projet structuré (Next.js, Astro, HTML pur)
16. Architecture en pipeline modulaire (crawl > extract > reconstruct > export)
17. Tree-shaking intelligent du code
18. Nettoyage automatique (analytics, trackers, pubs)
19. Structure de fichiers standardisée et propre
20. Export multi-format selon la stack détectée

### Catégorie 4 : Expérience d'apprentissage
21. Mode éducatif -- annotation automatique du code par IA
22. Génération de tutoriel "comment c'est fait" pour chaque site
23. Timeline visuelle des animations
24. Mode progressif couche par couche (structure > style > animation)
25. Présentation Storybook-like des composants isolés
26. Mode question : "Comment ce bouton est animé ?"
27. Transformation en exercices de code

### Catégorie 5 : Outils de comparaison et audit
28. Diff visuel pixel-perfect (original vs. clone)
29. Mode comparaison de 2 sites similaires
30. Benchmark de performance (original vs. clone)
31. Audit d'accessibilité automatique
32. Graphe de dépendances visuel

### Catégorie 6 : Interface et modes d'utilisation
33. Extension navigateur -- clic droit > "Cloner cet élément"
34. Mode granulaire -- cloner un seul composant/section
35. Mode collection -- bibliothèque personnelle de patterns
36. Versionnage des clones (évolution dans le temps)
37. Clone éditable et exécutable en local (playground)

### Catégorie 7 : Architecture technique
38. V1 ciblée sur les sites modernes statiques/SSR (pas de web apps avec auth)
39. Retry + gestion des erreurs réseau robuste
40. Accepter le "computed" plutôt que chercher le source original
41. Modules indépendants et extensibles

---

## Insights clés

### Insight 1 : Playwright + CDP est la seule fondation viable
- **Impact :** Élevé | **Effort :** Moyen
- **Source :** Mind Mapping + Reverse Brainstorming
- 90%+ des sites Awwwards sont des SPAs ou du SSR avec hydratation JS. Sans exécution JS complète via un navigateur headless, on rate l'essentiel du rendu. Le Chrome DevTools Protocol donne accès au DOM rendu, aux styles calculés, au trafic réseau, et aux animations.

### Insight 2 : Capturer le "computed", pas le "source"
- **Impact :** Élevé | **Effort :** Faible
- **Source :** SCAMPER + Reverse Brainstorming
- Le code source original est minifié, bundlé, obfusqué. Le capturer est un piège. Ce qu'on veut apprendre c'est le *résultat* : les styles calculés, le DOM rendu, les animations observées. Cette décision simplifie énormément le projet et le rend faisable par une personne seule.

### Insight 3 : Architecture en pipeline modulaire
- **Impact :** Élevé | **Effort :** Moyen
- **Source :** Reverse Brainstorming + Mind Mapping
- Découper en `Crawl → Extract → Reconstruct → Export`. Chaque module est indépendant, testable, améliorable séparément. Permet de livrer une V1 fonctionnelle rapidement et d'enrichir progressivement.

### Insight 4 : L'IA comme couche d'explication (le différenciateur)
- **Impact :** Très élevé | **Effort :** Moyen
- **Source :** SCAMPER
- Utiliser un LLM pour *analyser et expliquer* le code cloné, pas pour capturer. L'IA transforme un clone brut en leçon interactive : "Ce composant utilise GSAP ScrollTrigger pour...", "Ce layout utilise CSS Grid subgrid avec...". C'est ce qui fait passer l'outil de "copier" à "comprendre".

### Insight 5 : Extension navigateur comme interface
- **Impact :** Élevé | **Effort :** Moyen-élevé
- **Source :** SCAMPER
- Au lieu d'un CLI, une extension Chrome qui permet de cliquer sur n'importe quel élément pour le cloner/analyser. Zéro friction, interface naturelle. On navigue, on voit quelque chose, on clique.

### Insight 6 : V1 minimale -- une page, un viewport
- **Impact :** Critique | **Effort :** Faible
- **Source :** Reverse Brainstorming
- La V1 clone une seule page en desktop : structure + styles + assets. Pas d'animations, pas de multi-page. Puis itérer. Le piège mortel d'un projet ambitieux solo est de vouloir tout faire d'emblée.

---

## Statistiques
- **Total d'idées :** 41
- **Catégories :** 7
- **Insights clés :** 6
- **Techniques appliquées :** 3

---

## Prochaines étapes recommandées

### Phase immédiate
1. **Choisir un nom de projet** (suggestion : "Clonage", "WebLens", "SiteScope", "Dissect")
2. **Définir la V1 minimale** -- une commande qui prend une URL et produit un dossier avec HTML + CSS + assets
3. **Choisir la stack** : Node.js/TypeScript + Playwright semble le choix naturel

### Architecture suggérée pour la V1
```
clonage/
├── src/
│   ├── crawler/        # Playwright -- navigation et crawl
│   ├── extractor/      # CDP -- extraction DOM, styles, assets
│   ├── reconstructor/  # Reconstruction du HTML/CSS propre
│   ├── exporter/       # Génération du projet final
│   └── analyzer/       # (V2) IA pour l'analyse et l'explication
├── output/             # Sites clonés
└── cli.ts              # Interface ligne de commande
```

### Workflow recommandé
1. `/bmad:architecture` -- Concevoir l'architecture technique détaillée
2. `/bmad:prd` -- Formaliser les requirements de la V1
3. `/bmad:create-story` -- Découper en stories implémentables

---

*Généré par BMAD Method v6 - Creative Intelligence*
*Durée de la session : ~20 minutes*
