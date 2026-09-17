import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { World } from '../../js/world.js';

const disposable = [];
afterEach(() => { vi.restoreAllMocks(); while (disposable.length) disposable.pop().dispose(); });
function setup(laws = {}) {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 32 });
  world.generate({ mapType: 'island', seed: 17, mountainLevel: 0 });
  const creatures = new CreatureManager(scene, world, { laws: { hunger: false, aging: false, reproduction: false, disease: false, ...laws } });
  disposable.push(world, creatures);
  const point = world.gridToWorld(16, 16);
  const spawn = type => {
    const c = creatures.spawn(type, ...point);
    expect(c).toBeTruthy();
    c.aiTimer = 999; c.target = null;
    return c;
  };
  return { creatures, spawn };
}

describe('recorrido de vida', () => {
  it('nace fauna, crece, muere por edad y desaparece de índices y guardado', () => {
    const { creatures, spawn } = setup({ aging: true, reproduction: true });
    const a = spawn('herbivore'), b = spawn('herbivore');
    const baby = creatures._tryReproduce(a, b);
    expect(baby).toMatchObject({ age: 0, alive: true });
    expect(a.reproCooldown).toBeGreaterThan(0);
    baby.aiTimer = 999;
    creatures.update(1 / 30);
    expect(baby.age).toBeGreaterThan(0);
    baby.age = baby.maxAge;
    creatures.update(1 / 30);
    expect(baby.alive).toBe(false);
    expect(creatures.creatureById.has(baby.id)).toBe(false);
    expect(creatures.creatures.some(c => c.id === baby.id)).toBe(false);
    expect(creatures.serialize().creatures.some(c => c.id === baby.id)).toBe(false);
  });

  it('las leyes de envejecimiento y reproducción se respetan', () => {
    const { creatures, spawn } = setup();
    const a = spawn('herbivore'), b = spawn('herbivore');
    a.age = a.maxAge + 1;
    const age = a.age;
    expect(creatures._tryReproduce(a, b)).toBeNull();
    creatures.update(1 / 30);
    expect(a.age).toBe(age);
    expect(a.alive).toBe(true);
  });

  it('un ataque zombi elimina la víctima y crea un solo zombi sin referencias huérfanas', () => {
    const { creatures, spawn } = setup({ disease: true });
    const zombie = spawn('zombie'), victim = spawn('human');
    victim.x = zombie.x; victim.z = zombie.z; victim.speedMul = 1;
    zombie.combatTarget = victim.id;
    zombie.damageMul = 100;
    victim.health = 1;
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    creatures.update(1);
    expect(victim.alive).toBe(false);
    expect(creatures.creatureById.has(victim.id)).toBe(false);
    expect(creatures.count('zombie')).toBe(2);
    expect(zombie.combatTarget).toBeNull();
  });
});
