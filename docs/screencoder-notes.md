# ScreenCoder — notes pour le refactor Clonage

**Source :** arXiv 2507.22827 (MMLab CUHK) + https://github.com/leigest519/ScreenCoder
**Lu le :** 2026-04-23 (S1 étape 7 du REFACTOR_BRIEF)
**But :** cadrer ce qu'on reprend vs ce qu'on adapte pour Clonage v2.

## Ce que fait ScreenCoder

ScreenCoder est un framework visual-to-code. Problème adressé : les MLLMs
monolithiques (GPT-4V, Gemini, etc.) sont médiocres en traduction UI→code
sur des layouts complexes — ils hallucinent, oublient des zones, mélangent
hiérarchie et style.

Leur solution : découper en **3 agents spécialisés** plutôt qu'un LLM unique.

### Les 3 agents (version ScreenCoder)

1. **Grounding agent** — perception visuelle. Prend un screenshot, détecte
   les blocs UI via UIED (UI Element Detection), produit des bounding boxes
   + metadata par composant.
2. **Planning agent** — organisation structurelle. Lit les blocs détectés,
   produit un plan de layout (hiérarchie, arbre de composition, zones
   logiques).
3. **Generation agent** — synthèse du code HTML. Prend le plan, génère le
   HTML avec des placeholders gris à la place des images. Puis un second
   pass remplace les placeholders par les vraies images.

### Choix de modèle

Configurable (`block_parsor.py` + `html_generator.py`) — Doubao par défaut,
supporte Qwen/GPT/Gemini. Pas d'affectation modèle-par-agent explicite.

### Pipeline de données

1. Block detection → component data
2. HTML generation (avec placeholders)
3. Placeholder detection (box detection)
4. UI element detection (UIED)
5. Mapping placeholders ↔ éléments détectés
6. Image replacement → HTML final

Flux single-pass. Pas de boucle validation / retry documentée dans le README.

### Post-training

Ils publient le code SFT + RL qui aligne le modèle. Hors-scope pour nous
(on consomme Claude hosted, on ne fine-tune pas).

### Ce qui manque (vs brief Clonage)

- **Pas de vecteur store / RAG.** ScreenCoder part d'une image, pas d'un
  corpus de sites pré-analysés.
- **Pas de validateur.** Sortie = sortie, pas de pixel-diff ni de critique.
- **Générateur LLM.** ScreenCoder demande au LLM le HTML complet — c'est
  exactement ce qu'on veut éviter (memory #958, #963, truncation bugs).

## Ce qu'on garde pour Clonage v2

1. **Le 3-agent split.** C'est le cœur de l'architecture. Isoler
   perception / planning / synthèse réduit l'espace d'hallucination par
   étape et facilite le debug.
2. **Le principe "l'agent produit un contrat formel, pas du code".**
   Grounding → JSON, Planning → JSON, seul Generation touche au HTML.
3. **Le découpage bottom-up.** Un screenshot se décompose en blocs, les
   blocs remontent en plan, le plan redescend en HTML — c'est l'esprit
   qu'on garde.

## Ce qu'on adapte

| ScreenCoder                       | Clonage v2 (REFACTOR_BRIEF)                       |
|---|---|
| Input = un screenshot inconnu     | Input = un clone déjà pixel-perfect + sa KB v2    |
| Grounding = UIED bbox detection   | Grounding = VLM analyse section-par-section → fiche JSON riche (role, mood, animations, palette, typo, layout, signature) |
| Planning = arbre de composition   | Planning = sélection de sections depuis un atlas vectoriel + composition d'un plan de site (8 rôles canoniques) |
| Generation = LLM écrit le HTML    | **Generation = compilateur déterministe**. Zéro LLM sur la structure. Text-diff LLM seulement sur les text-nodes. Le HTML vient de fichiers réels dans `.clonage-kb/`. |
| Aucun validateur                  | Validateur pixelmatch + Claude Vision critique + retry Planning (cap 3) |

## Ce qu'on ajoute et que ScreenCoder n'a pas

1. **Atlas vectoriel (§4.3).** ChromaDB embedded + embedding par section.
   Permet "cherche-moi un hero moody pour un studio d'archi" comme requête
   au Planning. ScreenCoder part d'un screenshot unique — nous partons
   d'un **corpus** de sites primés.
2. **Mode Plan Approval (§4.4).** `clonage plan` produit un plan humain-lisible,
   l'utilisateur édite `_plan.json` avant de lancer Generation. ScreenCoder
   est fully-automated → pas de boucle humaine intermédiaire.
3. **Boucle de validation (§4.6).** Si le rendu s'écarte >5% pixel, Claude
   Vision juge la cohérence, on remonte le feedback au Planning avec une
   exclusion list, on retry (cap 3). ScreenCoder pousse et oublie.

## Pourquoi ces adaptations matchent notre problème

Clonage n'est pas "image → code" comme ScreenCoder. C'est "banque de sites
primés + brief de marque → nouveau site niveau Awwwards". Deux contraintes
spécifiques :

1. On **a déjà** des HTML cloned pixel-perfect. Donc demander à un LLM d'en
   régénérer est une régression garantie (truncation, hallucination,
   animations perdues). D'où `Generation` déterministe qui concatène du
   HTML réel.
2. On **a besoin** de composer depuis plusieurs sources. D'où l'atlas
   vectoriel : le Planning agent joue le rôle de directeur artistique qui
   pioche dans la banque. ScreenCoder n'a qu'un screenshot donc pas ce
   besoin.

Le compromis : on perd la capacité de générer un site entièrement
**nouveau** (jamais vu, pas de source dans l'atlas). C'est un choix
conscient — le brief §0 dit que l'ambition est "composer un site neuf
niveau Awwwards à partir d'un corpus de sites primés", pas "inventer un
layout ex nihilo". Awwwards-level n'est pas atteignable par LLM pur en
l'état (cf. memory #995, memory `feedback_generation.md`).

## Mots-clés pour la recherche future

`visual-to-code`, `screen-to-code`, `UI grounding`, `layout planning`,
`multi-agent UI generation`, `RAG for design`, `screenshot diff validation`.

## Prochaines lectures à envisager

- Le paper GPT-Pilot (agent-based code generation) pour l'orchestration
  inter-agents.
- Les papers sur CLIP-based design retrieval pour valider le choix d'embedding.
- Le papier de pixelmatch + SSIM pour calibrer le seuil de diff visuel (5%
  peut-être trop strict pour des sites avec animations).
