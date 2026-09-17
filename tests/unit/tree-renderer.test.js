import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';

function forest(size = 32) {
  const world = new World(new THREE.Scene(), { size });
  world.height.fill(8); world.moisture.fill(.6); world.biome.fill(3);
  world.buildTreeMeshes();
  return world;
}
function checkSlots(world) {
  let total = 0;
  for (const [kind, cells] of Object.entries(world.treeCellsByKind)) {
    expect(world.nextTreeSlotByKind[kind]).toBe(cells.length);
    for (const mesh of [world.treeMeshes[kind].trunk, world.treeMeshes[kind].foliageA, world.treeMeshes[kind].foliageB]) expect(mesh.count).toBe(cells.length);
    cells.forEach((cell, slot) => expect(world.treeSlots.get(cell)).toEqual({ kind, slot }));
    total += cells.length;
  }
  expect(total).toBe(world.treeSlots.size);
}

describe('compact tree instances', () => {
  it('submits no empty slots and preserves moved transforms and visual variation on removal', () => {
    const world = forest();
    checkSlots(world);
    for (const x of [2, 4, 6, 8]) world.plantTree(x, 4, true);
    const cell = world.idx(8, 4), rec = world.treeSlots.get(cell);
    const matrix = new THREE.Matrix4(); world.treeMeshes[rec.kind].trunk.getMatrixAt(rec.slot, matrix);
    const jitter = world.treeJitterByKind[rec.kind][rec.slot];
    world.removeTree(2, 4); checkSlots(world);
    const moved = world.treeSlots.get(cell), result = new THREE.Matrix4();
    world.treeMeshes[moved.kind].trunk.getMatrixAt(moved.slot, result);
    expect(result.elements).toEqual(matrix.elements);
    expect(world.treeJitterByKind[moved.kind][moved.slot]).toBe(jitter);
    world.plantTree(10, 4, false); checkSlots(world);
    for (const x of [4, 6, 8, 10]) world.removeTree(x, 4);
    checkSlots(world); expect(world.treeSlots.size).toBe(0);
    world.dispose();
  });

  it('preserves per-cell appearance through kind changes, growth and save/restore', () => {
    const world = forest();
    for (let x = 2; x < 20; x++) world.plantTree(x, 4, x % 2 === 0);
    for (const x of [3, 7, 12]) world.removeTree(x, 4);
    const cell = world.idx(4, 4);
    world.biome[cell] = 8; world.temperature[cell] = -5;
    world.refreshTreeKind(4, 4); checkSlots(world);
    world.update(.3); checkSlots(world);
    const saved = world.serialize();
    const restored = forest(); restored.restore(saved); checkSlots(restored);
    expect(restored.treeState).toEqual(world.treeState);
    expect(restored.serialize().treeVisuals.sort((a, b) => a[0] - b[0])).toEqual(saved.treeVisuals.sort((a, b) => a[0] - b[0]));
    world.dispose(); restored.dispose();
  });
});

it('selects spatial LOD without deleting simulation trees and releases empty sectors', () => {
  const world = forest(96);
  for (const [x, z] of [[5, 5], [6, 5], [90, 90]]) world.plantTree(x, z, true);
  for (const set of Object.values(world.treeMeshes)) {
    set.asset = true;
    set.lods = [new THREE.IcosahedronGeometry(1, 0), new THREE.BoxGeometry(1, 1, 1)];
  }
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 1400);
  camera.position.set(0, 400, 400); camera.lookAt(0, 0, 0);
  world.updateVisuals(.1, camera);
  const renderer = world.treeRenderer;
  expect(renderer.stats.far).toBe(3);
  expect(renderer.stats.active).toBe(3);
  expect(renderer.group.children.every(mesh => mesh.frustumCulled && mesh.boundingSphere.radius > 0)).toBe(true);
  for (const set of Object.values(world.treeMeshes)) set.trunk.castShadow = false;
  world.updateVisuals(.1, camera);
  expect(renderer.group.children.every(mesh => !mesh.castShadow)).toBe(true);
  camera.position.set(-40, 10, -40); world.updateVisuals(.1, camera);
  expect(renderer.stats.full).toBeGreaterThan(0);
  expect(world.treeSlots.size).toBe(3);
  world.removeTree(5, 5); world.removeTree(6, 5); world.updateVisuals(.1, camera);
  expect(renderer.stats.active).toBe(1); expect(renderer.stats.batches).toBe(1);
  world.dispose(); expect(renderer.group.children).toHaveLength(0);
});

it('filters refreshed grass in the same frame instead of flashing the full reserve', () => {
  const world = forest();
  world.biome.fill(2); world.buildGrassMesh(); world.scatterGrass();
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 100, 0);
  world.updateVisuals(.3, camera); expect(world.grassMesh.count).toBe(0);
  world.scheduleGrassRefresh(0); world.updateVisuals(.01, camera);
  expect(world.grassCount).toBeGreaterThan(0);
  expect(world.grassMesh.count).toBe(0);
  world.dispose();
});
