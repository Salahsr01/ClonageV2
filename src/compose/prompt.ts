import type { ComposeBrief } from './types.js';

export interface BuildSectionPromptOpts {
  brief: ComposeBrief;
  sectionRole: string;
  sectionHtml: string;
  sourceSite: string;
  sector?: string;
}

export interface SectionTextItem {
  id: number;
  text: string;
}

export interface BuildTextDiffPromptOpts {
  brief: ComposeBrief;
  sectionRole: string;
  sourceSite: string;
  texts: SectionTextItem[];
  sector?: string;
}

export function buildSectionPrompt(opts: BuildSectionPromptOpts): string {
  const { brief, sectionRole, sectionHtml, sourceSite, sector } = opts;
  const services = brief.services?.length ? brief.services.join(', ') : '';
  const description = brief.description ? `\nDescription: ${brief.description}` : '';
  const taglineLine = brief.tagline ? `\nTagline: ${brief.tagline}` : '';
  const servicesLine = services ? `\nServices: ${services}` : '';
  const sectorLine = sector ? `\nSecteur cible: ${sector}` : '';
  const emailLine = brief.email ? `\nEmail de contact: ${brief.email}` : '';
  const projectsLine = brief.projects?.length
    ? `\nExemples de projets: ${brief.projects.map((p) => p.name).join(', ')}`
    : '';

  return `Tu es un expert en adaptation de contenu web. On te donne une section HTML provenant du site "${sourceSite}" (role: ${sectionRole}). Ta tache: reecrire UNIQUEMENT le contenu textuel visible (titres, paragraphes, libelles) pour qu'il corresponde a la nouvelle marque decrite ci-dessous. Ne change surtout pas la structure HTML, les classes CSS, les scripts, ni les chemins d'images.

Nouvelle marque:
Nom: ${brief.brandName}
Industrie: ${brief.industry}${taglineLine}${description}${servicesLine}${emailLine}${projectsLine}${sectorLine}

Regles strictes:
- Garde tous les tags, classes, id, data-attributes, scripts et styles
- Garde les balises <img src="..."> INCHANGEES (structure + src)
- Reecris seulement le texte visible (innerHTML des elements textuels)
- Reponds avec le HTML complet (meme DOCTYPE, meme <head>, meme <body>)
- Aucun commentaire, aucune explication, juste le HTML

SECTION A REECRIRE (role: ${sectionRole}):
\`\`\`html
${sectionHtml}
\`\`\`

Reponds uniquement avec le HTML reecrit, commencant par <!DOCTYPE html>.`;
}

export function buildTextDiffPrompt(opts: BuildTextDiffPromptOpts): string {
  const { brief, sectionRole, sourceSite, texts, sector } = opts;
  const services = brief.services?.length ? brief.services.join(', ') : '';
  const description = brief.description ? `\nDescription: ${brief.description}` : '';
  const taglineLine = brief.tagline ? `\nTagline: ${brief.tagline}` : '';
  const servicesLine = services ? `\nServices: ${services}` : '';
  const sectorLine = sector ? `\nSecteur cible: ${sector}` : '';
  const emailLine = brief.email ? `\nEmail de contact: ${brief.email}` : '';
  const projectsLine = brief.projects?.length
    ? `\nExemples de projets: ${brief.projects.map((p) => p.name).join(', ')}`
    : '';

  const textPayload = JSON.stringify(texts, null, 2);

  return `Tu adaptes du contenu marketing web pour une nouvelle marque.
Tu travailles sur la section "${sectionRole}" du site source "${sourceSite}".

Nouvelle marque:
Nom: ${brief.brandName}
Industrie: ${brief.industry}${taglineLine}${description}${servicesLine}${emailLine}${projectsLine}${sectorLine}

Regles strictes:
- Tu ne modifies QUE le texte, jamais la structure HTML
- Tu gardes le ton premium et coherent avec l'industrie
- Tu conserves la longueur (idealement +/- 20%) pour limiter les regressions de layout
- Tu rends UNIQUEMENT un JSON valide (pas de markdown)

Format de sortie impose:
[
  { "id": 0, "newText": "..." },
  { "id": 3, "newText": "..." }
]

Contraintes de sortie:
- Utilise uniquement des ids presents dans l'entree
- N'inclus que les textes a changer
- Si aucun changement necessaire, renvoie []

Textes sources (ordre stable):
${textPayload}
`;
}
