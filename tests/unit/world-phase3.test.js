import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BIOME_IDS, CONFIG, World } from '../../js/world.js';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';

const disposable = [];

afterEach(() => {
  while (disposable.length) disposable.pop()?.dispose?.();
});

function generatedWorld(climate = 'templado') {
  const world = new World(new THREE.Scene(), { size: 32, laws: { weather: true } });
  world.generate({ mapType: 'island', mountainLevel: 1, humidity: 'normal', climate, waterLevel: 'normal', seed: 9182 });
  disposable.push(world);
  return world;
}

function findCell(world, predicate) {
  for (let z = 0; z <= world.size; z++) {
    for (let x = 0; x <= world.size; x++) if (predicate(x, z, world.idx(x, z))) return { x, z, i: world.idx(x, z) };
  }
  throw new Error('No se encontró una celda adecuada');
}

describe('mundo sistémico de la fase 3', () => {
  it('asigna una identidad de bioma explícita y válida a cada celda', () => {
    const world = generatedWorld();
    const identities = new Set(Array.from(world.biome, index => BIOME_IDS[index]));
    expect([...identities].every(id => BIOME_IDS.includes(id))).toBe(true);
    expect(identities.size).toBeGreaterThanOrEqual(4);
  });

  it('congela agua, crea lava en tierra y actualiza el peligro navegable', () => {
    const world = generatedWorld();
    const water = findCell(world, (x, z) => world.isWater(x, z));
    world.applyCold(water.x, water.z, 0, 80);
    expect(world.ice[water.i]).toBe(1);

    const land = findCell(world, (x, z, i) => !world.isWater(x, z) && world.height[i] > CONFIG.WATER_LEVEL + 1);
    world.applyHeat(land.x, land.z, 0, 90, true);
    expect(world.lava[land.i]).toBe(1);
    expect(world.danger[land.i]).toBe(100);
    expect(world.biomeIdAt(land.x, land.z)).toBe('volcanic');
  });

  it('agota depósitos físicos en vez de producir recursos infinitos', () => {
    const world = generatedWorld();
    const land = findCell(world, (x, z) => !world.isWater(x, z));
    world.mineralType.fill(0);
    world.mineralAmount.fill(0);
    world.mineralType[land.i] = 2;
    world.mineralAmount[land.i] = 3;
    const [wx, wz] = world.gridToWorld(land.x, land.z);

    expect(world.mineNearest(wx, wz, 2, 2)).toMatchObject({ type: 'gold', amount: 2 });
    expect(world.mineNearest(wx, wz, 2, 2)).toMatchObject({ type: 'gold', amount: 1 });
    expect(world.mineNearest(wx, wz, 1, 2)).toBeNull();
  });

  it('generateMinerals() nunca coloca depósitos en agua y respeta la proporción declarada de tipos', () => {
    // Sin test directo hasta ahora (Fase A): solo se probaba el agotamiento de un depósito ya
    // colocado a mano, nunca la distribución/rareza que produce generateMinerals() en sí.
    const world = new World(new THREE.Scene(), { size: 120 });
    world.generate({ mapType: 'island', mountainLevel: 2, humidity: 'normal', climate: 'templado', waterLevel: 'normal', seed: 777 });
    disposable.push(world);

    let stone = 0, gold = 0, gems = 0, total = 0;
    for (let z = 0; z <= world.size; z++) {
      for (let x = 0; x <= world.size; x++) {
        const i = world.idx(x, z);
        const type = world.mineralType[i];
        if (!type) { expect(world.mineralAmount[i]).toBe(0); continue; }
        expect(world.isWater(x, z)).toBe(false); // nunca en agua
        expect(world.mineralAmount[i]).toBeGreaterThanOrEqual(18);
        expect(world.mineralAmount[i]).toBeLessThanOrEqual(18 + 62 * 1.65 + 0.01);
        total++;
        if (type === 1) stone++; else if (type === 2) gold++; else if (type === 3) gems++;
      }
    }

    expect(total).toBeGreaterThan(50); // muestra suficiente para que la proporción sea significativa
    expect(stone + gold + gems).toBe(total); // ningún tipo fuera de 1-3
    // Declarado en el código: 70% piedra, 24% oro, 6% gemas — se comprueba el orden relativo,
    // no porcentajes exactos, para no acoplar el test a la semilla concreta.
    expect(stone).toBeGreaterThan(gold);
    expect(gold).toBeGreaterThan(gems);
  });

  it('genera la misma distribución de minerales para la misma semilla', () => {
    const seedOptions = { mapType: 'island', mountainLevel: 2, humidity: 'normal', climate: 'templado', waterLevel: 'normal', seed: 555 };
    const first = new World(new THREE.Scene(), { size: 48 });
    first.generate(seedOptions);
    const second = new World(new THREE.Scene(), { size: 48 });
    second.generate(seedOptions);
    disposable.push(first, second);
    expect([...second.mineralType]).toEqual([...first.mineralType]);
    expect([...second.mineralAmount]).toEqual([...first.mineralAmount]);
  });

  it('aplica ahogamiento y asfixia fuera del hábitat correcto', () => {
    const world = generatedWorld();
    const scene = world.scene;
    const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, disease: false } });
    disposable.push(creatures);
    const land = findCell(world, (x, z) => !world.isWater(x, z));
    const water = findCell(world, (x, z) => world.isWater(x, z));
    const [landX, landZ] = world.gridToWorld(land.x, land.z);
    const [waterX, waterZ] = world.gridToWorld(water.x, water.z);
    const human = creatures.spawn('human', landX, landZ);
    const fish = creatures.spawn('fish', waterX, waterZ);
    human.x = waterX; human.z = waterZ; human.oxygen = 0;
    fish.x = landX; fish.z = landZ;
    human.possessed = true;
    fish.possessed = true;
    const humanHealth = human.health, fishHealth = fish.health;

    creatures.update(0.5);

    expect(human.health).toBeLessThan(humanHealth);
    expect(fish.health).toBeLessThan(fishHealth);
  });

  it('conserva clima, hielo, lava y minerales al restaurar', () => {
    const source = generatedWorld('artico');
    const land = findCell(source, (x, z) => !source.isWater(x, z));
    source.applyHeat(land.x, land.z, 0, 90, true);
    source.mineralType[land.i] = 3;
    source.mineralAmount[land.i] = 17;
    source.startRain(11);
    const snapshot = source.serialize();
    const restored = new World(new THREE.Scene(), { size: 32 });
    disposable.push(restored);
    restored.restore(snapshot);

    expect(restored.temperature[land.i]).toBeCloseTo(source.temperature[land.i], 4);
    expect(restored.lava[land.i]).toBe(1);
    expect(restored.mineralType[land.i]).toBe(3);
    expect(restored.mineralAmount[land.i]).toBeCloseTo(17, 4);
    expect(restored.rainRemaining).toBe(11);
  });

  it('registra casas como obstáculos reales para las rutas terrestres', () => {
    const world = generatedWorld();
    const creatures = { creatures: [], clearHome() {} };
    const settlements = new SettlementManager(world.scene, world, creatures);
    disposable.push(settlements);
    settlements.settlements.push({ houses: [{ x: 0, z: 0, slot: 0 }] });
    const [vx, vz] = world.worldToGrid(0, 0);
    expect(settlements.isNavigationBlockedGrid(vx, vz)).toBe(true);
    settlements.settlements.length = 0;
  });
});
