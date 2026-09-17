import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';

// Regression: _maybeAddDock() only ever ran once, at founding, with a fixed 5-cell search
// radius — a village founded a little inland (outside that radius) never got a second chance
// once it grew close enough to the coast for its own footprint to reach the water (reported live:
// a populous, wall-having coastal-looking city that never got a dock and so never expanded by
// ship). Growing should re-check with a radius that scales with the settlement's own footprint.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 64 });
  // Land everywhere except a strip of ocean past x=26 (grid coords) — a straight coastline.
  world.height.fill(8);
  for (let z = 0; z <= world.size; z++) for (let x = 26; x <= world.size; x++) world.height[world.idx(x, z)] = 2;
  world.rebuildEcology();
  world.buildTerrainMesh();
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  return { world, settlements };
}

describe('los muelles se revisan de nuevo al crecer una ciudad, no solo al fundarla', () => {
  it('una ciudad fundada tierra adentro consigue muelle al crecer lo bastante para alcanzar la costa', () => {
    const { world, settlements } = setup();
    // Grid x=16 is 10 cells from the coastline at x=26 — past the old fixed radius (5) and this
    // settlement's own level-0 check radius (RADIUS_BY_LEVEL[0]+3 = 7), but within reach once it
    // grows to level 3 (RADIUS_BY_LEVEL[3]+3 = 16).
    const [wx, wz] = world.gridToWorld(16, 32);
    const settlement = {
      id: 1, x: wx, z: wz, level: 0, houses: [], farms: [], empireId: 1, race: 'human',
      name: 'Villa interior', pop: 10, loyalty: 100,
      resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
    };
    settlements.settlements.push(settlement);
    settlements._maybeAddDock(settlement);
    expect(settlements.docks.has(settlement.id)).toBe(false);

    settlement.level = 3;
    settlements.onLevelUp(settlement, 0);
    expect(settlements.docks.has(settlement.id)).toBe(true);
    expect(settlement.dockPoint).toBeTruthy();
  });
});

for (const angle of [0, Math.PI / 3, Math.PI, Math.PI * 1.5]) it('aligns deck endpoints and posts toward water at ' + angle, () => {
  const {world, settlements} = setup();
  world.isWater = (gx,gz) => {
    const [x,z] = world.gridToWorld(gx,gz);
    return x*Math.cos(angle)+z*Math.sin(angle) > 2;
  };
  const settlement = {id: 10, x:0, z:0, level:0};
  settlements.addDock(settlement);
  const dock = settlements.docks.get(10), deck = dock.children[0];
  dock.updateMatrixWorld(true);
  const length=deck.geometry.parameters.depth;
  const start=deck.localToWorld(new THREE.Vector3(0,0,-length/2));
  const end=deck.localToWorld(new THREE.Vector3(0,0,length/2));
  expect(start.x).toBeCloseTo(dock.position.x,6);
  expect(start.z).toBeCloseTo(dock.position.z,6);
  expect(end.x).toBeCloseTo(settlement.dockPoint.x,6);
  expect(end.z).toBeCloseTo(settlement.dockPoint.z,6);
  for(const post of dock.children.slice(1,7)) {
    const p=deck.worldToLocal(post.getWorldPosition(new THREE.Vector3()));
    expect(Math.abs(p.x)).toBeLessThan(deck.geometry.parameters.width/2);
    expect(Math.abs(p.z)).toBeLessThan(length/2);
  }
});
