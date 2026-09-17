import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CreatureManager, CREATURE_DEFINITIONS } from '../../js/creatures.js';
import { World } from '../../js/world.js';

// Regression tests for a chain of bugs reported after real play: a long-running world settled
// into nothing but herbivores, with boar and bear never appearing at all. Root causes, all in
// creatures.js unless noted:
//  1. Boar and bear had no reproduction path anywhere — _decideWildPack only ever fled, hunted,
//     or wandered. Their numbers could only ever fall.
//  2. Boar had no way to reduce hunger at all (herbivore forages, carnivore/bear reset hunger on
//     a kill) — every boar starved on a fixed timer regardless of anything else.
//  3. main.js's seedInitialPopulation() never spawned a single boar or bear into a new world.
//  4. A fleeing creature's 1.6x speed boost let prey outrun even a faster predator (carnivore
//     2.1 vs herbivore's boosted 2.56), so a chase that started never ended.
//  5. Bear (1.55 speed) was nominally slower than its own prey, herbivore (1.6), even at full
//     speed with nothing fleeing.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup(laws = {}) {
  const scene = new THREE.Scene();
  // Large enough that a multi-second chase (the hunting test below) doesn't drift into the map
  // edge and get its pursuit dynamics muddled by boundary effects unrelated to what's tested.
  const world = new World(scene, { size: 96 });
  world.height.fill(8); world.jitter.fill(1); world.moisture.fill(.5); world.temperature.fill(18);
  world.biome.fill(2); // grassland — forageable
  world.rebuildEcology(); world.buildTerrainMesh();
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, disease: false, ...laws } });
  disposable.push(world, creatures);
  return { world, creatures };
}

describe('boar y oso pueden reproducirse (antes _decideWildPack nunca lo intentaba)', () => {
  it('dos jabalís bien alimentados y cercanos producen una cría', () => {
    const { creatures } = setup({ hunger: false, reproduction: true });
    const a = creatures.spawn('boar', 0, 0);
    const b = creatures.spawn('boar', 0.5, 0.5);
    a.age = b.age = 10; a.health = b.health = 100; a.hunger = b.hunger = 5;
    a.reproCooldown = b.reproCooldown = 0;
    const before = creatures.count('boar');
    for (let i = 0; i < 40 && creatures.count('boar') === before; i++) creatures.update(0.4, 1);
    expect(creatures.count('boar')).toBeGreaterThan(before);
  });

  it('dos osos bien alimentados y cercanos producen una cría', () => {
    const { creatures } = setup({ hunger: false, reproduction: true });
    const a = creatures.spawn('bear', 0, 0);
    const b = creatures.spawn('bear', 0.5, 0.5);
    a.age = b.age = 10; a.health = b.health = 100; a.hunger = b.hunger = 5;
    a.reproCooldown = b.reproCooldown = 0;
    const before = creatures.count('bear');
    for (let i = 0; i < 40 && creatures.count('bear') === before; i++) creatures.update(0.4, 1);
    expect(creatures.count('bear')).toBeGreaterThan(before);
  });
});

describe('el jabalí ahora puede comer (antes su hambre solo subía, sin tope)', () => {
  it('un jabalí sobre pasto forrajea y su hambre baja con el tiempo', () => {
    const { creatures } = setup({ hunger: true, reproduction: false });
    const boar = creatures.spawn('boar', 0, 0);
    boar.hunger = 50;
    for (let i = 0; i < 60; i++) creatures.update(0.3, 1);
    expect(boar.hunger).toBeLessThan(50);
  });
});

describe('un depredador ya no puede quedar atascado persiguiendo presas eternamente', () => {
  it('el herbívoro en huida sigue siendo más lento que el carnívoro que lo persigue', () => {
    const herbivoreTopSpeed = CREATURE_DEFINITIONS.herbivore.speed * 1.2; // fleeMul, see the movement code
    expect(CREATURE_DEFINITIONS.carnivore.speed).toBeGreaterThan(herbivoreTopSpeed);
  });

  it('el oso ya no es más lento que su propia presa (herbívoro) en velocidad base', () => {
    expect(CREATURE_DEFINITIONS.bear.speed).toBeGreaterThan(CREATURE_DEFINITIONS.herbivore.speed);
  });

  it('un carnívoro alcanza y caza a un herbívoro en huida sobre terreno llano en un tiempo razonable', () => {
    const { creatures } = setup({ hunger: true, reproduction: false });
    const herb = creatures.spawn('herbivore', 6, 0);
    const carn = creatures.spawn('carnivore', 0, 0);
    carn.hunger = 45; // already above the 40 threshold that starts a hunt
    // Before the fleeMul/bear-speed/repath fixes, this chase's distance never closed at all — the
    // fleeing herbivore's boosted speed (1.6*1.6=2.56) exceeded the hunting carnivore's own (2.1),
    // so it was mathematically impossible to ever come within striking range, however long it ran.
    // Asserting the minimum distance ever reached (rather than a completed kill) checks exactly
    // that fixed property without depending on this run's random attack-roll outcomes — whether a
    // fleeing target happens to wriggle free between hits and needs a second approach is a separate,
    // probabilistic combat-resolution concern this test isn't about.
    let minDist = Infinity;
    for (let i = 0; i < 1800 && herb.alive; i++) {
      creatures.update(1 / 30, 1);
      if (herb.alive) minDist = Math.min(minDist, Math.hypot(carn.x - herb.x, carn.z - herb.z));
    }
    expect(minDist).toBeLessThan(1);
  });
});
