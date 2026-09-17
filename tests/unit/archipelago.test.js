import { describe, expect, it } from 'vitest';
import { generateBaseTerrain } from '../../js/world-generation.js';

function landmasses(height, size) {
  const verts = size + 1, visited = new Uint8Array(height.length), groups = [];
  for (let i = 0; i < height.length; i++) {
    if (visited[i] || height[i] <= 5) continue;
    const cells = [i];
    visited[i] = 1;
    for (let k = 0; k < cells.length; k++) {
      const x = cells[k] % verts, z = Math.floor(cells[k] / verts);
      // Count diagonal contact as a bridge too.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz, j = nz * verts + nx;
        if (nx < 0 || nz < 0 || nx > size || nz > size || visited[j] || height[j] <= 5) continue;
        visited[j] = 1; cells.push(j);
      }
    }
    groups.push(cells.length);
  }
  return groups.sort((a, b) => b - a);
}

describe('archipiélagos separados', () => {
  for (const size of [132, 180, 240]) {
    it(`mantiene varias islas habitables en el tamaño ${size} con todos los niveles de agua y montaña`, () => {
      for (const seed of [1, 5, 4872, 12345]) {
        for (const mountainLevel of [0, 1, 2]) for (const waterLevelPreset of ['bajo', 'normal', 'alto']) {
          const { height } = generateBaseTerrain({ size, seed, mapType: 'archipelago', mountainLevel, waterLevelPreset, maxHeight: 17 });
          const groups = landmasses(height, size);
          const land = groups.reduce((a, b) => a + b, 0);
          expect(groups.filter(area => area >= size * size * 0.001).length).toBeGreaterThanOrEqual(5);
          expect(groups[0] / land).toBeLessThan(0.45);
          expect(land / height.length).toBeGreaterThan(0.25);
          expect(land / height.length).toBeLessThan(0.65);
        }
      }
    }, 15000); // 36 generaciones y análisis de conectividad; no es un presupuesto de rendimiento.
  }

  it('reproduce el mismo archipiélago con la misma semilla', () => {
    const opts = { size: 132, seed: 8231, mapType: 'archipelago', maxHeight: 17 };
    const first = generateBaseTerrain(opts), second = generateBaseTerrain(opts);
    expect(second.height).toEqual(first.height);
    expect(second.moisture).toEqual(first.moisture);
    expect(second.rngState).toBe(first.rngState);
    expect(generateBaseTerrain({ ...opts, seed: 8232 }).height).not.toEqual(first.height);
  });

  it('ofrece llanuras extensas sin convertir cada isla en una montaña', () => {
    for (const seed of [1, 5, 4872, 12345]) {
      const size = 180, verts = size + 1;
      const { height } = generateBaseTerrain({ size, seed, mapType: 'archipelago', maxHeight: 17 });
      let land = 0, flatLand = 0, highLand = 0;
      for (let z = 1; z < size; z++) for (let x = 1; x < size; x++) {
        const i = z * verts + x, h = height[i];
        if (h <= 5) continue;
        land++;
        if (h >= 12) highLand++;
        if ([i - 1, i + 1, i - verts, i + verts].every(j => Math.abs(height[j] - h) < 0.3)) flatLand++;
      }
      // Include the sloping beaches in the denominator, not just the interior.
      expect(flatLand / land).toBeGreaterThan(0.4);
      expect(highLand / land).toBeLessThan(0.05);
    }
  });
});
