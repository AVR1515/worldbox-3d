import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameSession } from '../../js/game-session.js';
import { cityPlots } from '../../js/city-layout.js';

if (typeof document === 'undefined') {
  const ctx = new Proxy({}, { get: () => () => ctx });
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
}
let session;
afterEach(() => { session?.dispose(); vi.restoreAllMocks(); });
function setup() {
  session = new GameSession({ scene: new THREE.Scene(), size: 64, laws: { reproduction: true, aging: false, hunger: false, disease: false, diplomacy: false, rebellions: false } });
  const { world, creatures, settlements } = session;
  world.height.fill(8); world.moisture.fill(.5); world.temperature.fill(18); world.buildTerrainMesh();
  const members = Array.from({ length: 10 }, (_, i) => creatures.spawn('human', (i%3)*.1, 0, { sex: i%2 ? 'f' : 'm' }));
  for (const c of members) { c.age = 20; c.hunger = 0; c.reproCooldown = 0; }
  settlements.foundSettlement(0, 0, members, 'human');
  const city = settlements.settlements[0];
  return { ...session, city, members };
}

describe('villages grow past ten residents', () => {
  it('recovers a saved starter town with two homes, two farms and no stone', () => {
    const { settlements, creatures, city, members, civilization } = setup();
    settlements.addHouse(city);
    const vacant = cityPlots(city, 4).filter(p => !city.houses.some(h => h.x === p.x && h.z === p.z));
    for (const p of vacant) {
      const f = { ...p, slot: settlements.allocFarmSlot(), gridPlot: true };
      city.farms.push(f); settlements._syncFarmInstance(f, true);
    }
    expect(city.houses).toHaveLength(2); expect(city.farms).toHaveLength(2);
    city.resources.stone = 0; city.resources.wood = 20; city.resources.food = 100;
    city.growTimer = 0;
    settlements.growSettlements(1);
    expect(city.houses.length).toBeGreaterThan(2);
    expect(city.level).toBeGreaterThan(0);
    civilization._formFamilies();
    const a = members.find(c => civilization.ensurePerson(c).partnerId);
    const b = members.find(c => c.id === civilization.ensurePerson(a).partnerId);
    expect(creatures._tryReproduce(a, b)).toBeTruthy();
    expect(creatures.creatures.filter(c => c.alive && c.settlementId === city.id)).toHaveLength(11);
    expect(city.resources.stone).toBe(0);
  });

  it('keeps the four starter plots available for housing', () => {
    const { settlements, city } = setup();
    expect(settlements.addFarm(city)).toBe(false);
    for (let i = 0; i < 3; i++) expect(settlements.addHouse(city)).toBe(true);
    expect(city.houses).toHaveLength(4);
  });

  it('grows naturally from ten residents with the real family and economy systems', () => {
    let seed = 417;
    vi.spyOn(Math, 'random').mockImplementation(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; });
    const { creatures, settlements, civilization, city } = setup();
    city.resources.stone = 0;
    for (let step = 0; step < 1200; step++) {
      creatures.update(.25); settlements.update(.25); civilization.update(.25);
    }
    expect(city.pop).toBeGreaterThan(20);
    expect(city.houses.length).toBeGreaterThanOrEqual(3);
  }, 30000);

  it('updates the perimeter when houses are built or removed within the same level', () => {
    const { settlements, city } = setup();
    city.level = 3;
    for (let i = 1; i < 14; i++) settlements.addHouse(city);
    settlements._flushHousePaths();
    const positions = () => settlements.walls.get(city.id).children.map(p => [p.position.x, p.position.z]);
    const before = positions();
    for (let i = 0; i < 8; i++) settlements.addHouse(city);
    settlements._flushHousePaths();
    expect(positions()).not.toEqual(before);
    for (let i = 0; i < 8; i++) settlements.removeHouse(city.houses.pop());
    settlements._flushHousePaths();
    expect(positions()).toEqual(before);
  });
});
