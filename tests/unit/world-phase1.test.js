import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG, World } from '../../js/world.js';

let world = null;

afterEach(() => {
  world?.dispose();
  world = null;
});

function generatedWorld() {
  world = new World(new THREE.Scene(), { size: 32 });
  world.generate({
    mapType: 'island',
    mountainLevel: 1,
    humidity: 'normal',
    climate: 'templado',
    waterLevel: 'normal',
    seed: 12345,
  });
  return world;
}

function firstLandCell(candidate) {
  for (let z = 2; z < candidate.size - 2; z++) {
    for (let x = 2; x < candidate.size - 2; x++) {
      const i = candidate.idx(x, z);
      const height = candidate.height[i];
      if (!candidate.isWater(x, z) && height > CONFIG.WATER_LEVEL + 0.3 && height < CONFIG.MAX_H - 3.5) {
        return { x, z, i };
      }
    }
  }
  throw new Error('El mundo de prueba no generó tierra');
}

describe('edición estable de biomas', () => {
  it('permite reemplazar un pantano y actualiza el tipo visual de sus árboles', () => {
    const candidate = generatedWorld();
    const cell = firstLandCell(candidate);
    candidate.removeTree(cell.x, cell.z);
    candidate.swampy[cell.i] = 1;
    candidate.moisture[cell.i] = 0.9;
    expect(candidate.plantTree(cell.x, cell.z, true)).toBe(true);
    expect(candidate.treeSlots.get(cell.i).kind).toBe('dry');

    candidate.paintBiome(cell.x, cell.z, 0, 0.92, true, false);

    expect(candidate.swampy[cell.i]).toBe(0);
    expect(candidate.treeSlots.get(cell.i).kind).toBe('round');
    expect(candidate._grassVisualDirty).toBe(true);
    candidate.updateVisuals(1);
    expect(candidate._grassVisualDirty).toBe(false);
  });

  it('elimina el agua fluvial cuando el terreno emerge sobre su superficie', () => {
    const candidate = generatedWorld();
    const cell = firstLandCell(candidate);
    candidate.height[cell.i] = 6;
    candidate.riverMask[cell.i] = 1;
    candidate.riverHeight[cell.i] = 6.1;

    candidate.terraform(cell.x, cell.z, 0, 1);

    expect(candidate.riverMask[cell.i]).toBe(0);
    expect(candidate.riverHeight[cell.i]).toBe(0);
    expect(candidate._riverVisualDirty).toBe(true);
  });

  it('recalcula solamente la región modificada del terreno', () => {
    const candidate = generatedWorld();
    const cell = firstLandCell(candidate);
    const geometry = candidate.terrainMesh.geometry;
    const fullAttributeLength = geometry.attributes.position.array.length;
    geometry.attributes.position.clearUpdateRanges();
    geometry.attributes.normal.clearUpdateRanges();

    candidate.terraform(cell.x, cell.z, 1, 0.25);

    const positionWork = geometry.attributes.position.updateRanges.reduce((sum, range) => sum + range.count, 0);
    const normalWork = geometry.attributes.normal.updateRanges.reduce((sum, range) => sum + range.count, 0);
    expect(positionWork).toBeGreaterThan(0);
    expect(positionWork).toBeLessThan(fullAttributeLength);
    expect(normalWork).toBeLessThan(fullAttributeLength);
  });
});
