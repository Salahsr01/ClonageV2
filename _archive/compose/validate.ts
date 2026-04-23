import { buildInventory } from './inventory.js';
import type { Fingerprints } from './inventory.js';

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  details: {
    scriptsMatch: boolean;
    keyframesMatch: boolean;
    fontFaceMatch: boolean;
    idsMatch: boolean;
    dataAttrsMatch: boolean;
    sizeRatio: number;
    nodeRatio: number;
    missingScripts: string[];
    missingIds: string[];
    missingDataAttrs: string[];
  };
}

export interface ValidateOptions {
  minSizeRatio?: number;
  minNodeRatio?: number;
}

function diff(before: string[], after: string[]): string[] {
  const afterSet = new Set(after);
  return before.filter((x) => !afterSet.has(x));
}

export function fingerprintsOf(html: string): Fingerprints {
  return buildInventory(html).fingerprints;
}

export function validateStructure(
  before: Fingerprints,
  afterHtml: string,
  opts: ValidateOptions = {},
): ValidationReport {
  const after = fingerprintsOf(afterHtml);
  const minSizeRatio = opts.minSizeRatio ?? 0.9;
  const minNodeRatio = opts.minNodeRatio ?? 0.9;

  const missingScripts = diff(before.scripts, after.scripts);
  const missingIds = diff(before.ids, after.ids);
  const missingDataAttrs = diff(before.dataAttrs, after.dataAttrs);

  const scriptsMatch = missingScripts.length === 0 && after.scripts.length >= before.scripts.length;
  const keyframesMatch = after.keyframesCount >= before.keyframesCount;
  const fontFaceMatch = after.fontFaceCount >= before.fontFaceCount;
  const idsMatch = missingIds.length === 0;
  const dataAttrsMatch = missingDataAttrs.length === 0;

  const sizeRatio = before.bytes === 0 ? 1 : after.bytes / before.bytes;
  const nodeRatio = before.nodeCount === 0 ? 1 : after.nodeCount / before.nodeCount;

  const errors: string[] = [];
  if (!scriptsMatch) {
    errors.push(
      `scripts: ${missingScripts.length} missing out of ${before.scripts.length} ` +
        `(${before.scripts.length} → ${after.scripts.length})`,
    );
  }
  if (!keyframesMatch) {
    errors.push(`@keyframes: ${before.keyframesCount} → ${after.keyframesCount}`);
  }
  if (!fontFaceMatch) {
    errors.push(`@font-face: ${before.fontFaceCount} → ${after.fontFaceCount}`);
  }
  if (!idsMatch) {
    errors.push(`ids missing: ${missingIds.slice(0, 8).join(', ')}${missingIds.length > 8 ? '…' : ''}`);
  }
  if (!dataAttrsMatch) {
    errors.push(
      `data-attrs missing: ${missingDataAttrs.slice(0, 8).join(', ')}${missingDataAttrs.length > 8 ? '…' : ''}`,
    );
  }
  if (sizeRatio < minSizeRatio) {
    errors.push(`size ratio ${sizeRatio.toFixed(2)} < ${minSizeRatio}`);
  }
  if (nodeRatio < minNodeRatio) {
    errors.push(`node ratio ${nodeRatio.toFixed(2)} < ${minNodeRatio}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    details: {
      scriptsMatch,
      keyframesMatch,
      fontFaceMatch,
      idsMatch,
      dataAttrsMatch,
      sizeRatio,
      nodeRatio,
      missingScripts,
      missingIds,
      missingDataAttrs,
    },
  };
}
