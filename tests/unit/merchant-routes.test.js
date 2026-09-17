import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// Regression tests for a bug reported after real play: merchant caravans walked in a straight
// line between two capitals regardless of what was in between (water, hills, buildings) instead
// of following the same road _syncTradeRoutes() already builds for the visible trade-route mesh.
// See the "A land cart can only follow an actual road" comment in settlements.js's
// _trySendMerchant().
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 33 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  return { world, settlements };
}

function makeSettlement(settlements, empireId, id, x, z) {
  const s = {
    id, x, z, level: 1, houses: [], farms: [], empireId, race: 'human',
    name: `Ciudad ${id}`, pop: 10, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

describe('las caravanas mercantes siguen el camino real, no una línea recta', () => {
  it('_trySendMerchant() usa los nodos de la ruta ya calculada, no from/to en línea recta', () => {
    const { settlements } = setup();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // picks empire[0]/candidate[0], clears the 0.35 roll
    try {
      const empireA = settlements.createEmpire();
      const empireB = settlements.createEmpire();
      const capA = makeSettlement(settlements, empireA.id, 1, 0, 0);
      const capB = makeSettlement(settlements, empireB.id, 2, 30, 0);
      empireA.capitalId = capA.id;
      empireB.capitalId = capB.id;

      // An L-shaped road, not the straight line the old code walked — the midpoint of this path
      // (by arc length) is nowhere near the geometric midpoint between capA and capB.
      const key = empireA.id < empireB.id ? `${empireA.id}-${empireB.id}` : `${empireB.id}-${empireA.id}`;
      const nodes = [[0, 0], [0, 20], [30, 20], [30, 0]];
      settlements.tradeRoutes.set(key, { capA: capA.id, capB: capB.id, nodes, group: new THREE.Group() });

      settlements._trySendMerchant();
      expect(settlements.merchants).toHaveLength(1);
      const merchant = settlements.merchants[0];
      expect(merchant.nodes).toEqual(nodes);

      // Halfway along the L-shaped path (by arc length, total 70) sits at [0, 20] -> [15, 20],
      // nowhere near the straight-line midpoint [15, 0] the old from/to interpolation used.
      merchant.t = merchant.duration / 2;
      settlements._updateMerchants(0); // dt=0: just resample position at the current t, don't advance it
      expect(merchant.mesh.position.x).toBeCloseTo(15, 0);
      expect(merchant.mesh.position.z).toBeCloseTo(20, 0);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('no genera una carreta si no existe una ruta terrestre entre las capitales (mar de por medio)', () => {
    const { settlements } = setup();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const empireA = settlements.createEmpire();
      const empireB = settlements.createEmpire();
      const capA = makeSettlement(settlements, empireA.id, 1, 0, 0);
      const capB = makeSettlement(settlements, empireB.id, 2, 30, 0);
      empireA.capitalId = capA.id;
      empireB.capitalId = capB.id;
      // No entry in tradeRoutes for this pair — exactly what _syncTradeRoutes() leaves when
      // _nodesCrossOcean() finds open sea between the two capitals; ships.js handles that case.
      settlements._trySendMerchant();
      expect(settlements.merchants).toHaveLength(0);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
