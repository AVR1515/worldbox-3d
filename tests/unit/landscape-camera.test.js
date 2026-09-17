import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CameraRig } from '../../js/camera.js';
import { World, BIOME_IDS, CONFIG } from '../../js/world.js';

afterEach(() => vi.unstubAllGlobals());

it('restores the complete orbit after moving and zooming in aerial view', () => {
  vi.stubGlobal('window', { addEventListener() {} });
  const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 10000);
  const rig = new CameraRig(camera, { addEventListener() {} }, new THREE.Vector3(12, 3, -19));
  rig.distance = 37;
  rig.polar = 0.85;
  rig.azimuth = 1.7;
  rig.update(0);
  const position = camera.position.clone(), quaternion = camera.quaternion.clone();
  for (let cycle = 0; cycle < 2; cycle++) {
    rig.setAerial(true, 240);
    rig.target.set(-50, 0, 40);
    rig.distance = 350;
    rig.setAerial(true, 240, false);
    rig.setAerial(false);
    rig.update(0);
    expect(camera.position.distanceTo(position)).toBeLessThan(1e-10);
    expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(1e-7);
    expect(rig.maxDist).toBe(240);
  }
  rig.distance = 60;
  rig.setAerial(false);
  expect(rig.distance).toBe(60);
});

it('covers green land while keeping beaches, deserts and cleared ground free of grass', () => {
  const world = new World(new THREE.Scene(), { size: 16 });
  world.setGraphics({ quality: 'ultra' });
  world.height.fill(CONFIG.WATER_LEVEL + 2);
  world.moisture.fill(0.5);
  world.temperature.fill(20); // colorAt() blends toward a cold tint below this — generate() always sets it
  world.biome.fill(BIOME_IDS.indexOf('grassland'));
  world.jitter.fill(1);
  world.buildGrassMesh();
  try {
    world.scatterGrass();
    expect(world.grassCount).toBe(225);
    const green = world.colorAt(world.idx(8, 8)).clone();
    expect(green.g).toBeGreaterThan(green.r * 1.5);
    for (const biome of ['beach', 'desert', 'ocean', 'volcanic', 'tundra']) {
      world.biome.fill(BIOME_IDS.indexOf(biome));
      world.scatterGrass();
      expect(world.grassCount).toBe(0);
      expect(world.grassMesh.count).toBe(0);
    }
    world.biome.fill(BIOME_IDS.indexOf('grassland'));
    world.settlementGround.fill(1);
    world.scatterGrass();
    expect(world.grassCount).toBe(0);
  } finally { world.dispose(); }
});
