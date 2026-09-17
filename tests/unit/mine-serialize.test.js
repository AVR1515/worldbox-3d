import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { World } from '../../js/world.js';

// Regression test: a mine building carries a live Three.js `mesh` (see buildMineMesh() in
// civilization-system.js — it's cloned individually instead of living in a shared InstancedMesh
// like every other building type). That mesh sits in the scene graph, so it has circular
// parent/children references. serialize() has to strip it before the save system's
// JSON.stringify(encodeSnapshotForStorage(snapshot)) ever sees it, or saving a game with so much
// as one mine building would throw "Converting circular structure to JSON" and lose the save.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 11 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
  disposable.push(world, creatures, settlements, civilization);
  return { world, settlements, civilization };
}

describe('las minas no rompen el guardado', () => {
  it('serialize() no incluye el mesh de la mina y JSON.stringify no lanza', () => {
    const { settlements, civilization } = setup();
    const empire = settlements.createEmpire();
    const settlement = { id: 1, x: 0, z: 0, level: 1, houses: [], farms: [], empireId: empire.id, race: 'human', name: 'Prueba', pop: 5, loyalty: 100, growTimer: 999, emptyTimer: 0, resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 } };
    settlements.settlements.push(settlement);
    civilization.productionSites.set(settlement.id, { settlementId: settlement.id, buildings: [{ type: 'mine', level: 1, health: 120 }], siegeHealth: 100 });
    civilization._visualDirty = true;
    civilization.getBuildingObstacles(); // forces _rebuildBuildingVisuals(), which creates building.mesh

    const mineBuilding = civilization.productionSites.get(settlement.id).buildings[0];
    expect(mineBuilding.mesh).toBeTruthy(); // sanity check: the thing we're guarding against exists

    const snapshot = civilization.serialize();
    const serializedMine = snapshot.productionSites[0].buildings[0];
    expect(serializedMine.mesh).toBeUndefined();
    expect(serializedMine.type).toBe('mine');
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });
});
