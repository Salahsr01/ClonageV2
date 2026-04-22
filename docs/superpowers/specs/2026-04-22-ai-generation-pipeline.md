# Clonage — Pipeline de Generation IA (4 Phases)

**Date:** 2026-04-22
**Auteur:** Salah + Claude
**Statut:** Draft
**Version:** 1.0

---

## Probleme

Le pipeline de generation actuel (`template`, `reskin`, `regenerator`, `composer`) a deux limitations empiriquement verifiees :

1. **Fichiers monolithiques → troncature LLM.** Le test du 2026-04-21 a demontre que reecrire un `index.html` de 65 KB en un seul appel `claude -p` produit une reponse tronquee (~42 KB), avec les sections du bas manquantes. L'architecture "rewrite-whole-file" ne scale pas au-dela d'une page courte.

2. **Knowledge Base v1 plate.** Le `src/knowledge/index.ts` actuel ne sait pas ce qu'est une section autonome. Il stocke des fragments indifferencies, ce qui empeche la composition creative (Mode A) et rend la substitution (Mode B) grossiere.

L'observation #818 (Strategic Vision: Clone-as-Training-Data) a cadre l'ambition : transformer les clones en corpus utilisable pour de la generation award-level. La presente specification definit l'architecture de cette generation.

## Solution

Un pipeline en **4 phases** dont la premiere est la fondation. Decision architecturale validee (memoire #826) : **approche statique** — l'IA n'execute pas le clone vivant, elle analyse le code statique produit par `reproduce-exact`/`rebrand`.

### Principes directeurs

- **Pas de mix entre sites dans une meme page generee** (feedback_generation.md). Un site compose utilise toujours **une seule base** comme squelette ; les autres clones de la KB ne servent que d'inspiration lexicale/visuelle pour la substitution.
- **L'IA analyse le codebase du clone, pas un brief.** Le brief humain definit ce que veut le client ; l'IA deduit comment l'injecter en lisant les sections extraites.
- **Sections autonomes.** Chaque section HTML produite par `deep-extract` doit tourner isolement en ouvrant le fichier dans un navigateur — HTML + CSS inline + JS inline + assets en data URLs.

### Architecture 4 phases

```
Phase 1 (Foundation)         Phase 2 (Mode B)            Phase 3 (Mode A)
----------------------       ----------------------      ----------------------
deep-extract <clone>    ->   compose --base <site>  ->   compose --creative
                             --brand <brief.json>        --brand <brief.json>
                             --sector <sector>           --sector <sector>
                                                         [--visual]

.clonage-kb/sections/        Nouveau site rebrand        Nouveau site assemble
  <site>/                    (1 clone = 1 squelette)     (N clones = 1 site)
    hero.html
    services.html
    ...
    index.json

                             Phase 4 (Non-goals) : editeur visuel, deploiement auto, mix responsive cross-section
```

---

## Phase 1 : Foundation — `deep-extract` + KB v2

### But

Transformer un clone brut (`output/<domain>_<date>/`) en 6-8 sections HTML autonomes indexees. C'est la **fondation** qui debloque Phase 2 et Phase 3.

### CLI Surface

```
clonage deep-extract <cloneDir> [--sections <n>] [--force]
```

- `<cloneDir>` — un dossier de `output/` contenant `index.html` + `styles.css` + `assets/`.
- `--sections <n>` — cible 6-8 par defaut ; `deep-extract` peut en produire moins si le site a moins de zones distinctes.
- `--force` — reecraser l'entree KB existante pour ce site.

Exit code : 0 en cas de succes, 1 sur I/O.

### Algorithme de decoupage

1. **Charger** `<cloneDir>/index.html` avec cheerio.
2. **Identifier les frontieres de section** via heuristiques deterministes :
   - `<section>`, `<article>`, `<header>`, `<footer>`, `<nav>` natifs
   - Elements avec `class` contenant `section`, `hero`, `wrap`, `block`
   - `<div>` racines sous `<main>` ayant un enfant `h1`/`h2` + contenu
3. **Classifier semantiquement** chaque section via regles + patterns :
   - `hero` — premier bloc, contient `h1` ou tagline grand format
   - `services` — liste d'items (3+) avec titre court + paragraphe
   - `portfolio` / `projects` — grille d'images + titres
   - `about` — paragraphe long + image
   - `testimonials` — quotes, noms, photos
   - `contact` — formulaire ou email/telephone
   - `cta` — bouton principal + phrase d'accroche
   - Fallback : `section-<index>`
4. **Rendre chaque section autonome** :
   - Inline des styles CSS pertinents (extrait de `styles.css` via analyse des selecteurs touchant la section)
   - Inline des images locales en data URL (`_inlineAssets` existe deja dans `src/generator`)
   - JS : si une section referencie un script necessaire (ex : slider), copier le `<script>` tag ; sinon omettre
5. **Ecrire** `.clonage-kb/sections/<site>/<role>.html` pour chaque section.

### KB v2 : `.clonage-kb/sections/<site>/index.json`

```json
{
  "site": "www.mersi-architecture.com",
  "source_clone": "output/www.mersi-architecture.com_2026-04-15",
  "extracted_at": "2026-04-22T08:00:00Z",
  "palette": {
    "primary": "#f5f0e6",
    "secondary": "#1a1a1a",
    "accent": "#c9a66b"
  },
  "fonts": {
    "primary": { "family": "Neue Haas", "google": false },
    "display": { "family": "Editorial New", "google": false }
  },
  "sections": [
    {
      "role": "hero",
      "file": "hero.html",
      "size_bytes": 7841,
      "has_animation": true,
      "dominant_classes": ["home-slider_w", "voile"],
      "text_excerpt": "Design brutaliste...",
      "tags": ["minimaliste", "editorial", "architecture"]
    },
    ...
  ]
}
```

### Contraintes verifiables

- Chaque `sections/<site>/<role>.html` doit ouvrir dans un navigateur sans 404.
- Taille par section : **< 15 KB** (cible 5-10). C'est la contrainte qui garantit un rewrite LLM en un seul tour.
- Le `index.json` doit etre valide JSON et contenir au moins `site`, `source_clone`, `sections[]`.

### Non-goals Phase 1

- Extraction d'animations GSAP en code (on garde le JS original tel quel).
- Mix de sections entre sites (c'est le role de Phase 3).
- LLM dans cette phase — tout est deterministe.

---

## Phase 2 : Mode B — `compose --base`

### But

A partir d'**un seul clone** (choisi comme squelette) + brief client → nouveau site rebrand. Substitue textes et images via LLM, garde structure/CSS/JS intacts.

### CLI Surface

```
clonage compose --base <site-in-kb> --brand <brief.json> --sector <sector> [-o <dir>]
```

- `--base <site>` — nom d'un site deja passe par `deep-extract` (ex : `www.mersi-architecture.com`).
- `--brand <brief.json>` — brief client au meme format que `src/rebrand/types.ts` (reutilise le schema existant).
- `--sector <sector>` — contexte metier, injecte dans le prompt LLM.
- `-o <dir>` — dossier de sortie (defaut : `generated/compose-<brand-name>/`).

### Algorithme

1. **Charger** la KB v2 du site base : `.clonage-kb/sections/<site>/index.json`.
2. **Pour chaque section** dans `sections[]` :
   - Construire un prompt court (ciblant uniquement la section, pas le site entier)
   - Appeler `callLLM(prompt)` — reuse de `template.ts::callLLM` (qui supporte Anthropic API, HF, claude CLI)
   - Appliquer la reponse HTML sur une copie de la section
3. **Lancer le serveur** de preview sur port 4700.
4. **Ecrire** `_compose.json` avec manifest des transformations.

### Contraintes

- Pas de regeneration de structure DOM — meme principe que `rebrand` (observation : la reecriture pure LLM a toujours echoue).
- Le brief est celui du `rebrand` existant : reutiliser `src/rebrand/types.ts` `BrandBrief`.
- La substitution LLM est **uniquement** pour : texte de paragraphe, titres, noms de projets fictifs. Les palettes et fonts passent par le pipeline `rebrand` existant.

---

## Phase 3 : Mode A — `compose --creative`

### But

Multi-clone, multi-section. L'IA selectionne les meilleures sections a travers **toute la KB v2** et les assemble en un nouveau site coherent. Le squelette est **un seul site** choisi comme base structurelle ; les autres clones contribuent uniquement le contenu inspire.

### CLI Surface

```
clonage compose --creative --brand <brief.json> --sector <sector> [--visual] [-o <dir>]
```

- `--creative` — active le mode multi-clones (oppose a `--base`).
- `--visual` — flag optionnel : active la boucle Playwright → screenshot → Claude Vision → itere (max 3 cycles).
- Autres flags : identiques a Phase 2.

### Algorithme

1. **Scan KB v2 entiere** — charger tous les `index.json` de `.clonage-kb/sections/<*>/`.
2. **Selection du squelette** : LLM choisit le site `base` dont la structure matche le mieux le sector + brief (exemple : un brief "studio architecture" matche mersi-architecture ; un brief "SaaS B2B" matche icomat).
3. **Selection par role** : pour chaque role (hero, services, portfolio, contact…), LLM choisit la meilleure section disponible dans la KB (pas forcement du site squelette).
4. **Assemblage** : utiliser le site squelette comme shell ; remplacer section par section par les selections de l'etape 3 (en garantissant que les classes CSS et fonts sont presentes dans le shell — ajout via `rebrand` si necessaire).
5. **Substitution de contenu** : meme algo que Phase 2, section par section.
6. **Si `--visual`** : screenshot Playwright → prompt Claude Vision → ajustements ciblessur 1-3 sections → re-render.

### Contraintes

- **Squelette = 1 seul site** ; les autres clones n'apportent que des sections piochees + contenu. Cela preserve la coherence CSS/JS sans avoir a merger des systemes de design heterogenes (feedback_generation.md).
- Max 3 iterations visuelles pour ne pas diverger.

---

## Phase 4 : Non-goals explicites

Hors scope pour ce pipeline, documentes ici pour eviter la derive :

- **Editeur visuel** (type Builder.io / Webflow studio).
- **Deploiement automatique** vers Vercel/Netlify. On s'arrete au serveur local port 4700.
- **Responsive mixing cross-section** : si une section a un breakpoint 768px et la voisine 1024px, on ne tente pas de les harmoniser automatiquement. La section garde ses breakpoints d'origine.
- **Extraction GSAP source** : on ne parse pas les timelines pour les reecrire. Le JS original est copie tel quel section par section.
- **Multi-page** : on genere une page `index.html`. Les pages secondaires (contact, about…) sont hors scope Phase 1-3.

---

## Ordre de livraison valide

1. **Phase 1** d'abord, seule, livree comme sprint independant. Sans elle, Phase 2 et 3 ne sont pas realisables.
2. **Phase 2** apres validation Phase 1.
3. **Phase 3** apres Phase 2 stable.

Phase 2 et 3 **ne peuvent pas** etre parallelisees car Phase 3 reutilise le pipeline de substitution de Phase 2.

---

## Definition of Done — Phase 1

- [ ] Commande `clonage deep-extract <cloneDir>` fonctionnelle.
- [ ] Testable sur les 4 clones avec `index.html` : `icomat`, `mersi-architecture`, `raviklaassens`, `thisisstudiox`.
- [ ] Chaque site produit 4-8 sections dont chacune ouvre en standalone sans 404.
- [ ] `index.json` valide et parseable pour chaque site.
- [ ] Tests unitaires sur chaque module (classifier, inliner, KB writer).
- [ ] Test e2e qui fait tourner `deep-extract` sur mersi-architecture et valide le `index.json`.

Plan d'implementation : `docs/superpowers/plans/2026-04-22-phase1-deep-extract.md`.
