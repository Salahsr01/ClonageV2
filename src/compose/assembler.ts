export interface AssembleOptions {
  title: string;
  lang: string;
  bodySections: Array<{ role: string; bodyHtml: string }>;
  styles: string[];
  extraHeadHtml?: string;
}

export function assembleHtml(opts: AssembleOptions): string {
  const styleBlock = opts.styles.length > 0 ? `<style>\n${opts.styles.join('\n')}\n</style>` : '';
  const bodies = opts.bodySections
    .map((s) => `<!-- compose:${s.role} -->\n${s.bodyHtml}\n<!-- /compose:${s.role} -->`)
    .join('\n\n');

  return `<!DOCTYPE html>
<html lang="${opts.lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(opts.title)}</title>
${opts.extraHeadHtml || ''}
${styleBlock}
</head>
<body>
${bodies}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
