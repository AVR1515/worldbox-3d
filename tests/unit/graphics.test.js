import { expect, it } from 'vitest';
import * as THREE from 'three';
import { resolveGraphics, GRAPHICS_PRESETS } from '../../js/graphics-config.js';
import { World } from '../../js/world.js';
import { DayNightCycle } from '../../js/daynight.js';

it('offers four presets with independent overrides and safe legacy defaults', () => {
  expect(Object.keys(GRAPHICS_PRESETS)).toEqual(['low', 'medium', 'high', 'ultra']);
  expect(resolveGraphics({ quality: 'ultra', water: 'basic', wind: 'off' })).toMatchObject({ water: 0, wind: false, shadowSize: 4096, ambientOcclusion: true });
  expect(resolveGraphics({ quality: 'invalid', resolution: 'invalid' })).toEqual(resolveGraphics());
  expect(resolveGraphics({ quality: 'ultra', reducedMotion: true }).wind).toBe(false);
  expect(resolveGraphics({ quality: 'ultra' }).ambientOcclusionResolution).toBe(0.5);
  expect(resolveGraphics({ ambientOcclusionResolution: '1' }).ambientOcclusionResolution).toBe(1);
  expect(resolveGraphics({ ambientOcclusionResolution: '-1' }).ambientOcclusionResolution).toBe(0.5);
});

it('updates the coast depth map after terraforming and switches water without changing terrain', () => {
  const world = new World(new THREE.Scene(), { size: 16 });
  world.height.fill(4);
  world.buildTerrainMesh();
  world.buildWaterMesh();
  const before = world.height.slice();
  world.setGraphics({ quality: 'ultra' });
  expect(world.height).toEqual(before);
  const i = world.idx(8, 8), texture = world._seabedTexture;
  world.height[i] = 8;
  world.writeVertex(8, 8);
  world.refreshTerrainRegion();
  expect(texture.image.data[i * 4]).toBe(Math.round(8 / 17 * 255));
  expect(world._waterQualityUniform.value).toBe(3);
  world.dispose();
});

it('keeps daylight illumination on when leaving aerial view', () => {
  const sun = new THREE.DirectionalLight(), hemi = new THREE.HemisphereLight();
  const rig = { aerial: false, distance: 40, target: new THREE.Vector3() };
  const cycle = new DayNightCycle({ fog: new THREE.Fog(), sun, hemi, rig, renderSystem: { updateSky() {} }, dayCounterEl: {} });
  cycle.lockDay = true;
  cycle.update();
  expect(sun.intensity).toBeGreaterThan(1);
  expect(hemi.intensity).toBeGreaterThan(0.3);
  expect(hemi.intensity).toBeLessThan(0.5);
  expect(sun.shadow.camera.right).toBe(28);
});

it('culls distant blades while preserving the grass layout for a return to ground view', () => {
  const world = new World(new THREE.Scene(), { size: 16 });
  world.setGraphics({ quality: 'ultra' });
  world.height.fill(7); world.moisture.fill(0.5); world.biome.fill(2);
  world.buildGrassMesh(); world.scatterGrass();
  const total = world.grassCount, layout = world._grassMatrices.slice();
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 100, 0);
  world.updateVisuals(0.3, camera);
  expect(world.grassMesh.count).toBe(0);
  camera.position.set(0, 10, 0);
  world.updateVisuals(0.3, camera);
  expect(world.grassMesh.count).toBe(total);
  expect(world._grassMatrices).toEqual(layout);
  world.dispose();
});
