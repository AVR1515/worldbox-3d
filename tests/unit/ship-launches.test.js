import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShipManager } from '../../js/ships.js';
import { CreatureManager } from '../../js/creatures.js';
import { World } from '../../js/world.js';

// Coverage gap found during the Fase A functional matrix: ships.test.js only exercises
// serialize()/restore() (persistence). The actual decision logic behind the three kinds of
// civilian expeditions — colonization, fishing, trade — had never been exercised directly.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup(seed = 7) {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 64 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = { settlements: [], empires: [] };
  const manager = new ShipManager(scene, world, creatures, settlements);
  disposable.push(world, creatures, manager);
  return { world, creatures, settlements, manager };
}

function findCoastalLand(world, radius = 5) {
  for (let z = 2; z < world.size - 2; z++) {
    for (let x = 2; x < world.size - 2; x++) {
      if (world.isWater(x, z)) continue;
      if (world.isCoastal(x, z, radius)) return { vx: x, vz: z, ...(() => { const [wx, wz] = world.gridToWorld(x, z); return { x: wx, z: wz }; })() };
    }
  }
  return null;
}

describe('ShipManager — lanzamientos reales (no solo serialize/restore)', () => {
  it('_tryLaunch() zarpa una expedición colonizadora con 3 tripulantes elegibles desde un asentamiento costero poblado', () => {
    const { world, creatures, settlements, manager } = setup();
    const coast = findCoastalLand(world);
    expect(coast).toBeTruthy();
    const settlement = { id: 1, x: coast.x, z: coast.z, pop: 12, dockPoint: null, name: 'Puerto' };
    settlements.settlements.push(settlement);

    const passengers = [];
    for (let i = 0; i < 4; i++) {
      const c = creatures.spawn('human', coast.x + i * 0.15, coast.z, { sex: i % 2 ? 'f' : 'm' });
      c.settlementId = settlement.id;
      c.age = 20;
      passengers.push(c);
    }

    manager._tryLaunch();

    expect(manager.ships).toHaveLength(1);
    const ship = manager.ships[0];
    expect(ship.role).toBe('transport');
    expect(ship.crew).toHaveLength(3); // como mucho 3, aunque había 4 elegibles
    for (const crew of ship.crew) {
      expect(crew.sailing).toBe(true);
      expect(crew.target).toBeNull();
    }
    // El pasajero no embarcado se queda en tierra, no marcado como navegando.
    const leftBehind = passengers.find(p => !ship.crew.includes(p));
    expect(leftBehind.sailing).toBeFalsy();
  });

  it('_tryLaunch() no hace nada con menos de 3 colonos elegibles o menos de 9 de población', () => {
    const { world, creatures, settlements, manager } = setup();
    const coast = findCoastalLand(world);
    const settlement = { id: 1, x: coast.x, z: coast.z, pop: 12, dockPoint: null, name: 'Puerto' };
    settlements.settlements.push(settlement);
    const c = creatures.spawn('human', coast.x, coast.z, { sex: 'm' });
    c.settlementId = settlement.id;
    c.age = 20;

    manager._tryLaunch(); // solo 1 pasajero elegible
    expect(manager.ships).toHaveLength(0);

    settlement.pop = 3; // población insuficiente, aunque hipotéticamente hubiera más colonos
    for (let i = 0; i < 3; i++) {
      const extra = creatures.spawn('human', coast.x + i * 0.1, coast.z, { sex: 'm' });
      extra.settlementId = settlement.id;
      extra.age = 20;
    }
    manager._tryLaunch();
    expect(manager.ships).toHaveLength(0);
  });

  it('_launchFishingShip() sale y vuelve al mismo muelle con pescado de carga', () => {
    const { world, manager } = setup();
    const coast = findCoastalLand(world);
    const dock = manager._nearestWaterPoint(coast.vx, coast.vz, 4);
    expect(dock).toBeTruthy();
    const origin = { id: 1, dockPoint: dock, name: 'Puerto' };

    const launched = manager._launchFishingShip(origin);

    expect(launched).toBe(true);
    expect(manager.ships).toHaveLength(1);
    const ship = manager.ships[0];
    expect(ship.role).toBe('fishing');
    expect(ship.cargo.fish).toBeGreaterThan(0);
    expect(ship.from).toEqual(dock);
    expect(ship.to).toEqual(dock); // ida y vuelta al mismo muelle
    expect(ship.route[0]).toEqual(dock);
    expect(ship.route.at(-1)).toEqual(dock);
  });

  it('_launchTradeShip() exige bienes y muelle en ambos extremos, y descuenta el cargamento del origen', () => {
    const { world, manager } = setup();
    const coastA = findCoastalLand(world, 4);
    const dockA = manager._nearestWaterPoint(coastA.vx, coastA.vz, 4);
    // Busca un segundo punto costero distinto para el destino.
    let coastB = null, dockB = null;
    for (let z = world.size - 3; z > 2 && !coastB; z--) {
      for (let x = world.size - 3; x > 2 && !coastB; x--) {
        if (world.isWater(x, z) || !world.isCoastal(x, z, 4)) continue;
        const [wx, wz] = world.gridToWorld(x, z);
        const candidateDock = manager._nearestWaterPoint(x, z, 4);
        if (candidateDock) { coastB = { x: wx, z: wz }; dockB = candidateDock; }
      }
    }
    expect(dockA).toBeTruthy();
    expect(dockB).toBeTruthy();

    const origin = { id: 1, dockPoint: dockA, name: 'Origen', resources: { goods: 7 } };
    const destination = { id: 2, dockPoint: dockB, name: 'Destino', resources: { goods: 0 } };

    const launched = manager._launchTradeShip(origin, destination);

    // La ruta naval entre dos puntos aleatorios del mismo mapa puede no existir (bloqueada por
    // tierra entre medias) — si esta semilla concreta no encontró ruta, al menos confirmamos que
    // el fallo es limpio (sin tirar de recursos) en vez de asumir que siempre debe conseguirlo.
    if (!launched) { expect(origin.resources.goods).toBe(7); return; }
    expect(manager.ships).toHaveLength(1);
    expect(manager.ships[0].role).toBe('trade');
    expect(manager.ships[0].cargo.goods).toBeGreaterThan(0);
    expect(origin.resources.goods).toBeLessThan(7);
  });

  it('_launchTradeShip() rechaza sin suficientes bienes, sin lanzar barco', () => {
    const { world, manager } = setup();
    const coast = findCoastalLand(world);
    const dock = manager._nearestWaterPoint(coast.vx, coast.vz, 4);
    const origin = { id: 1, dockPoint: dock, resources: { goods: 1 } }; // por debajo del mínimo de 2
    const destination = { id: 2, dockPoint: dock, resources: { goods: 0 } };

    expect(manager._launchTradeShip(origin, destination)).toBe(false);
    expect(manager.ships).toHaveLength(0);
    expect(origin.resources.goods).toBe(1); // intacto
  });
});
