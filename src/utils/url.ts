import { URL } from 'url';

export function normalizeUrl(href: string, baseUrl: string): string | null {
  try {
    const url = new URL(href, baseUrl);
    // Remove hash and trailing slash
    url.hash = '';
    let normalized = url.href.replace(/\/$/, '');
    return normalized;
  } catch {
    return null;
  }
}

export function isSameDomain(url: string, baseUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(baseUrl);
    return a.hostname === b.hostname;
  } catch {
    return false;
  }
}

export function urlToFilePath(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    if (path === '/' || path === '') return 'index';
    // Remove leading slash and trailing slash
    path = path.replace(/^\//, '').replace(/\/$/, '');
    // Replace remaining slashes with dashes for flat structure or keep nested
    return path;
  } catch {
    return 'index';
  }
}

export function getAssetFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    let filename = pathname.split('/').pop() || 'asset';
    // Decode URL-encoded characters (%20 -> space, etc.)
    filename = decodeURIComponent(filename);
    // Sanitize: replace spaces and special chars with dashes
    filename = filename.replace(/\s+/g, '-').replace(/[()]/g, '');
    return filename;
  } catch {
    return 'asset';
  }
}

export function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export function resolveUrl(relative: string, base: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}
