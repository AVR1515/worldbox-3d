import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { POWERS, BOMB_TIERS, POWER_CATEGORIES } from '../../js/power-system.js';
import { CREATURE_DEFINITIONS, CREATURE_PACKS } from '../../js/creatures.js';
import { STATUS_DEFINITIONS, StatusSystem } from '../../js/status-system.js';
import { CataclysmSystem } from '../../js/cataclysm-system.js';

function creature() {
  return { id: 1, alive: true, x: 0, z: 0, health: 100, maxHealth: 100, hunger: 50, speedMul: 1, damageMul: 1, statuses: [] };
}

function fixture({ naturalDisasters = false } = {}) {
  const entity = creature();
  const creatures = {
    creatures: [entity],
    queryRadius: vi.fn((x, z, radius, predicate) => !predicate || predicate(entity) ? [entity] : []),
    killAllInRadius: vi.fn(),
  };
  const world = {
    size: 64, inBounds: () => true, isWater: () => false, worldToGrid: () => [32, 32],
    heightAtWorld: () => 1, terraform: vi.fn(), igniteInRadius: vi.fn(), applyHeat: vi.fn(), meteorImpact: vi.fn(),
  };
  const settlements = { settlements: [], removeHouse: vi.fn(), removeSettlement: vi.fn() };
  const scene = new THREE.Scene();
  const statuses = new StatusSystem(creatures);
  const cataclysms = new CataclysmSystem(scene, world, creatures, settlements, { laws: { naturalDisasters } });
  return { entity, creatures, world, statuses, cataclysms };
}

describe('fase 6: poderes y cataclismos', () => {
  it('define todos los estados reutilizables y poderes nuevos', () => {
    expect(Object.keys(STATUS_DEFINITIONS)).toEqual(expect.arrayContaining(['frozen', 'poisoned', 'shielded', 'madness', 'blessed', 'cursed']));
    expect(POWERS.map(power => power.id)).toEqual(expect.arrayContaining(['earthquake', 'landmine', 'tnt', 'antimatter', 'clone', 'spawn_dragon', 'spawn_alien']));
    expect(BOMB_TIERS.antimatter.damageRadius).toBeGreaterThan(BOMB_TIERS.nuke.damageRadius);
    expect(BOMB_TIERS.nuke.fallout).toBe(true);
  });

  it('mantiene completos y coherentes los catálogos basados en datos', () => {
    const powerIds = POWERS.map(power => power.id);
    const categoryIds = POWER_CATEGORIES.flatMap(category => category.tools);
    expect(new Set(powerIds).size).toBe(powerIds.length);
    expect(new Set(categoryIds)).toEqual(new Set(powerIds));
    for (const pack of Object.values(CREATURE_PACKS)) {
      for (const type of pack) expect(CREATURE_DEFINITIONS[type]).toBeTruthy();
    }
    expect([BOMB_TIERS.bomb, BOMB_TIERS.tnt, BOMB_TIERS.megabomb, BOMB_TIERS.nuke, BOMB_TIERS.antimatter].map(tier => tier.damageRadius))
      .toEqual([...new Set([BOMB_TIERS.bomb, BOMB_TIERS.tnt, BOMB_TIERS.megabomb, BOMB_TIERS.nuke, BOMB_TIERS.antimatter].map(tier => tier.damageRadius))].sort((a, b) => a - b));
  });

  it('aplica, actualiza y revierte estados sin corromper estadísticas', () => {
    const { entity, statuses } = fixture();
    statuses.apply(entity, 'blessed', { duration: 1 });
    statuses.apply(entity, 'shielded', { duration: 1 });
    statuses.apply(entity, 'poisoned', { duration: 1 });
    expect(entity.maxHealth).toBeGreaterThan(100);
    expect(statuses.describe(entity)).toHaveLength(3);
    statuses.update(1.1);
    expect(entity.statuses).toHaveLength(0);
    expect(entity.maxHealth).toBeCloseTo(100);
    expect(entity.speedMul).toBeCloseTo(1);
    expect(entity.damageMul).toBeCloseTo(1);
  });

  it('aplica y revierte maldición (daño/velocidad) y congelación (movementMultiplier), no solo los estados ya cubiertos', () => {
    // blessed/shielded/poisoned ya estaban cubiertos aquí; cursed/frozen/madness no tenían ningún
    // test directo pese a poder aplicarse en combate real vía poderes del jugador (Fase A).
    const { entity, statuses } = fixture();
    statuses.apply(entity, 'cursed', { duration: 5, intensity: 1 });
    expect(entity.damageMul).toBeCloseTo(0.8);
    expect(entity.speedMul).toBeCloseTo(0.82);
    const healthBefore = entity.health;
    statuses.update(1);
    expect(entity.health).toBeLessThan(healthBefore); // daño continuo mientras dura la maldición

    expect(statuses.movementMultiplier(entity)).toBe(1); // sin frozen todavía, sin penalización
    statuses.apply(entity, 'frozen', { duration: 5, intensity: 1 });
    expect(statuses.movementMultiplier(entity)).toBeCloseTo(0.5); // 0.62 - 1*0.12

    statuses.update(10); // agota la duración de ambos (5s) y debe revertir los multiplicadores
    expect(entity.statuses).toHaveLength(0);
    expect(entity.damageMul).toBeCloseTo(1);
    expect(entity.speedMul).toBeCloseTo(1);
    expect(statuses.movementMultiplier(entity)).toBe(1);
  });

  it('la locura redirige el objetivo de la criatura hacia una dirección aleatoria y limpia caza/combate', () => {
    const { entity, statuses } = fixture();
    entity.hunting = { id: 99 };
    entity.combatTarget = 99;
    statuses.apply(entity, 'madness', { duration: 5 });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0); // fuerza la rama del paso errático (< dt*0.35) y angle=0
    try {
      statuses.update(1);
    } finally {
      randomSpy.mockRestore();
    }
    expect(entity.target).toEqual({ x: entity.x + 5, z: entity.z }); // cos(0)=1, sin(0)=0, radio 5
    expect(entity.hunting).toBeNull();
    expect(entity.combatTarget).toBeNull();
  });

  it('detonate() cráterea, incendia y mata en el radio de daño, y emite el evento', () => {
    const { world, creatures, cataclysms } = fixture();
    const events = { emit: vi.fn() };
    cataclysms.events = events;
    const tier = { radius: 1.8, damageRadius: 2.7, craterDepth: -4 };
    cataclysms.detonate(5, 5, tier);
    expect(world.terraform).toHaveBeenCalledWith(32, 32, 1.8, -4);
    expect(world.igniteInRadius).toHaveBeenCalledWith(32, 32, expect.closeTo(2.34, 5));
    expect(creatures.killAllInRadius).toHaveBeenCalledWith(5, 5, 2.7);
    expect(events.emit).toHaveBeenCalledWith('cataclysm:detonation', expect.objectContaining({ x: 5, z: 5, radius: 1.8 }));
  });

  it('earthquake() daña criaturas cercanas proporcionalmente a la distancia y deforma el terreno en varios puntos', () => {
    const { entity, world, creatures, cataclysms } = fixture();
    entity.x = 1; entity.z = 0; // cerca del epicentro (0,0), dentro del radio
    const healthBefore = entity.health;
    cataclysms.earthquake(0, 0, 8, 1);
    expect(entity.health).toBeLessThan(healthBefore);
    expect(world.terraform).toHaveBeenCalledTimes(10); // 10 puntos deformados por llamada, según el código
  });

  it('arma minas persistentes y detona cuando entra una criatura', () => {
    const { cataclysms, world, creatures } = fixture();
    const mine = cataclysms.placeMine(0, 0, 1.5);
    expect(mine).toBeTruthy();
    cataclysms.update(2.1);
    expect(world.terraform).toHaveBeenCalled();
    expect(creatures.killAllInRadius).toHaveBeenCalled();
    expect(cataclysms.mines).toHaveLength(0);
    cataclysms.dispose();
  });
});

describe('fase 7: estabilidad prolongada', () => {
  it('mantiene estados finitos durante ocho horas simuladas en pasos acelerados', () => {
    const { entity, statuses, cataclysms } = fixture();
    statuses.apply(entity, 'shielded', { duration: 120 });
    for (let elapsed = 0; elapsed < 8 * 60 * 60; elapsed += 10) {
      statuses.update(10);
      cataclysms.update(10);
      expect(Number.isFinite(entity.health)).toBe(true);
      expect(Number.isFinite(cataclysms.disasterTimer)).toBe(true);
    }
    expect(entity.statuses).toHaveLength(0);
    expect(cataclysms.mines).toHaveLength(0);
    cataclysms.dispose();
  });
});
