import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './utils/logger.js';
import { execSync } from 'child_process';

const PORT = 4700;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.md': 'text/markdown; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
};

export function killExistingServer(): void {
  try {
    // Kill any process listening on our port
    execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // No process on that port -- that's fine
  }
}

export function startServer(rootDir: string, originalUrl?: string): http.Server {
  killExistingServer();

  const originalOrigin = originalUrl ? (() => { try { return new URL(originalUrl).origin; } catch { return ''; } })() : '';

  const server = http.createServer(async (req, res) => {
    const rawUrl = req.url || '/';

    // Proxy /_next/ requests to the original server (for Next.js sites)
    if (originalOrigin && (rawUrl.startsWith('/_next/') || rawUrl.startsWith('/__next'))) {
      try {
        const proxyUrl = originalOrigin + rawUrl;
        const proxyRes = await fetch(proxyUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': originalOrigin + '/' },
        });
        const body = Buffer.from(await proxyRes.arrayBuffer());
        const contentType = proxyRes.headers.get('content-type') || 'application/octet-stream';
        res.writeHead(proxyRes.status, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=31536000',
        });
        res.end(body);
        return;
      } catch {
        res.writeHead(502);
        res.end('Proxy error');
        return;
      }
    }

    let urlPath = decodeURIComponent(rawUrl);

    // Remove query strings
    urlPath = urlPath.split('?')[0];

    // Default to index.html
    if (urlPath === '/' || urlPath === '') {
      urlPath = '/index.html';
    }

    // If path has no extension, try adding .html
    if (!path.extname(urlPath)) {
      urlPath = urlPath + '.html';
    }

    const filePath = path.join(rootDir, urlPath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(filePath)) {
      // Try alternate filename patterns for %20/space/dash mismatches
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      const alternatives = [
        // Try with %20 literal (file was saved URL-encoded)
        base.replace(/ /g, '%20'),
        // Try with dashes (sanitized version)
        base.replace(/ /g, '-').replace(/[()]/g, ''),
        // Try URL-decoding any remaining %XX sequences
        (() => { try { return decodeURIComponent(base); } catch { return ''; } })(),
      ];
      const found = alternatives.find(
        (alt) => alt && alt !== base && fs.existsSync(path.join(dir, alt))
      );
      if (found) {
        const content = fs.readFileSync(path.join(dir, found));
        const ext = path.extname(found).toLowerCase();
        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(content);
        return;
      }
      res.writeHead(404);
      res.end(`Not found: ${urlPath}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const content = fs.readFileSync(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(content);
  });

  server.listen(PORT, () => {
    console.log('');
    logger.success(`Serveur lancé sur http://localhost:${PORT}`);
    logger.info('Le clone est accessible dans votre navigateur.');
    logger.dim(`Ctrl+C pour arrêter le serveur`);
  });

  return server;
}
