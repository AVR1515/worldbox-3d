import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// Feature test: founding a settlement (and leveling it up) should flatten the ground under it,
// clear any trees standing there, and mark it as a dirt plaza — requested after real play showed
// houses sitting tilted on slopes and villages growing right through trees.
if (typeof document === 'undefined') {
  const fakeCtx = new Proxy({}, { get: () => () => fakeCtx });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };
}

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 64 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 2, seed: 909 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  const half = Math.floor(world.size / 2);
  let land = null;
  for (let r = 0; r < half && !land; r++) {
    for (let dz = -r; dz <= r && !land; dz++) for (let dx = -r; dx <= r && !land; dx++) {
      const x = half + dx, z = half + dz;
      if (world.isWater(x, z)) continue;
      const h = world.height[world.idx(x, z)];
      // Clear of both the water-line and mountain-top margins plantTree()/isFlatEnough() itself
      // enforces (WATER_LEVEL+0.3 .. MAX_H-3.5), and with room on every side for the radius-4
      // founding-ground checks below — a corner-of-the-map or coastline hit would fail those for
      // reasons unrelated to this test.
      if (h <= 6.5 || h >= 12.5 || x < 8 || x > world.size - 8 || z < 8 || z > world.size - 8) continue;
      const [wx, wz] = world.gridToWorld(x, z);
      land = { x, z, wx, wz };
    }
  }
  return { world, creatures, settlements, land };
}

describe('fundar o hacer crecer una aldea nivela y limpia su terreno', () => {
  it('aplana el terreno, borra los árboles y marca el piso de tierra en el radio de fundación', () => {
    const { world, creatures, settlements, land } = setup();
    // Deliberately plant a fully-grown tree right where the village will stand, and unevenly
    // raise a patch nearby inside the founding radius — both should be gone/flattened afterward.
    world.plantTree(land.x, land.z, true);
    expect(world.hasTree(land.x, land.z)).toBe(true);
    world.terraform(land.wx, land.wz, 2, 3); // bumps up a lopsided mound near the center

    const members = [
      creatures.spawn('human', land.wx, land.wz, { sex: 'm' }),
      creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'f' }),
      creatures.spawn('human', land.wx + 0.1, land.wz + 0.1, { sex: 'f' }),
    ];
    settlements.foundSettlement(land.wx, land.wz, members, 'human');

    let markedGround = 0, remainingTrees = 0, cellCount = 0;
    let minH = Infinity, maxH = -Infinity;
    world.forEachInRadius(land.x, land.z, 4, (x, z) => {
      const i = world.idx(x, z);
      cellCount++;
      if (world.settlementGround[i]) markedGround++;
      if (world.treeState[i] !== 0) remainingTrees++;
      minH = Math.min(minH, world.height[i]);
      maxH = Math.max(maxH, world.height[i]);
    });

    expect(cellCount).toBeGreaterThan(0);
    expect(markedGround).toBe(cellCount); // every cell in the founding radius is dirt plaza
    expect(remainingTrees).toBe(0); // the planted tree (and anything else) is gone
    expect(maxH - minH).toBeLessThan(0.5); // meaningfully flatter than the +3 mound just carved in
  });

  it('la casa recién fundada se planta sobre suelo ya marcado como plaza', () => {
    const { world, creatures, settlements, land } = setup();
    const members = [
      creatures.spawn('human', land.wx, land.wz, { sex: 'm' }),
      creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'f' }),
      creatures.spawn('human', land.wx + 0.1, land.wz + 0.1, { sex: 'f' }),
    ];
    settlements.foundSettlement(land.wx, land.wz, members, 'human');
    const s = settlements.settlements[0];
    expect(s.houses.length).toBeGreaterThan(0);
    const house = s.houses[0];
    const [hx, hz] = world.worldToGrid(house.x, house.z);
    expect(world.settlementGround[world.idx(hx, hz)]).toBe(1);
  });
});
