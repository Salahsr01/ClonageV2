# Brainstorming : Génération IA de sites Awwwards-level (v2)

**Date :** 2026-04-15
**Objectif :** Trouver UNE approche viable pour que l'IA CRÉE (pas copie) des sites de qualité Awwwards
**Contexte :** Phase 1 (clonage) réussie. Tentatives de génération échouées (from scratch = générique, composition = cassé, reskin = copie). KB = 239 sections de 3 sites primés.

---

## Cause racine (5 Whys)

L'IA génère du code "fonctionnel" mais pas "beau" parce que :
1. **Pas de feedback visuel** -- elle code à l'aveugle
2. **Granularité trop grande** -- un site entier au lieu d'une section
3. **Pas d'itération** -- un seul shot au lieu de raffiner

## Pipeline proposé : "Section-by-Section Visual Loop"

```
Brief
  ↓
Sélection de références (KB)
  ↓
Pour chaque section :
  ┌─────────────────────────────────┐
  │ 1. Prompt (ref screenshot +     │
  │    tokens exacts + brief)       │
  │ 2. Génération HTML/CSS          │
  │ 3. Screenshot (Playwright)      │
  │ 4. Évaluation (Claude Vision)   │
  │ 5. Feedback → re-génération     │
  │    ↻ 3-5 itérations            │
  └─────────────────────────────────┘
  ↓
Assemblage des sections
  ↓
Pass animations GSAP
  ↓
Polish global
  ↓
Site final → port 4700
```

## Les 5 insights

1. **Boucle visuelle** : generate → screenshot → Vision eval → correct (NON-NÉGOCIABLE)
2. **UNE section à la fois** : focus 100%, pas un site entier d'un coup
3. **Valeurs EXACTES** : injecter les px/ms/bezier réels des clones, pas des "patterns"
4. **3 passes** : structure (HTML) → style (CSS) → animation (JS)
5. **Design by critique** : comparer screenshot généré vs screenshot référence

---

*Généré par BMAD Method v6 - Creative Intelligence*
