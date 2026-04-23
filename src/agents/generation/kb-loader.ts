import * as fs from 'fs';
import * as path from 'path';

export interface LoadedSection {
  site: string;
  role: string;
  /** Full path to the section HTML (`<role>.html`). */
  htmlPath: string;
  html: string;
  /** Path to the screenshot when present. */
  screenshotPath?: string;
  /** Path to the `<role>.ground.json` sidecar when present. */
  sidecarPath?: string;
}

/**
 * Resolve a plan source id (e.g. "mersi#hero") to the actual section files in
 * `.clonage-kb/sections/<site>/<role>.html`.
 */
export function loadSectionBySourceId(sourceId: string, kbRoot?: string): LoadedSection {
  const [site, role] = sourceId.split('#');
  if (!site || !role) {
    throw new Error(`invalid source id: "${sourceId}" — expected format site#role`);
  }
  const base = kbRoot ?? path.join(process.cwd(), '.clonage-kb');
  const sectionDir = path.join(base, 'sections', site);
  const htmlPath = path.join(sectionDir, `${role}.html`);
  if (!fs.existsSync(htmlPath)) {
    throw new Error(
      `section not found: ${htmlPath} — run \`clonage deep-extract\` on the source site first`,
    );
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');

  const screenshotPath = path.join(sectionDir, `${role}.png`);
  const sidecarPath = path.join(sectionDir, `${role}.ground.json`);

  return {
    site,
    role,
    htmlPath,
    html,
    screenshotPath: fs.existsSync(screenshotPath) ? screenshotPath : undefined,
    sidecarPath: fs.existsSync(sidecarPath) ? sidecarPath : undefined,
  };
}

/**
 * Return the assets directory associated with a site's KB (optional dir).
 */
export function siteAssetsDir(site: string, kbRoot?: string): string | null {
  const base = kbRoot ?? path.join(process.cwd(), '.clonage-kb');
  const assets = path.join(base, 'sections', site, 'assets');
  return fs.existsSync(assets) ? assets : null;
}
