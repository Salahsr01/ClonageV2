# Clonage

**Cloner, analyser et régénérer des sites web de niveau Awwwards à partir d'une IA.**

> État : prototype de recherche. Le pipeline de clonage déterministe est mature ; le pipeline de **régénération par IA est largement insuffisant** (voir section « Limites réelles » plus bas). Ce README est écrit sans enjoliver.

---

## 1. Vision globale

Le projet vise une idée longue : transformer n'importe quel site web public en **matière première réutilisable** pour en générer de nouveaux — tout en préservant la qualité visuelle et l'interaction du site source. Autrement dit :

1. On aspire un site vitrine remarquable (animations, scroll narratif, WebGL, compositions typographiques, transitions).
2. On le découpe en **sections autonomes** réutilisables (hero, about, CTA, grille de projets, contact…).
3. On alimente une base de connaissances (KB) indexée par rôle, domaine, animation, palette, typographie.
4. On recombine ces sections avec un brief de marque (`brandName`, `tagline`, `services`, `couleurs`, `typo`) pour produire un **site cliquable complet** qui ressemble à ce qu'un studio top 1% livrerait — mais en minutes.

L'objectif final n'est **pas** un simple "website generator" qui produit du HTML statique propre. C'est une machine à **répliquer le niveau de design des sites primés à Awwwards / The FWA**, en réutilisant les structures qui marchent (timings GSAP, scroll-pin, shaders, masking SVG, compositions full-bleed, typos variables) et en y injectant une identité de marque.

### Pourquoi cette approche

Les LLM généralistes sont mauvais en design web haut de gamme **from scratch** : ils produisent du Tailwind convenu, des landings SaaS indifférenciées, zéro animation, et des compositions "Figma par défaut". Ils sont en revanche très bons en **réécriture ciblée** quand on leur donne une structure éprouvée.

Le pari de Clonage : le squelette HTML/CSS/animation vient d'un site réel (awards, studios), le LLM ne touche que le texte et quelques tokens (marque, couleurs). Le résultat hérite du savoir-faire du studio original.

---

## 2. Architecture du pipeline (vue d'ensemble)

```
 URL source                        Brief de marque
     │                                   │
     ▼                                   ▼
┌──────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────┐
│  clone   │──▶│ reproduce-    │──▶│ deep-extract │──▶│ kb-compose│
│          │   │  exact        │   │  (KB v2)     │   │           │
│ crawl +  │   │ offline HTML  │   │ sections     │   │ réécriture│
│ freeze   │   │ fidèle au px  │   │ autonomes    │   │ LLM +     │
└──────────┘   └───────────────┘   └──────────────┘   │ assemblage│
     │                                                └───────────┘
     │                                                      │
     ▼                                                      ▼
  output/                                           generated/compose/
  (clone brut)                                      (site "rebrand")
```

Modules présents dans `src/` :

| Module | Rôle | État |
|--------|------|------|
| `crawler/` + `pipeline.ts` | Crawl Playwright, capture HTML + assets + screenshots | stable |
| `recorder/` | Capture d'interaction vivante (scroll, hover, click) + timeline | stable, connu pour boucler sur GSAP ScrollTrigger — cap les steps |
| `replay/` | Rejeu d'une interaction enregistrée | stable |
| `reproducer/` | Reproduction statique (v1) | legacy |
| `reproducer-exact/` | Reproduction fidèle au pixel (v3), inline tous les assets en `data:` | stable hors Next.js CSS-in-JS |
| `extractor/` | Extraction de sections + styles | stable |
| `analyzer/` | Analyse sémantique (rôles des sections, palette, typo) | stable |
| `knowledge/` | KB v1 — index plat | legacy |
| `deep-extract/` | **KB v2** — sections autonomes, assets locaux, index par rôle/tags | stable |
| `rebrand/` | Rebrand déterministe 5 axes (couleurs, typo, copy, images, marque) sur HTML reproduit | stable |
| `compose/` | **Composition IA** d'un site à partir d'une KB v2 + brief | ⚠ **qualité mauvaise**, voir §5 |
| `generator/` | Génération template LLM (backends OpenAI / Anthropic / claude CLI) | fonctionne, output tronqué ~42KB |
| `exporter/` | Packaging clone (zip, serve.sh) | stable |
| `server.ts` | Petit serveur statique `localhost:4700` pour preview | stable |

---

## 3. Les 2 chemins principaux

### 3.1 Chemin déterministe (qui marche)

```bash
# 1. Cloner
clonage clone https://www.example.com

# 2. Reproduction fidèle (offline, inline assets)
clonage reproduce-exact output/www.example.com_2026-04-XX/

# 3. Rebrand déterministe avec un brief JSON
clonage rebrand generated/reproduce-exact/www.example.com/hero.html \
  -b briefs/mon-brand.json
```

Le rebrand applique **5 transformers en séquence** :
- `BrandTransformer` — swap du nom de marque (text-node only)
- `PaletteTransformer` — mapping strict couleur → couleur (pas de clustering auto)
- `TypographyTransformer` — swap de police + injection Google Fonts
- `CopyTransformer` — substitution `from → selector` avec warnings de longueur
- `ImagesTransformer` — `from/selector`, inline local ou passthrough URL

→ Prédictible. Aucun LLM. Test suite : 58/58 passants, fidélité pixel-diff ~62 % sur les sites testés (limite connue des Next.js à cause du CSS-in-JS runtime).

### 3.2 Chemin IA (qui ne marche pas encore)

```bash
# 1. Indexer un clone en KB v2
clonage deep-extract output/www.icomat.co.uk_2026-04-15/

# 2. Composer un nouveau site avec un brief
clonage kb-compose \
  --base www.icomat.co.uk \
  --brand briefs/nova-aerospace.json \
  --sector "propulsion électrique aéronautique" \
  -o generated/compose/nova-aerospace
```

C'est **ce qui est cassé aujourd'hui** (voir §5).

---

## 4. Structure du dépôt

```
src/
├── cli.ts                   # point d'entrée CLI (commander)
├── pipeline.ts              # orchestration clone
├── server.ts                # serveur de preview localhost:4700
├── crawler/                 # Playwright crawl
├── recorder/ + replay/      # capture/rejeu d'interaction
├── extractor/               # sections + styles
├── analyzer/                # classification sémantique
├── knowledge/               # KB v1 (legacy)
├── deep-extract/            # KB v2 (sections autonomes)
├── reproducer/              # reproducer v1 (legacy)
├── reproducer-exact/        # reproducer v3 (fidèle pixel)
├── rebrand/                 # rebrand déterministe 5 axes
├── compose/                 # composition IA à partir de KB v2
├── generator/               # templating LLM
├── exporter/                # packaging (zip, serve.sh)
├── feedback/                # hooks de retour
└── utils/                   # logger, llm, io

briefs/                      # briefs de marque JSON (nova-aerospace, studiox-to-forma…)
docs/                        # specs et plans
output/                      # clones bruts (gitignored)
generated/                   # sorties de pipelines (gitignored)
tests/                       # tests e2e par module
.clonage-kb/                 # base de connaissance v2 (gitignored, 11 Mo)
```

---

## 5. Limites réelles (aucune concession)

### 5.1 Le pipeline `kb-compose` produit du HTML mort

Test du 2026-04-22 : brief `Nova Aerospace` composé sur la base `www.icomat.co.uk` (5 sections : cta, about, section-2, contact, section-4).

Résultat manifeste (`generated/compose/nova-aerospace/_compose.json`) :
- **4/5 sections réécrites** par le LLM (claude CLI en fallback local)
- Section `about` → `used_llm: false` : le LLM a échoué, **la section icomat d'origine a été conservée telle quelle**. 14 références "iCOMAT/ICOMAT" restent dans le livrable.
- Les sections réécrites sont **massivement tronquées** :
  - `cta` 66 KB → 7.5 KB
  - `section-2` 55 KB → 1.8 KB
  - `section-4` 50 KB → **52 octets** (quasi vide)
- Le HTML produit est **statique et sans vie** : aucune animation conservée, pas de scripts, pas d'effets GSAP/scroll, rien. Le clone source était vivant ; la sortie ne l'est plus.

### 5.2 Causes identifiées

1. **Prompt trop laxiste** (`src/compose/prompt.ts`) : demande "garde structure + classes + scripts" mais n'impose aucune contrainte de taille minimale ni de parité DOM. Le LLM ampute le HTML à chaque passage.
2. **Catch silencieux** dans `rewriteSection` (`src/compose/rewrite.ts:52`) : toute erreur LLM est avalée, impossible de diagnostiquer pourquoi `about` a échoué.
3. **Aucune validation post-LLM** : pas de comparaison structurelle (nb de nœuds, scripts préservés, tailles), pas de rejet si l'output perd plus de X % du HTML original.
4. **Pas de gestion de `<head>/<style>/scripts`** : le LLM reformule tout, y compris les `@font-face` et `<style>` embarqués. D'où la typo cassée (`font-family: 'unknown'` dans l'output).
5. **Approche "full-HTML rewrite" fondamentalement fragile** : passer 66 KB de HTML à un LLM en lui demandant de ne modifier que les textes, c'est lui donner la corde pour se pendre. L'approche correcte serait un **diff textuel** : extraire les text-nodes, les réécrire en lot, les réinjecter sans toucher au DOM.

### 5.3 Autres limites connues

- `reproducer-exact` ne rend pas correctement les sites Next.js avec CSS-in-JS runtime (preflight à `replay` dans ces cas).
- `recorder` boucle à l'infini sur les sites à pinning GSAP — cap sur le nombre de steps nécessaire.
- `generator` (templating LLM, backend claude CLI) tronque l'output à ~42 KB, le `</html>` final manque.

---

## 6. Pistes de correction (pour la suite)

À attaquer dans cet ordre si l'on reprend le pipeline IA :

1. **Refondre l'étape de réécriture en « text-diff »** :
   - Parser le HTML avec Cheerio, extraire la liste ordonnée des text-nodes + `alt` / `aria-label` / `title`.
   - Passer cette liste (JSON) au LLM avec le brief.
   - Demander une sortie JSON `[{id, newText}]`.
   - Réinjecter dans le DOM d'origine sans toucher à la structure.
   - Résultat : perte structurelle impossible, préservation 100 % des scripts, animations et styles.

2. **Préserver explicitement `<head>`, `<script>`, `<style>`** : les exclure du prompt LLM.

3. **Validation structurelle post-LLM** :
   - Rejeter l'output si `outputNodes < 0.9 × inputNodes`.
   - Rejeter si un `<script>` du source manque.
   - Logger l'erreur LLM au lieu de `catch {}`.

4. **Unifier KB v1 / KB v2** et supprimer `knowledge/` legacy.

5. **Tests e2e compose** : aujourd'hui `tests/compose/` existe mais ne couvre pas le cas « site vivant ». Ajouter un test qui vérifie que `<script>` et `@keyframes` sont préservés.

---

## 7. Usage rapide

```bash
# Install
npm install
npm run build

# Cloner un site
node dist/cli.js clone https://example.com

# Reproduire fidèlement en offline
node dist/cli.js reproduce-exact output/example.com_YYYY-MM-DD/

# Indexer en KB v2
node dist/cli.js deep-extract output/example.com_YYYY-MM-DD/

# Rebrand déterministe (recommandé)
node dist/cli.js rebrand generated/reproduce-exact/example.com/hero.html \
  -b briefs/my-brand.json

# Compose IA (actuellement cassé — voir §5)
node dist/cli.js kb-compose \
  --base example.com \
  --brand briefs/my-brand.json \
  -o generated/compose/my-brand

# Preview
node dist/cli.js serve ./generated/compose/my-brand
# → http://localhost:4700
```

---

## 8. Format d'un brief

```json
{
  "brandName": "Nova Aerospace",
  "industry": "startup de propulsion électrique pour aéronefs légers",
  "tagline": "Silence, portée, précision",
  "description": "Nova conçoit des groupes propulseurs électriques pour l'aviation de demain.",
  "services": ["Conception de moteurs", "Intégration cellule", "Certification"],
  "email": "contact@novaaerospace.example",
  "projects": [
    { "name": "Aetheris V1", "category": "moteur", "description": "moteur 150 kW ultra-silencieux" }
  ]
}
```

Pour le `rebrand` déterministe (HTML unique), le brief est plus riche : mapping palette, polices cible, mapping `from → selector` pour copy et images. Voir `src/rebrand/types.ts` et `briefs/studiox-to-forma.json`.

---

## 9. État de la test suite

```
npm test
```

- `tests/rebrand/` — 58/58 pass (déterministe, couvre passthrough + brief 5 axes)
- `tests/reproducer/` — OK
- `tests/compose/` — insuffisant, ne valide pas la préservation des scripts/animations

---

## 10. Contexte et décisions stratégiques

- **Pourquoi le rebrand déterministe existe** : pour avoir un chemin 100 % prédictible quand on veut juste changer l'identité d'un clone sans risquer la casse IA.
- **Pourquoi la KB v2** : la v1 était un index plat, impossible à recombiner. La v2 découpe chaque clone en sections autonomes (HTML + styles + assets) indexées par rôle, ce qui permet de composer un site à partir de briques issues de sites différents.
- **Pourquoi claude CLI en fallback LLM** : permet de tourner sans clé API Anthropic/OpenAI — utile en dev local et pour ne pas bloquer le pipeline sur un env var manquant.
- **Pourquoi le clone vivant (`record`/`replay`) plutôt que juste un screenshot** : capturer l'**interaction** (scroll, hover, timing GSAP) pour plus tard pouvoir la rejouer ou la ré-extraire.

---

## 11. Licence

MIT — voir `package.json`.

---

## 12. Remerciements / prior art

- Playwright, Cheerio, GSAP (observé, pas embarqué)
- `freeze-dry` pour l'archivage HTML offline
- Awwwards, The FWA, SiteInspire comme source d'inspiration et corpus de tests
