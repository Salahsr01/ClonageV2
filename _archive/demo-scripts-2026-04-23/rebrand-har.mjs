// Rewrite a HAR in place with brand substitutions.
// Usage: node scripts/rebrand-har.mjs <inputHar> <briefJson> <outputHar>
//
// Applies brief.brand + brief.copy to every text response body (HTML, JS, CSS)
// in the HAR. Keeps binary assets (images, fonts, videos) untouched.

import * as fs from 'fs';

const [, , harIn, briefPath, harOut] = process.argv;
if (!harIn || !briefPath || !harOut) {
  console.error('usage: rebrand-har.mjs <inputHar> <briefJson> <outputHar>');
  process.exit(1);
}

const har = JSON.parse(fs.readFileSync(harIn, 'utf-8'));
const brief = JSON.parse(fs.readFileSync(briefPath, 'utf-8'));

const pairs = [];
if (brief.brand?.source_name && brief.brand?.name) {
  const src = brief.brand.source_name;
  const dst = brief.brand.name;
  // Preserve case variations
  pairs.push([src.toUpperCase(), dst.toUpperCase()]);
  pairs.push([src, dst]);
  pairs.push([src.toLowerCase(), dst.toLowerCase()]);
  // With © suffix (naughtyduk-specific)
  pairs.push([`${src.toUpperCase()}©`, `${dst.toUpperCase()}©`]);
  pairs.push([`${src}©`, `${dst}©`]);
}
for (const c of brief.copy ?? []) {
  if (c.from && c.to) pairs.push([c.from, c.to]);
}

// Dedup + sort by length descending so longer patterns match first.
const dedup = new Map();
for (const [from, to] of pairs) if (from && !dedup.has(from)) dedup.set(from, to);
const sorted = [...dedup.entries()].sort((a, b) => b[0].length - a[0].length);
console.log(`[rebrand-har] ${sorted.length} substitution patterns`);

const TEXT_MIMES = new Set([
  'text/html',
  'text/css',
  'text/javascript',
  'application/javascript',
  'application/json',
  'text/plain',
  'image/svg+xml',
]);

let entriesModified = 0;
let substitutions = 0;
for (const e of har.log.entries) {
  const ct = (e.response.content.mimeType || '').split(';')[0].trim();
  if (!TEXT_MIMES.has(ct)) continue;
  const body = e.response.content.text;
  if (typeof body !== 'string' || !body) continue;
  // HAR may base64 encode text bodies — check encoding.
  let decoded = body;
  const isBase64 = e.response.content.encoding === 'base64';
  if (isBase64) {
    try { decoded = Buffer.from(body, 'base64').toString('utf-8'); }
    catch { continue; }
  }
  let modified = decoded;
  let localCount = 0;
  for (const [from, to] of sorted) {
    const before = modified.length;
    modified = modified.split(from).join(to);
    if (modified.length !== before) localCount++;
  }
  if (modified !== decoded) {
    substitutions += localCount;
    entriesModified++;
    if (isBase64) {
      e.response.content.text = Buffer.from(modified, 'utf-8').toString('base64');
    } else {
      e.response.content.text = modified;
    }
    // Update Content-Length header if present
    if (e.response.headers) {
      for (const h of e.response.headers) {
        if (h.name.toLowerCase() === 'content-length') {
          h.value = String(Buffer.byteLength(isBase64 ? Buffer.from(modified, 'utf-8') : modified));
        }
      }
    }
    e.response.content.size = Buffer.byteLength(isBase64 ? Buffer.from(modified, 'utf-8') : modified);
    console.log(`  modified ${localCount}× ${ct} ${e.request.url.substring(0, 80)}`);
  }
}

fs.writeFileSync(harOut, JSON.stringify(har, null, 2), 'utf-8');
console.log(`\n=== DONE ===`);
console.log(`Entries modified: ${entriesModified}/${har.log.entries.length}`);
console.log(`Total pattern-entry hits: ${substitutions}`);
console.log(`Output: ${harOut}`);
