import * as fs from 'fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface DiffResult {
  totalPixels: number;        // of compared (cropped) region
  diffPixels: number;
  diffRatio: number;          // diffPixels / totalPixels (compared region)
  width: number;              // compared width
  height: number;             // compared height
  originalWidthA: number;
  originalHeightA: number;
  originalWidthB: number;
  originalHeightB: number;
}

/**
 * Diff deux PNGs et retourne le ratio de pixels différents.
 * Si les dimensions diffèrent, crop à la région commune la plus petite (pas de resize).
 * Les pixels en dehors de la région commune sont ignorés — inspecter originalWidth/Height
 * dans le résultat pour détecter un size mismatch silencieux.
 *
 * @param pathA Chemin vers le premier PNG
 * @param pathB Chemin vers le second PNG
 * @param outputDiffPath Si fourni, écrit l'image de diff à ce chemin
 * @param threshold Tolérance par-canal pixelmatch (0 strict, 1 très permissif). Défaut: 0.1.
 */
export function diffPng(
  pathA: string,
  pathB: string,
  outputDiffPath?: string,
  threshold = 0.1
): DiffResult {
  const imgA = PNG.sync.read(fs.readFileSync(pathA));
  const imgB = PNG.sync.read(fs.readFileSync(pathB));

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  // Si les tailles diffèrent, on crop à la plus petite
  const cropA = cropPng(imgA, width, height);
  const cropB = cropPng(imgB, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(cropA.data, cropB.data, diff.data, width, height, { threshold });

  if (outputDiffPath) {
    fs.writeFileSync(outputDiffPath, PNG.sync.write(diff));
  }

  const totalPixels = width * height;
  return {
    totalPixels,
    diffPixels,
    diffRatio: diffPixels / totalPixels,
    width,
    height,
    originalWidthA: imgA.width,
    originalHeightA: imgA.height,
    originalWidthB: imgB.width,
    originalHeightB: imgB.height,
  };
}

function cropPng(png: PNG, width: number, height: number): PNG {
  if (png.width === width && png.height === height) return png;
  const cropped = new PNG({ width, height });
  PNG.bitblt(png, cropped, 0, 0, width, height, 0, 0);
  return cropped;
}
