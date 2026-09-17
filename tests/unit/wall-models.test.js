import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// Regression/feature test: addWall()/addTower() used to be plain procedural boxes/cylinders —
// they now build from real models (low_poly_mega_assets_pack/), with a placeholder box/cylinder
// as the fallback while the .glb loads (this suite's plain-Node environment has no `document`, so
// it always exercises that placeholder path — see house-variants.test.js for the same pattern).
// The two ring slots that used to be left as bare gaps now get an actual gate piece instead, which
// must NOT become a navigation obstacle the way a solid wall segment does — a gate is, by
// definition, the part of the wall you can walk through.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 41 });
  // Esta prueba verifica piezas y puertas; la colocación aleatoria en una costa podía impedir
  // crear la torre. Los casos de terreno se cubren en settlement-ground y wall-resize.
  world.height.fill(8);
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  disposable.push(world, creatures, settlements);
  let cx = null, cz = null;
  outer: for (let z = 10; z < world.size - 10; z++) {
    for (let x = 10; x < world.size - 10; x++) {
      if (!world.isWater(x, z) && world.isFlatEnough(x, z, 1.6)) { const [wx, wz] = world.gridToWorld(x, z); cx = wx; cz = wz; break outer; }
    }
  }
  return { settlements, cx, cz };
}

function makeSettlement(settlements, empireId, id, x, z, level) {
  const s = {
    id, x, z, level, houses: [], farms: [], empireId, race: 'human',
    name: `Ciudad ${id}`, pop: 20, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

describe('murallas y torres con modelos reales', () => {
  it('orienta cada tramo tangente al perímetro y su cara hacia fuera', () => {
    const { settlements, cx, cz } = setup();
    const s = makeSettlement(settlements, settlements.createEmpire().id, 1, cx, cz, 3);
    settlements.addWall(s);
    for (const segment of settlements.walls.get(s.id).children) {
      const radial = new THREE.Vector3(segment.position.x - s.x, 0, segment.position.z - s.z).normalize();
      const along = new THREE.Vector3(1, 0, 0).applyQuaternion(segment.quaternion);
      const outward = new THREE.Vector3(0, 0, 1).applyQuaternion(segment.quaternion);
      expect(Math.min(Math.abs(along.x), Math.abs(along.z))).toBeLessThan(1e-6);
      expect(outward.dot(radial)).toBeGreaterThan(0);
    }
  });
  it('hasta dos huecos del anillo son puertas (menos si el terreno se come alguno, igual que un tramo normal)', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 3);
    settlements.addWall(s);
    const wall = settlements.walls.get(s.id);
    expect(wall.children.length).toBeGreaterThan(10);
    const gates = wall.children.filter(seg => seg.userData.isGate);
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.length).toBeLessThanOrEqual(4);
  });

  it('una puerta no bloquea la navegación, a diferencia de un tramo sólido', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 3);
    settlements.addWall(s);
    settlements._ensureNavigationObstacles();
    const wall = settlements.walls.get(s.id);
    const gates = wall.children.filter(seg => seg.userData.isGate);
    const solidSegments = wall.children.filter(seg => !seg.userData.isGate);
    const wallObstacles = settlements._navigationObstacles.filter(o => o.kind === 'wall');
    expect(wallObstacles).toHaveLength(solidSegments.length);
    for (const gate of gates) {
      expect(wallObstacles.some(o => o.x === gate.position.x && o.z === gate.position.z)).toBe(false);
    }
  });

  it('la torre es un único modelo más un centinela, no el eje+cono procedural anterior', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 2);
    settlements.addTower(s);
    const tower = settlements.towers.get(s.id);
    expect(tower.children).toHaveLength(2); // [modelo de torre, centinela]
  });
});
