import { it, expect } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';
import { SettlementManager } from '../../js/settlements.js';

it('clears houses and both road types, prevents regrowth, and preserves nearby forest', () => {
  const world = new World(new THREE.Scene(), { size: 32 });
  world.height.fill(8); world.buildTreeMeshes();
  const manager = Object.create(SettlementManager.prototype);
  Object.assign(manager, {
    world, housePaths: new Map(), tradeRoutes: new Map(), group: new THREE.Group(),
    pathMesh: new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()),
    cityDetailMesh: new THREE.Mesh(new THREE.BufferGeometry()),
    houseMeshes: [new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2))],
    settlements: [{ x: 0, z: 0, houses: [{ slot: 0, x: -6, z: 0 }] }],
  });
  const points = [[-6, 0], [-3, 0], [0, 5], [1, 5], [8, 8]];
  for (const p of points) expect(world.plantTree(...world.worldToGrid(...p), true)).toBe(true);
  manager._syncPathInstance(manager.settlements[0], manager.settlements[0].houses[0]);
  const route = { nodes: [[0, 0], [0, 10]], group: new THREE.Group(), revealed: true };
  manager._layoutRoute(route); manager.tradeRoutes.set('1-2', route);
  manager._flushHousePaths();
  for (const p of points.slice(0, -1)) {
    const grid = world.worldToGrid(...p);
    expect(world.treeState[world.idx(...grid)]).toBe(0);
    expect(world.plantTree(...grid, true)).toBe(false);
  }
  expect(world.treeState[world.idx(...world.worldToGrid(8, 8))]).toBe(2);
  manager._disposeRoute(route); manager.tradeRoutes.clear();
  manager._flushHousePaths();
  expect(world.plantTree(...world.worldToGrid(0, 5), true)).toBe(true);
  for (const geometry of manager.housePaths.values()) geometry.dispose();
  manager.pathMesh.geometry.dispose(); manager.pathMesh.material.dispose();
  manager.houseMeshes[0].geometry.dispose(); manager.houseMeshes[0].material.dispose();
  world.dispose();
});
