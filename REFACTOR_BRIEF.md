# REFACTOR BRIEF — Clonage v2 : Architecture ScreenCoder

> Ce document est le cahier des charges pour la refonte du pipeline post-clonage.
> **Lis-le en entier avant de taper une seule ligne de code.**
> **Ne saute aucune étape. Ne devance pas les phases.**

---

## 0. Contexte et objectif

Le pipeline actuel a deux parties :

1. **Le clonage** (`crawler/`, `reproducer-exact/`, `deep-extract/`) : **il marche parfaitement**. Pixel-perfect. On y touche pas.
2. **La reproduction / composition LLM** (`compose/`, `generator/`, `reproducer/` legacy, `rebrand-ai/`, `knowledge/` legacy) : **elle est cassée**. On l'efface.

On remplace la partie 2 par une architecture inspirée de **ScreenCoder** (paper arXiv 2507.22827, MMLab CUHK) : 3 agents spécialisés — **Grounding → Planning → Generation** — avec un atlas vectoriel en RAG et un validateur en boucle.

L'ambition finale n'est pas de "rebrander un site cloné". C'est de **composer un site neuf niveau Awwwards** à partir d'un corpus de sites primés, où le LLM joue le rôle de directeur artistique qui pioche dans une banque de sections, et un compilateur déterministe assemble les briques choisies.

---

## 1. Règles absolues — ne JAMAIS faire

1. **Ne jamais supprimer de fichier directement.** Toute suppression passe par un `git mv` vers `_archive/` avec commit dédié.
2. **Ne jamais toucher à `crawler/`, `reproducer-exact/`, `deep-extract/`, `pipeline.ts` (partie clone), `briefs/`, `output/`, `tests/rebrand/`, `tests/reproducer/`.** Ce sont les modules intouchables (voir §2).
3. **Ne jamais travailler sur `main`.** Tout se fait sur une branche `refactor/screencoder-v2`.
4. **Ne jamais demander à un LLM d'écrire du HTML complet.** Le LLM produit uniquement : des fiches JSON (Grounding), des plans JSON (Planning), des réécritures de text-nodes (text-diff dans Generation). Jamais de HTML complet.
5. **Ne jamais skipper un test qui passait avant.** Si un test de `tests/rebrand/` ou `tests/reproducer/` casse pendant le refactor, on arrête tout et on corrige.
6. **Ne jamais faire tourner le nouveau pipeline sur de vrais briefs tant que les tests e2e de chaque agent ne passent pas.**

---

## 2. Modules intouchables (à protéger absolument)

| Module | Rôle | État |
|---|---|---|
| `src/crawler/` | Crawl Playwright | Intouchable |
| `src/pipeline.ts` (partie clone uniquement) | Orchestration crawl | Intouchable |
| `src/reproducer-exact/` | Reproduction pixel-perfect | Intouchable |
| `src/deep-extract/` | KB v2 (sections autonomes, classifier, inliner) | Intouchable pour l'instant — sera utilisé comme pré-étape du nouvel agent Grounding |
| `src/recorder/` + `src/replay/` | Capture/rejeu d'interaction | Intouchable |
| `src/rebrand/` | Rebrand déterministe 5 transformers | Intouchable — il reste utile comme chemin secondaire 100% prédictible |
| `src/exporter/` | Packaging (zip, serve.sh) | Intouchable |
| `src/server.ts` | Serveur de preview localhost:4700 | Intouchable |
| `src/utils/` (logger, llm, io) | Infra commune | À conserver, éventuellement à enrichir |
| `briefs/` | Briefs de marque JSON | Intouchable |
| `output/` | Clones bruts | Intouchable |
| `.clonage-kb/` | Base de connaissance v2 | Intouchable |
| `tests/rebrand/` (58/58) | Tests déterministes | Doivent continuer à passer |
| `tests/reproducer/` | Tests du reproducer-exact | Doivent continuer à passer |

---

## 3. Modules à archiver (à ne PAS supprimer)

Créer le dossier `_archive/` à la racine. Pour chaque module archivé, créer un sous-dossier avec :
- le code original (via `git mv`)
- un fichier `WHY_ARCHIVED.md` expliquant pourquoi il a été archivé et dans quelles conditions il pourrait revenir

| Module | Raison de l'archivage |
|---|---|
| `src/compose/` | Pipeline LLM qui tronque le HTML — remplacé par Planning + Generation |
| `src/generator/` | Templating LLM qui tronque à 42 KB — remplacé par Generation déterministe |
| `src/reproducer/` (legacy v1) | Remplacé il y a longtemps par `reproducer-exact/` |
| `src/rebrand-ai/` | Approche "LLM réécrit tout" — remplacée par text-diff |
| `src/knowledge/` (KB v1) | Index plat legacy — remplacé par `deep-extract/` + atlas vectoriel |
| `src/feedback/` | Hooks jamais utilisés |
| `src/reproducer-exact/` **NON** — celui-là reste | — |
| `tests/compose/` | Tests du pipeline archivé |
| Tout fichier `.ts` à la racine de `src/` qui ne sert qu'au legacy (sauf `cli.ts`, `pipeline.ts`, `server.ts`, `types.ts`) | Archivage au cas par cas |

**Protocole d'archivage** — pour chaque module :
1. `git mv src/XXX _archive/XXX`
2. Créer `_archive/XXX/WHY_ARCHIVED.md`
3. Retirer les imports cassés dans `src/cli.ts` — commenter les commandes associées avec un TODO
4. Commit atomique : `chore: archive src/XXX (see _archive/XXX/WHY_ARCHIVED.md)`

---

## 4. L'architecture cible

### 4.1 Nouveau layout `src/`

```
src/
├── crawler/                    # intouchable
├── reproducer-exact/           # intouchable
├── deep-extract/               # intouchable (devient input de Grounding)
├── recorder/ + replay/         # intouchable
├── rebrand/                    # intouchable (chemin secondaire)
├── exporter/                   # intouchable
├── agents/                     # NOUVEAU
│   ├── grounding/              # agent ① — VLM lit les screenshots + DOM, produit fiches
│   ├── planning/               # agent ② — LLM lit atlas + brief, produit plan JSON
│   └── generation/             # agent ③ — compilateur déterministe TypeScript
├── atlas/                      # NOUVEAU — RAG vectoriel local
│   ├── embeddings.ts           # embed les fiches
│   ├── store.ts                # interface ChromaDB (ou Qdrant embedded)
│   └── query.ts                # recherche sémantique par brief
├── validator/                  # NOUVEAU
│   ├── screenshot-diff.ts      # pixelmatch
│   ├── fingerprint-check.ts    # nodes, scripts, keyframes
│   └── vision-critique.ts      # Claude Vision juge la cohérence
├── cli.ts                      # mise à jour : nouvelles commandes
├── pipeline.ts                 # mise à jour : orchestration v2
├── server.ts                   # intouchable
└── utils/                      # enrichi si besoin
```

### 4.2 Agent ① — Grounding

**Input :** un dossier de clone (sortie de `reproducer-exact/`), donc HTML + assets inline + screenshots par section.

**Process :**
1. Pour chaque section détectée par `deep-extract/`, récupérer le screenshot correspondant (ou le générer via Playwright si manquant).
2. Appeler Claude Sonnet 4.6 avec image + DOM simplifié (pas le HTML complet — juste la structure + classes).
3. Demander en retour un JSON strict :

```json
{
  "role": "hero | navbar | works | about | cta | contact | ...",
  "mood": ["moody", "minimal", "playful", "editorial", "brutalist", ...],
  "animations": [{ "type": "scroll-pin|stagger|magnetic|split-text|...", "library": "gsap|framer|lenis|none" }],
  "palette_dominant": ["#0a1628", "#e5c07b", ...],
  "typo": { "display": "family-name", "body": "family-name", "axes": [...] },
  "layout": { "composition": "fullscreen|split|masonry|centered|asymmetric|...", "density": "tight|airy|spacious" },
  "signature": "1 phrase FR qui décrit ce que la section fait de spécial",
  "usable_as": ["list of roles this section could fill in another site"]
}
```

**Output :** un fichier `<section>.ground.json` à côté de chaque section dans `.clonage-kb/`.

**Cache :** hash du HTML de la section → si inchangé, pas de re-appel LLM.

**Contraintes :**
- **Ne JAMAIS** produire de HTML ici.
- **Valider** le JSON de sortie contre un schéma (zod). Si invalide : retry max 2 avec feedback.
- **Coût max par section** : 1 appel LLM. Si le cache est chaud, 0.

### 4.3 Atlas vectoriel (RAG local)

**Stack recommandée :** ChromaDB en mode embedded (pur JS, pas de serveur), ou Qdrant en local via docker compose.

**Contenu indexé :**
- 1 vecteur par section (embedding de `signature + role + mood + layout`)
- Métadonnées complètes (le JSON de grounding en entier)
- Filtres par rôle, mood, site source

**Embedding model :**
- Par défaut : `text-embedding-3-small` (OpenAI, $0.02/1M tokens).
- Option offline : modèle `all-MiniLM-L6-v2` via `@xenova/transformers` en local.

**Interface :**
```ts
atlas.query({
  brief: "studio d'architecture moody à Paris",
  roleFilter: "hero",
  moodFilter: ["moody", "editorial"],
  topK: 5
}) → Array<GroundedSection>
```

### 4.4 Agent ② — Planning

**Input :** un brief de marque JSON (format actuel, voir `briefs/nova-aerospace.json`) + l'atlas interrogeable.

**Process :**
1. Pour chaque rôle narratif canonique (`navbar, hero, about, works, services, cta, contact, footer`), interroger l'atlas avec le brief pour récupérer top-5 candidates par rôle.
2. Passer au LLM un payload compact : le brief + les candidates par rôle (avec leurs `signature + mood + palette`).
3. Demander un plan JSON :

```json
{
  "sections": [
    { "role": "navbar", "source": "mersi#navbar-split", "reason": "..." },
    { "role": "hero", "source": "raviklaassens#hero-video", "reason": "..." },
    ...
  ],
  "design_constraints": {
    "palette_reference": "mersi",     // quelle source impose la palette finale
    "typo_reference": "jobyaviation",  // quelle source impose la typo finale
    "rhythm_reference": "raviklaassens" // quelle source impose le spacing vertical
  },
  "coherence_notes": "1 paragraphe sur pourquoi cette composition tient"
}
```

**Output :** `generated/<brand>/_plan.json`

**Validation :** schéma zod strict. Si sources mentionnées n'existent pas dans l'atlas : rejet + retry avec feedback.

**🔑 MODE PLAN APPROVAL** (critique) :
- Le CLI expose `clonage plan --brief X` qui produit seulement le plan, sans déclencher Generation.
- Le plan est imprimé lisiblement dans le terminal + écrit sur disque.
- L'utilisateur peut éditer le fichier `_plan.json` (remplacer une source, retirer une section).
- Une commande `clonage generate <plan.json>` relit le plan modifié et lance Generation.
- **Generation ne se lance jamais automatiquement après Planning.**

### 4.5 Agent ③ — Generation (compilateur déterministe)

**Input :** un plan JSON validé + le brief.

**Process (zéro LLM dans cette phase) :**
1. Pour chaque section du plan, charger son HTML depuis `.clonage-kb/`.
2. Appliquer un **text-diff LLM** sur les text-nodes uniquement (comme ton `src/compose/rewrite-text.ts` actuel mais en isolé — récupérer ce code, l'archiver avec `compose/` mais en copier la logique pure dans `agents/generation/text-diff.ts`).
3. Remapper les tokens :
   - palette → utiliser celle de `palette_reference`
   - typo → utiliser celle de `typo_reference`
   - spacing → utiliser celui de `rhythm_reference`
4. Concaténer les sections dans l'ordre du plan, en fusionnant `<head>` (deduplication styles/scripts/fonts).
5. Sortir un seul `index.html` + dossier `assets/`.

**Output :** `generated/<brand>/index.html`

**Contraintes :**
- Le HTML de chaque section vient d'un fichier réel, pas d'un LLM. Donc scripts et animations sont intacts par construction.
- Le text-diff modifie uniquement des text-nodes (`cheerio` walk). Zéro structure modifiée.
- Si un conflit de nommage CSS entre sections : préfixer avec un hash de section (`.s-{hash}-classname`).

### 4.6 Validateur (boucle)

**Input :** le site généré + les sections sources.

**Process :**
1. Lancer Playwright, screenshot le site généré section par section.
2. Pour chaque section, comparer le screenshot au screenshot source avec `pixelmatch` — tolérance 5%.
3. Si diff visuel > 5%, appeler Claude Vision en lui donnant les 2 screenshots : "est-ce que la composition est cohérente ?" → verdict binaire + raison.
4. Si verdict négatif : feedback structuré → retry Planning avec exclusions (la section incriminée ne peut plus être choisie).

**Retry cap :** 3 itérations maximum. Au-delà, on écrit un rapport d'échec et on s'arrête.

---

## 5. Garde-fous

1. **Branche git :** tout se passe sur `refactor/screencoder-v2`. Ne jamais merger dans `main` sans que l'utilisateur (moi) valide.
2. **Commit atomique :** un commit = un changement unitaire. Pas de commit "wip big refactor".
3. **Tests :** chaque agent a son test e2e dans `tests/agents/<agent>/`. Le test passe avant qu'on passe à l'agent suivant.
4. **CI locale :** `npm test` doit passer à la fin de chaque semaine de travail.
5. **Documentation :** chaque agent a un `README.md` dans son dossier qui explique input/output/cache.
6. **Pas de suppression :** zéro `rm`. Tout archivage passe par `git mv` vers `_archive/`.
7. **Config clé :** toutes les clés API (Anthropic, OpenAI) via `.env`, jamais hardcodées. Mettre à jour `.gitignore` si besoin.

---

## 6. Ordre de travail — 6 semaines

> Respecter l'ordre. Ne pas devancer.

### Semaine 1 — Nettoyage et setup

1. Créer la branche `refactor/screencoder-v2`.
2. Créer `_archive/` à la racine.
3. Pour chaque module listé en §3 : archiver selon le protocole (§3).
4. Mettre à jour `src/cli.ts` : commenter les commandes pointant vers les modules archivés, avec `// TODO: rewire to agents/ in S4-S5`.
5. Créer la structure vide de `src/agents/grounding/`, `src/agents/planning/`, `src/agents/generation/`, `src/atlas/`, `src/validator/` avec chacun un `README.md` vide et un `index.ts` exportant un stub.
6. Créer `tests/agents/` avec des fixtures (copier 2 clones connus depuis `output/` vers `tests/agents/fixtures/`).
7. Lire le paper ScreenCoder (arXiv 2507.22827) et écrire un résumé de 500 mots dans `docs/screencoder-notes.md`.

**Critère de fin S1 :**
- `npm test` passe toujours (rebrand + reproducer).
- `git log` montre un commit par module archivé.
- Le dossier `_archive/` contient tous les modules listés en §3.

### Semaine 2 — Agent Grounding

1. Écrire le schéma zod pour la fiche de section.
2. Implémenter `agents/grounding/index.ts` :
   - Input : chemin d'un clone (output de `reproducer-exact`).
   - Utilise `deep-extract` pour segmenter.
   - Pour chaque section, génère ou récupère screenshot.
   - Appelle Claude Sonnet 4.6 Vision avec image + DOM simplifié.
   - Valide output contre zod.
   - Écrit `.ground.json` à côté de chaque section.
3. Implémenter le cache (hash du HTML).
4. Test e2e : sur 2 clones fixtures, produire les fiches et vérifier qu'elles ont les champs attendus.

**Critère de fin S2 :**
- Sur `output/www.mersi-architecture.com_2026-04-17/`, l'agent produit au moins 4 fiches JSON valides.
- Les fiches contiennent `role`, `mood`, `animations` non vides.

### Semaine 3 — Atlas vectoriel

1. Choisir le backend : ChromaDB embedded (recommandé) ou Qdrant Docker.
2. Implémenter `atlas/embeddings.ts` (embedding via OpenAI ou Xenova local).
3. Implémenter `atlas/store.ts` (CRUD sections + métadonnées).
4. Implémenter `atlas/query.ts` (recherche sémantique avec filtres).
5. CLI : `clonage atlas index <clone-dir>` pour alimenter l'atlas.
6. CLI : `clonage atlas search --query "..." --role hero` pour debug.
7. Test e2e : indexer 3 clones, faire 5 requêtes, vérifier les top-K sont cohérents.

**Critère de fin S3 :**
- Une requête `"studio d'architecture moody"` avec filtre `role=hero` retourne 3+ candidats classés par pertinence.

### Semaine 4 — Agent Planning + mode approval

1. Écrire le schéma zod du plan.
2. Implémenter `agents/planning/index.ts` : brief → query atlas par rôle → LLM compose plan JSON.
3. Ajouter CLI `clonage plan --brief X -o generated/Y/_plan.json`.
4. Ne PAS chaîner vers Generation automatiquement.
5. Ajouter une sortie terminal lisible (table ASCII) du plan.
6. Test e2e : sur 3 briefs différents, le plan ne mentionne jamais la marque source ("mersi", "icomat", etc.) dans les `reason`.

**Critère de fin S4 :**
- 3 briefs → 3 plans distincts, chacun cohérent.
- L'utilisateur peut éditer `_plan.json` à la main et la structure reste valide.

### Semaine 5 — Agent Generation

1. Copier la logique text-diff de `_archive/compose/rewrite-text.ts` vers `agents/generation/text-diff.ts`.
2. Implémenter le loader de sections depuis `.clonage-kb/`.
3. Implémenter le remapper de tokens (palette / typo / spacing) — réutiliser `rebrand/` comme source d'inspiration pour les transformers.
4. Implémenter l'assembleur de sections (dedup `<head>`, préfixage CSS si conflit).
5. CLI `clonage generate <plan.json>` → produit `generated/<brand>/`.
6. Test e2e : sur un plan validé S4, le HTML final contient tous les `<script>` des sections sources, tous les `@keyframes`, et toutes les sections du plan.

**Critère de fin S5 :**
- Fingerprint DOM de chaque section dans le livrable : ±5% de l'original.
- Aucun `<script>` du source manquant dans la sortie.
- `npm run serve generated/<brand>` ouvre un site cliquable.

### Semaine 6 — Validateur + boucle

1. Implémenter `validator/screenshot-diff.ts` avec `pixelmatch`.
2. Implémenter `validator/fingerprint-check.ts`.
3. Implémenter `validator/vision-critique.ts` (Claude Vision).
4. Brancher le validateur après Generation : si échec, retry Planning avec exclusions.
5. Cap à 3 itérations.
6. CLI `clonage compose --brief X` qui orchestre : plan → approval prompt terminal → generate → validate → retry si besoin.

**Critère de fin S6 :**
- Un brief réel → site final cohérent sans intervention manuelle dans 80% des cas.
- Quand ça échoue, un rapport `_failure_report.json` explique pourquoi.

---

## 7. Références obligatoires à lire avant de coder

- **ScreenCoder paper :** https://arxiv.org/abs/2507.22827
- **ScreenCoder GitHub :** https://github.com/leigest519/ScreenCoder
- **ChromaDB docs :** https://docs.trychroma.com/
- **Pixelmatch :** https://github.com/mapbox/pixelmatch
- **Anthropic Vision API :** https://platform.claude.com/docs/en/build-with-claude/vision
- **Le README actuel du projet** (racine) — pour comprendre l'existant

---

## 8. Check final avant de démarrer

Avant de taper une ligne de code, réponds à ces 4 questions en commentaire du premier commit de la branche :

1. As-tu lu en entier ce REFACTOR_BRIEF.md ? (oui/non)
2. As-tu lu le paper ScreenCoder ? (oui/non)
3. Cites les 3 modules que tu n'as PAS le droit de toucher (§2). (3 noms)
4. Quelle est l'étape #1 de la semaine 1 ? (1 phrase)

Si une réponse manque, on ne démarre pas.

---

**Ce document est la source de vérité pour le refactor. Toute déviation doit être discutée avec l'utilisateur (Salah) AVANT d'être implémentée.**
