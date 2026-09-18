import { expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';
import { SettlementManager } from '../../js/settlements.js';
import { buildTerrainRoad, ROAD_LIFT } from '../../js/terrain-roads.js';

function worldWithHills() {
  const world = new World(new THREE.Scene(), { size: 24 });
  for (let z = 0; z < world.verts; z++) for (let x = 0; x < world.verts; x++) {
    world.height[world.idx(x, z)] = 8 + Math.sin(x * 1.2) * 1.5 + Math.cos(z * 0.9);
  }
  return world;
}

// Steep spans now get stair treads instead of a smooth ramp (js/terrain-roads.js's addStairs),
// so a tread/riser vertex intentionally sits at a stepped height rather than hugging the terrain
// underneath it — bound those instead of requiring an exact match, while still holding flat/gentle
// ground to the tight tolerance that catches a genuinely broken ramp.
function verifySurface(geometry, world, { stairTolerance = 0 } = {}) {
  const p = geometry.attributes.position;
  expect(p.count).toBeGreaterThan(0);
  for (let i = 0; i < p.count; i += 3) {
    for (const weights of [[1, 0, 0], [0.2, 0.3, 0.5], [0.5, 0.5, 0]]) {
      const v = new THREE.Vector3();
      for (let k = 0; k < 3; k++) v.addScaledVector(new THREE.Vector3().fromBufferAttribute(p, i + k), weights[k]);
      const delta = v.y - world.heightAtWorld(v.x, v.z);
      if (stairTolerance) expect(Math.abs(delta)).toBeLessThanOrEqual(stairTolerance);
      else expect(delta).toBeCloseTo(ROAD_LIFT, 4);
    }
  }
}

it('follows ridges, depressions and sideways slopes across every road triangle', () => {
  const world = worldWithHills();
  const road = buildTerrainRoad(world, [[-10, -8], [-3, -2], [3, 1], [10, 8]], 1.2);
  verifySurface(road, world);
  road.dispose(); world.dispose();
});

it('refreshes paths immediately when terrain changes only between the endpoints', () => {
  const world = worldWithHills();
  const manager = Object.create(SettlementManager.prototype);
  manager.world = world; manager.housePaths = new Map(); manager.tradeRoutes = new Map();
  manager.pathMesh = new THREE.Mesh(new THREE.BufferGeometry());
  manager.cityDetailMesh = new THREE.Mesh(new THREE.BufferGeometry());
  manager.houseMeshes = [new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))];
  const s = { x: 9, z: 0, houses: [{ slot: 0, x: -9, z: 0 }] };
  manager.settlements = [s];
  manager._syncPathInstance(s, s.houses[0]); manager._flushHousePaths();
  const before = manager.pathMesh.geometry.attributes.position.array.slice();
  for (let z = 10; z <= 14; z++) for (let x = 10; x <= 14; x++) world.height[world.idx(x, z)] += 3;
  manager.onTerrainChanged({ minX: 10, minZ: 10, maxX: 14, maxZ: 14 });
  expect(manager.pathMesh.geometry.attributes.position.array).not.toEqual(before);
  verifySurface(manager.pathMesh.geometry, world, { stairTolerance: 3 });
  manager.pathMesh.geometry.dispose();
  manager.houseMeshes[0].geometry.dispose(); manager.houseMeshes[0].material.dispose();
  for (const geometry of manager.housePaths.values()) geometry.dispose();
  world.dispose();
});

it('does not draw a road outside the map or under the ocean', () => {
  const world = worldWithHills();
  world.height.fill(3);
  const road = buildTerrainRoad(world, [[-40, 0], [40, 0]], 1);
  expect(road.attributes.position.count).toBe(0);
  road.dispose(); world.dispose();
});
