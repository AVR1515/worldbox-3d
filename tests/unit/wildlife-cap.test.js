import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CreatureManager, CREATURE_DEFINITIONS } from '../../js/creatures.js';
import { World } from '../../js/world.js';

// Regression test for a bug reported after real play: wildlife caps (herbivore/carnivore/etc.)
// were flat counts, so a 'pequeño' map (132) ended up just as crowded with animals as a 'grande'
// one (240) — the small map read as blanketed in wildlife. See _effectiveCap()'s comment in
// creatures.js: the cap now scales by map area relative to the 'mediano' (180) preset it was
// originally tuned against.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function fillWithHerbivores(size) {
  const scene = new THREE.Scene();
  const world = new World(scene, { size });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 17 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  disposable.push(world, creatures);
  // Try to spawn far more herbivores than any plausible cap could allow, on every land cell —
  // whatever the cap actually stops at is the real effective cap for this map size.
  for (let gz = 0; gz < world.size; gz += 1) {
    for (let gx = 0; gx < world.size; gx += 1) {
      if (world.isWater(gx, gz)) continue;
      const [wx, wz] = world.gridToWorld(gx, gz);
      creatures.spawn('herbivore', wx, wz);
    }
  }
  return creatures.count('herbivore');
}

describe('los topes de fauna silvestre escalan con el tamaño del mapa', () => {
  it('un mapa pequeño termina con muchos menos animales que uno grande', () => {
    const small = fillWithHerbivores(132);
    const large = fillWithHerbivores(240);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    // Area ratio (132/180)^2 ≈ 0.538 vs (240/180)^2 ≈ 1.778 — roughly 3.3x apart, not identical
    // like the flat cap used to produce.
    expect(large / small).toBeGreaterThan(2);
  });

  it('coincide con la fórmula de área usada en _effectiveCap() para el tamaño "mediano" (180)', () => {
    const scene = new THREE.Scene();
    const world = new World(scene, { size: 180 });
    world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 17 });
    const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
    disposable.push(world, creatures);
    for (let gz = 0; gz < world.size; gz += 1) {
      for (let gx = 0; gx < world.size; gx += 1) {
        if (world.isWater(gx, gz)) continue;
        const [wx, wz] = world.gridToWorld(gx, gz);
        creatures.spawn('herbivore', wx, wz);
      }
    }
    // At the reference size, the area ratio is 1 — the effective cap should equal the authored one.
    expect(creatures.count('herbivore')).toBe(CREATURE_DEFINITIONS.herbivore.cap);
  });
});
