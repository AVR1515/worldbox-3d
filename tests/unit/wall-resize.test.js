import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// Regression test for a wall shape reported as broken after real play: a ring that didn't fully
// enclose its city, with segments trailing off toward nothing. Root cause: two "Gran ciudad"
// (max-level) neighbors each get their own ~14.6-radius wall ring, but MIN_SETTLEMENT_DIST (the
// closest two settlements can ever be founded) only cleared ONE of those radii, not both summed
// — so at the minimum distance, a real pair of max-level neighbors had their rings overlap by
// several units. Part of one city's ring would sit closer to the *other* city than to its own,
// which is exactly what "a wall segment that doesn't enclose anything" looks like from most
// camera angles. Fixed in settlements.js by widening MIN_SETTLEMENT_DIST to clear both radii.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 64 });
  world.generate({ mapType: 'continents', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 7 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  let cx = null, cz = null;
  outer: for (let z = 20; z < world.size - 20; z++) {
    for (let x = 20; x < world.size - 20; x++) {
      if (!world.isWater(x, z) && world.isFlatEnough(x, z, 1.6)) { const [wx, wz] = world.gridToWorld(x, z); cx = wx; cz = wz; break outer; }
    }
  }
  return { world, settlements, cx, cz };
}

function makeSettlement(settlements, empireId, id, x, z, level) {
  const s = {
    id, x, z, level, houses: [], farms: [], empireId, race: 'human',
    name: `Ciudad ${id}`, pop: 20, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

function segmentsCloserToOther(wallSelf, self, other) {
  return wallSelf.children.filter(seg => {
    const dSelf = Math.hypot(seg.position.x - self.x, seg.position.z - self.z);
    const dOther = Math.hypot(seg.position.x - other.x, seg.position.z - other.z);
    return dOther < dSelf;
  });
}

describe('murallas de dos ciudades vecinas al nivel máximo', () => {
  // Mirrors settlements.js's real MIN_SETTLEMENT_DIST (not imported — it's module-private).
  // Keep this in sync if that constant changes; a mismatch here would silently stop testing
  // the actual current minimum.
  const MIN_SETTLEMENT_DIST = 32;

  it('a la distancia mínima real de fundación, los anillos de nivel 3 ya NO se superponen', () => {
    const { settlements, cx, cz } = setup();
    const empireA = settlements.createEmpire();
    const empireB = settlements.createEmpire();
    const a = makeSettlement(settlements, empireA.id, 1, cx, cz, 3);
    const b = makeSettlement(settlements, empireB.id, 2, cx + MIN_SETTLEMENT_DIST, cz, 3);
    settlements._syncDefenses(a);
    settlements._syncDefenses(b);

    const wallA = settlements.walls.get(a.id);
    const wallB = settlements.walls.get(b.id);
    expect(wallA.children.length).toBeGreaterThan(0);
    expect(wallB.children.length).toBeGreaterThan(0);
    expect(segmentsCloserToOther(wallA, a, b)).toHaveLength(0);
    expect(segmentsCloserToOther(wallB, b, a)).toHaveLength(0);
  });

  it('una ciudad pequeña no ocupa un anillo vacío de radio máximo', () => {
    const { settlements, cx, cz } = setup();
    const empireA = settlements.createEmpire();
    const empireB = settlements.createEmpire();
    const OLD_MIN_SETTLEMENT_DIST = 22;
    const a = makeSettlement(settlements, empireA.id, 1, cx, cz, 3);
    const b = makeSettlement(settlements, empireB.id, 2, cx + OLD_MIN_SETTLEMENT_DIST, cz, 3);
    settlements._syncDefenses(a);
    settlements._syncDefenses(b);
    const wallA = settlements.walls.get(a.id);
    expect(segmentsCloserToOther(wallA, a, b)).toHaveLength(0);
    expect(Math.max(...wallA.children.map(p => Math.hypot(p.position.x-a.x, p.position.z-a.z)))).toBeLessThan(7);
  });
});
