# Brainstorming Phase 2 : IA Créatrice de Sites Web

**Date :** 2026-04-15
**Objectif :** Créer une IA qui apprend des sites clonés (Awwwards, FWA) pour générer des sites web de même niveau -- animations, layout, UX, typographie, tout.
**Contexte :** Phase 1 (outil Clonage) terminée. Capable de cloner Webflow, Next.js, sites custom avec 3D/GSAP/Barba.js. Projet solo, zéro budget.

---

## Techniques utilisées

1. **Mind Mapping** -- Cartographie complète du système IA
2. **Starbursting** -- Questions critiques (Qui/Quoi/Où/Quand/Pourquoi/Comment)
3. **SCAMPER** -- Transformations créatives

---

## Architecture proposée

```
                         PIPELINE COMPLET
                              
  ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ CLONAGE │───>│ ANALYSEUR│───>│ KNOWLEDGE│───>│GÉNÉRATEUR│
  │ (Phase 1)│   │ de Clones│    │   BASE   │    │    IA    │
  └─────────┘    └──────────┘    └──────────┘    └──────────┘
                      │               │               │
                      v               v               v
                ┌──────────┐   ┌──────────┐    ┌──────────┐
                │ Patterns │   │  Embeddings│   │  Output  │
                │ Library  │   │  + Index   │   │  Évalué  │
                └──────────┘   └──────────┘    └──────────┘
```

### Module 1 : Analyseur de Clones
- Parser structurel (sections, composants, hiérarchie)
- Extracteur de design tokens (couleurs, typo, spacing)
- Détecteur d'animations (GSAP timelines, CSS transitions, scroll triggers)
- Classifieur de layouts (grid patterns, ratios, breakpoints)

### Module 2 : Knowledge Base
- Base vectorielle des sections/composants avec embeddings
- Catalogue d'animations (snippets GSAP/CSS réutilisables)
- Design systems extraits (tokens, variantes)
- Tags : catégorie, technique, difficulté, stack

### Module 3 : Générateur IA
- Prompt system structuré : brief → style reference → structure → animations → code
- RAG : recherche sémantique dans la knowledge base pour trouver les patterns pertinents
- Génération section par section (hero, features, testimonials, footer)
- Injection d'animations depuis le catalogue

### Module 4 : Boucle de Feedback
- Screenshot automatique du site généré
- Évaluation Claude Vision ("est-ce Awwwards-level ?")
- Itération automatique (3-5 rounds)
- Scoring : layout, typo, couleurs, animations, cohérence

---

## Insights clés

### 1. Le RAG sur clones est l'approche gagnante
Pas de fine-tuning. Parser les clones → extraire patterns → indexer → injecter en contexte dans les prompts.

### 2. Générer section par section
Un site = assemblage de sections. L'IA génère chaque section en piochant dans les meilleurs exemples du corpus.

### 3. Le catalogue d'animations est le différenciateur
Ce qui fait un site Awwwards = les animations. Extraire un catalogue de snippets réutilisables.

### 4. Boucle generate → screenshot → Vision → iterate
3-5 itérations automatiques pour atteindre l'excellence.

### 5. L'agent autonome comme objectif final
Brief → clone refs → extract patterns → generate → evaluate → iterate. Sans intervention humaine.

---

## Statistiques
- **Total d'idées :** 54 (après déduplication)
- **Catégories :** 7
- **Insights clés :** 5
- **Techniques appliquées :** 3

---

## Plan d'exécution recommandé

### Sprint 1 : Analyseur de Clones
- Parser HTML → extraire sections (hero, nav, grid, footer)
- Extraire design tokens (couleurs, fonts, spacing)
- Cataloguer les animations GSAP/CSS
- **Livrable :** `clonage analyze <dossier>` → rapport JSON

### Sprint 2 : Knowledge Base
- Créer embeddings par section/composant
- Indexer dans une base vectorielle locale (ex: Chroma, LanceDB)
- Système de tags et recherche
- **Livrable :** `clonage search "hero dark avec vidéo"` → top 5 exemples

### Sprint 3 : Générateur IA
- System prompt structuré avec les patterns
- RAG intégré : le prompt inclut les exemples les plus pertinents du corpus
- Génération section par section
- **Livrable :** `clonage generate "brief.md"` → projet HTML/CSS/JS

### Sprint 4 : Boucle de Feedback
- Screenshot automatique (Playwright)
- Évaluation Claude Vision
- Itération automatique
- **Livrable :** `clonage generate --iterate 5 "brief.md"` → site optimisé

---

## Prochaine étape recommandée

```
/bmad:architecture -- Concevoir l'architecture technique du Module 1 (Analyseur)
/bmad:prd -- Formaliser les requirements de la Phase 2
```

---

*Généré par BMAD Method v6 - Creative Intelligence*
