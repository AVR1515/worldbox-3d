import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShipManager } from '../../js/ships.js';

function fixture({ sailing = false } = {}) {
  const root = new THREE.Group();
  const creature = { id: 7, alive: true, sailing, target: { x: 2, z: 2 }, model3d: { root } };
  const creatures = { creatures: [creature], creatureById: new Map([[creature.id, creature]]) };
  const world = { size: 100, heightAtWorld: () => 3 };
  const settlements = { settlements: [] };
  const manager = new ShipManager(new THREE.Scene(), world, creatures, settlements);
  return { manager, creature };
}

describe('persistencia de expediciones', () => {
  it('un cargamento importado inválido no resta existencias al desembarcar', () => {
    const { manager } = fixture();
    const origin = { id: 1, resources: { food: 5, fish: 4, gold: 3 } };
    manager.settlements.settlements.push(origin);
    manager.restore({ timer: 999, serviceTimer: 999, ships: [{ role: 'fishing', originSettlementId: 1, from: { x: 0, z: 0 }, to: { x: 1, z: 0 }, duration: 1, cargo: { fish: -100 }, crewIds: [] }] });
    manager.update(1);
    expect(origin.resources).toEqual({ food: 5, fish: 4, gold: 3 });
    expect(manager.ships).toHaveLength(0);
    manager.dispose();
  });
  it('detiene una ruta cortada y continúa cuando el canal vuelve a abrirse', () => {
    const { manager } = fixture();
    manager.world.worldToGrid = (x, z) => [Math.round(x), Math.round(z)];
    let blocked = true;
    manager.world.isWater = x => !blocked || x !== 2;
    manager.navigation.findPathWorld = () => [];
    manager.restore({ timer: 999, serviceTimer: 999, ships: [{ role: 'trade', from: { x: 0, z: 0 }, to: { x: 4, z: 0 }, duration: 4, t: 1, crewIds: [], cargo: { goods: 4 } }] });
    manager.update(1);
    expect(manager.ships[0].t).toBe(1);
    expect(manager.ships[0].mesh.position.x).toBe(1);
    blocked = false;
    manager.update(1);
    expect(manager.ships[0].t).toBe(2);
    manager.dispose();
  });
  it('restaura el barco, oculta su tripulación y conserva el progreso', () => {
    const { manager, creature } = fixture();

    const count = manager.restore({
      timer: 9,
      ships: [{
        from: { x: -12, z: 4 },
        to: { x: 20, z: -8 },
        t: 3,
        duration: 12,
        crewIds: [7],
      }],
    });

    expect(count).toBe(1);
    expect(creature.sailing).toBe(true);
    expect(creature.model3d.root.visible).toBe(false);
    expect(manager.serialize()).toMatchObject({
      timer: 9,
      ships: [{ t: 3, duration: 12, crewIds: [7] }],
    });
    manager.dispose();
    expect(creature.sailing).toBe(false);
    expect(creature.model3d.root.visible).toBe(true);
  });

  it('libera pasajeros huérfanos cuando ya no existe su barco', () => {
    const { manager, creature } = fixture({ sailing: true });
    creature.model3d.root.visible = false;

    manager.restore({ timer: 4, ships: [] });

    expect(creature.sailing).toBe(false);
    expect(creature.model3d.root.visible).toBe(true);
    manager.dispose();
  });

  it('rechaza rutas rectas que atraviesan tierra', () => {
    const { manager } = fixture();
    manager.world.worldToGrid = (x, z) => [Math.round(x), Math.round(z)];
    manager.world.isWater = x => x !== 2;

    expect(manager._waterLineIsClear({ x: 0, z: 0 }, { x: 4, z: 0 })).toBe(false);
    manager.world.isWater = () => true;
    expect(manager._waterLineIsClear({ x: 0, z: 0 }, { x: 4, z: 0 })).toBe(true);
    manager.dispose();
  });

  it('restaura barcos pesqueros y comerciales aunque no lleven pasajeros', () => {
    const { manager } = fixture();
    const count = manager.restore({
      serviceTimer: 5,
      ships: [{ role: 'fishing', from: { x: 0, z: 0 }, to: { x: 2, z: 1 }, route: [{ x: 0, z: 0 }, { x: 2, z: 1 }], t: 1, duration: 4, cargo: { fish: 9 }, crewIds: [] }],
    });
    expect(count).toBe(1);
    expect(manager.serialize().ships[0]).toMatchObject({ role: 'fishing', cargo: { fish: 9 }, crewIds: [] });
    manager.dispose();
  });
});
