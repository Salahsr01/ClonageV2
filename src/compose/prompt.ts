import type { ComposeBrief } from './types.js';
import type { Inventory, CopyBlock, AttrCopy, MetaCopy } from './inventory.js';

export interface BuildRewritePromptOpts {
  brief: ComposeBrief;
  sectionRole: string;
  sourceSite: string;
  inventory: Inventory;
  sector?: string;
  retryFeedback?: string;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function slimCopyBlock(b: CopyBlock) {
  return { id: b.id, tag: b.tag, hint: b.hint, text: truncate(b.text, 400) };
}

function slimAttr(a: AttrCopy) {
  return { id: a.id, attr: a.attr, text: truncate(a.text, 200) };
}

function slimMeta(m: MetaCopy) {
  return { id: m.id, kind: m.kind, text: truncate(m.text, 200) };
}

function brandBlock(brief: ComposeBrief, sector?: string): string {
  const parts: string[] = [];
  parts.push(`Nom: ${brief.brandName}`);
  parts.push(`Industrie: ${brief.industry}`);
  if (brief.tagline) parts.push(`Tagline: ${brief.tagline}`);
  if (brief.description) parts.push(`Description: ${brief.description}`);
  if (brief.services?.length) parts.push(`Services: ${brief.services.join(', ')}`);
  if (brief.projects?.length) {
    parts.push(
      `Projets: ${brief.projects
        .map((p) => `${p.name}${p.description ? ` (${p.description})` : ''}`)
        .join('; ')}`,
    );
  }
  if (brief.email) parts.push(`Email: ${brief.email}`);
  if (sector) parts.push(`Secteur cible: ${sector}`);
  return parts.join('\n');
}

export function buildRewritePrompt(opts: BuildRewritePromptOpts): string {
  const { brief, sectionRole, sourceSite, inventory, sector, retryFeedback } = opts;

  const payload = {
    copyBlocks: inventory.copyBlocks.map(slimCopyBlock),
    attrs: inventory.attrs.map(slimAttr),
    metaText: inventory.metaText.map(slimMeta),
  };

  const feedback = retryFeedback
    ? `\n\n⚠️ Retry précédent rejeté. Corrige: ${retryFeedback}\n`
    : '';

  return `Tu es un rédacteur web expert en adaptation de marque. On te donne la liste des blocs de TEXTE VISIBLE extraits d'une section d'un site (rôle: "${sectionRole}", site source: ${sourceSite}). Ta tâche: réécrire chaque texte pour qu'il colle à la nouvelle marque ci-dessous, en conservant le SENS et la STRUCTURE narrative du bloc (heading reste heading, CTA reste CTA). Tu ne vois AUCUN HTML et tu n'en produis AUCUN — uniquement des chaînes de texte.

NOUVELLE MARQUE
${brandBlock(brief, sector)}

RÈGLES STRICTES
- Pour CHAQUE entrée fournie (copyBlocks, attrs, metaText), produis un mapping { id: "nouveau texte" }.
- Respecte le rôle (hint): heading → titre court, body → paragraphe, cta → verbe d'action court, label → étiquette.
- Ne copie JAMAIS le texte d'origine : il appartient à la marque source et doit disparaître.
- Ne mentionne JAMAIS le site source ni sa marque ("${sourceSite}", ni dérivés).
- Garde approximativement la longueur du texte d'origine (±30%). Les contraintes de layout en dépendent.
- Les attrs (alt, aria-label, placeholder, title) doivent rester fonctionnels et descriptifs.
- Langue : déduis-la du texte source (probablement français ou anglais). Garde la même langue.
- Si un id n'a pas besoin d'être changé (déjà neutre, générique), tu PEUX l'omettre — mais la plupart doivent l'être.

FORMAT DE SORTIE (OBLIGATOIRE)
Un seul objet JSON, sans markdown, sans commentaire, schéma exact :
{
  "copy":  { "c1": "...", "c2": "...", ... },
  "attrs": { "a1": "...", ... },
  "meta":  { "m1": "...", ... }
}${feedback}

ENTRÉES (JSON, ne modifie pas les ids) :
${JSON.stringify(payload, null, 2)}

Réponds maintenant avec l'objet JSON final et rien d'autre.`;
}

export interface SelectCandidate {
  site: string;
  role: string;
  text_excerpt?: string;
  has_animation?: boolean;
  dominant_classes?: string[];
}

export interface BuildSelectPromptOpts {
  brief: ComposeBrief;
  candidates: SelectCandidate[];
  sector?: string;
  targetCount?: number;
}

export function buildSelectPrompt(opts: BuildSelectPromptOpts): string {
  const { brief, candidates, sector, targetCount = 6 } = opts;
  const slim = candidates.map((c, i) => ({
    idx: i,
    site: c.site,
    role: c.role,
    excerpt: truncate(c.text_excerpt || '', 160),
    animated: Boolean(c.has_animation),
  }));

  return `Tu es un directeur artistique qui compose une landing page à partir d'un catalogue de sections réelles issues de sites primés (Awwwards, FWA…). Choisis, parmi les candidats fournis, les ${targetCount} meilleures sections pour raconter la marque suivante. Tu dois produire une narration cohérente : ouverture → preuve → offre → appel → clôture.

NOUVELLE MARQUE
${brandBlock(brief, sector)}

RÈGLES
- Tu peux mélanger des sections venant de sites différents.
- Privilégie les sections "animated": true quand le rôle s'y prête (hero, services, cta).
- Ne répète pas deux fois le même rôle sauf nécessité narrative.
- L'ordre compte : la première entrée sera rendue en haut de page.
- N'invente pas d'idx hors liste.

FORMAT DE SORTIE (OBLIGATOIRE)
Un seul tableau JSON, sans markdown ni commentaire :
[ { "idx": <number>, "reason": "<pourquoi cette section ici>" }, ... ]

CANDIDATS :
${JSON.stringify(slim, null, 2)}

Réponds maintenant avec le tableau JSON final et rien d'autre.`;
}
