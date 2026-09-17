import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { CONFIG, World } from '../../js/world.js';

// Regression tests for a bug reported after real play: a brand-new settlement (never attacked)
// could still starve its entire founding population to zero. Root cause had two parts, each
// covered here — see the "Por qué" comments in settlements.js's foundSettlement() and
// creatures.js's _feedCreature() for the full reasoning.

// foundSettlement() calls addLabel(), which draws the city name onto a <canvas> for a sprite
// texture — real DOM work this suite's plain-Node environment doesn't have. Every other method
// under test here runs fine without it; this is the minimum fake needed to let foundSettlement()
// itself run so its Agricultor-guarantee can be checked directly instead of only inferring it.
if (typeof document === 'undefined') {
  const fakeCtx = new Proxy({}, { get: () => () => fakeCtx });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };
}

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup(laws = {}) {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 32 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 1, seed: 4421 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false, ...laws } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  // Scan out from the center rather than from a corner: a corner-first scan on a small island
  // map tends to land right at the coastline, where height clears isWater() but not the extra
  // margin _feedCreature's `forageable` check requires (height > WATER_LEVEL + 0.3) — that had
  // nothing to do with the fix under test but made the citizen unfeedable either way and
  // produced a false failure the first time this test was written.
  const half = Math.floor(world.size / 2);
  let land = null;
  for (let r = 0; r < half && !land; r++) {
    for (let dz = -r; dz <= r && !land; dz++) for (let dx = -r; dx <= r && !land; dx++) {
      const x = half + dx, z = half + dz;
      if (world.isWater(x, z) || !world.isFlatEnough(x, z, 1.6)) continue;
      const [wx, wz] = world.gridToWorld(x, z);
      const h = world.heightAtWorld(wx, wz);
      // Match _feedCreature's `forageable` window on both ends: a corner scan can land right at
      // the coast (fails the lower bound), and scanning outward from the center of a small
      // island map can just as easily land on the summit instead (fails the upper bound) —
      // neither has anything to do with the fix under test, just with finding a tile the
      // citizen can actually forage on at all.
      if (h <= CONFIG.WATER_LEVEL + 0.3 || h >= CONFIG.MAX_H - 4) continue;
      land = { x, z, wx, wz };
    }
  }
  return { world, creatures, settlements, land };
}

describe('una aldea fundada con el mínimo de colonos siempre tiene comida', () => {
  it('foundSettlement() garantiza al menos un Agricultor entre los fundadores', () => {
    // Run several times: the bug was probabilistic (~1-in-6 chance of zero food producers
    // among 3 colonists before the fix), so a single lucky roll wouldn't have caught it.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { creatures, settlements, land } = setup();
      const members = [
        creatures.spawn('human', land.wx, land.wz, { sex: 'm' }),
        creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'f' }),
        creatures.spawn('human', land.wx + 0.1, land.wz + 0.1, { sex: 'f' }),
      ];
      settlements.foundSettlement(land.wx, land.wz, members, 'human');
      expect(members.some(member => member.profession === 'Agricultor')).toBe(true);
    }
  });

  it('un ciudadano con aldea sin comida busca alimento por su cuenta en vez de quedarse a morir', () => {
    const { creatures, settlements, land } = setup({ hunger: true });
    const empire = settlements.createEmpire();
    const settlement = {
      id: 1, x: land.wx, z: land.wz, level: 0, houses: [], farms: [], empireId: empire.id, race: 'human',
      name: 'Aldea sin comida', pop: 1, loyalty: 100, growTimer: 999, emptyTimer: 0,
      resources: { wood: 0, food: 0, stone: 0, gold: 0, gems: 0 },
    };
    settlements.settlements.push(settlement);
    // La prueba aísla la alimentación básica: el rasgo glotón eleva legítimamente el consumo.
    const citizen = creatures.spawn('human', land.wx, land.wz, { sex: 'm', traits: [] });
    creatures.setHome(citizen, settlement.id, empire.id, settlement.x, settlement.z, 8);
    citizen.hunger = 90;

    // Pin the citizen in place: this test is about the feeding math specifically, not about
    // where a solitary, undirected citizen's own AI might wander in 20 simulated seconds — an
    // unrelated wander step onto a tile that fails `forageable` (water, a cliff) would make this
    // test flaky in either direction, for a reason that has nothing to do with the fix.
    for (let i = 0; i < 40; i++) {
      creatures.update(0.5);
      citizen.x = land.wx; citizen.z = land.wz;
    }

    expect(citizen.alive).toBe(true);
    expect(citizen.hunger).toBeLessThan(90);
    expect(settlement.resources.food).toBe(0); // never had any income in this test — confirms the fix isn't just draining a hidden stockpile
  });
});
