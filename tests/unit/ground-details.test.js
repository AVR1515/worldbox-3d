import { it, expect } from 'vitest';
import * as THREE from 'three';
import { World, BIOME_IDS } from '../../js/world.js';
import { GroundDetails } from '../../js/ground-details.js';

it('recreates biome details deterministically and clears edited construction ground', () => {
  const world = new World(new THREE.Scene(), { size: 32 });
  world.height.fill(8); world.seed = 'details';
  const details = new GroundDetails(world);
  for (const biome of BIOME_IDS.filter(id => id !== 'ocean')) {
    world.biome.fill(BIOME_IDS.indexOf(biome));
    details.rebuild();
    expect(details.meshes.length, biome).toBeGreaterThan(0);
    const before = details.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
    details.rebuild();
    expect(details.meshes.map(mesh => Array.from(mesh.instanceMatrix.array))).toEqual(before);
    for (const mesh of details.meshes) expect(Number.isFinite(mesh.boundingSphere.radius)).toBe(true);
  }
  world.settlementGround.fill(1); details.rebuild(); expect(details.meshes).toHaveLength(0);
  details.dispose(); world.dispose();
});
