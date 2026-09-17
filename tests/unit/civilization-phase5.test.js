import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { CreatureManager } from '../../js/creatures.js';
import { EventBus } from '../../js/core/event-bus.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const events = new EventBus();
  const world = new World(scene, { size: 32, events });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 1, seed: 8155 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: true, disease: false }, events });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: true }, events, toast: vi.fn() });
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { events, toast: vi.fn() });
  creatures.setSettlementManager(settlements).setCivilizationSystem(civilization);
  settlements.setCivilizationSystem(civilization);
  disposable.push(world, creatures, settlements, civilization);

  let land = null;
  for (let z = 2; z < world.size - 2 && !land; z++) for (let x = 2; x < world.size - 2; x++) {
    if (!world.isWater(x, z)) { const [wx, wz] = world.gridToWorld(x, z); land = { x, z, wx, wz }; break; }
  }
  const empire = settlements.createEmpire();
  const settlement = {
    id: 1, x: land.wx, z: land.wz, level: 2, houses: [], farms: [{ x: land.wx, z: land.wz }], empireId: empire.id, race: 'human',
    name: 'Val Alba', pop: 3, loyalty: 80, dockPoint: { x: land.wx, z: land.wz },
    resources: { wood: 100, food: 100, stone: 100, gold: 0, gems: 0, ore: 20, fish: 0, tools: 0, weapons: 0, armor: 0, goods: 0 },
  };
  settlements.settlements.push(settlement);
  empire.capitalId = settlement.id;
  return { scene, world, creatures, settlements, civilization, settlement, empire, land };
}

describe('sociedades vivas de la fase 5', () => {
  it('hereda un genoma mezclado con mutaciones pequeñas y lo aplica a las estadísticas', () => {
    const { creatures, civilization, settlement, empire, land } = setup();
    const mother = creatures.spawn('human', land.wx, land.wz, { sex: 'f' });
    const father = creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'm' });
    const child = creatures.spawn('human', land.wx + 0.1, land.wz + 0.1, { sex: 'f' });
    for (const creature of [mother, father, child]) creatures.setHome(creature, settlement.id, empire.id, settlement.x, settlement.z, 8);
    const a = civilization.ensurePerson(mother), b = civilization.ensurePerson(father);
    a.genome = Object.fromEntries(Object.keys(a.genome).map(key => [key, 0.4]));
    b.genome = Object.fromEntries(Object.keys(b.genome).map(key => [key, 0.6]));

    civilization.registerBirth(child, mother, father);
    const inherited = civilization.people.get(child.id).genome;
    expect(inherited.strength).toBeGreaterThanOrEqual(0.465);
    expect(inherited.strength).toBeLessThanOrEqual(0.535);
    const healthBefore = child.maxHealth;
    civilization.update(1.6);
    expect(civilization.people.get(child.id).genomeApplied).toBe(true);
    expect(child.maxHealth).not.toBe(healthBefore);
  });

  it('crea cultura, idioma, religión, tradiciones, felicidad y una subespecie adaptada', () => {
    const { world, creatures, civilization, settlement, empire, land } = setup();
    const resident = creatures.spawn('human', land.wx, land.wz, { sex: 'f' });
    resident.age = 20; resident.hunger = 0;
    creatures.setHome(resident, settlement.id, empire.id, settlement.x, settlement.z, 8);
    const person = civilization.ensurePerson(resident);
    person.genome.coldAdaptation = 0.699;
    world.temperature[world.idx(land.x, land.z)] = -25;

    civilization.update(3);
    const description = civilization.describeCreature(resident);
    const city = civilization.describeSettlement(settlement);
    expect(description.cultureName).toBeTruthy();
    expect(description.languageName).toBeTruthy();
    expect(description.religionName).toBeTruthy();
    expect(description.subspeciesName).toContain('boreal');
    expect(description.happiness).toBeGreaterThanOrEqual(0);
    expect(city.traditions).toEqual(expect.arrayContaining(['agricultura', 'navegación', 'artesanía']));
  });

  it('difunde idiomas y religiones mediante el comercio y conserva recuerdos', () => {
    const { creatures, settlements, civilization, settlement, empire, land } = setup();
    const traveler = creatures.spawn('human', land.wx, land.wz, { sex: 'm' });
    creatures.setHome(traveler, settlement.id, empire.id, settlement.x, settlement.z, 8);
    const otherEmpire = settlements.createEmpire();
    const destination = { ...settlement, id: 2, name: 'Puerto Niebla', empireId: otherEmpire.id, resources: { ...settlement.resources } };
    settlements.settlements.push(destination); otherEmpire.capitalId = destination.id;
    const host = creatures.spawn('human', land.wx + 0.3, land.wz, { sex: 'f' });
    creatures.setHome(host, destination.id, otherEmpire.id, destination.x, destination.z, 8);
    civilization.update(1.6);
    const originCommunity = civilization.communities.get(settlement.id);
    const destinationCommunity = civilization.communities.get(destination.id);

    civilization._exchangeIdeas(settlement, destination, 'trade');
    civilization.remember(traveler, 'journey', 'Cruzó el gran mar', 9);

    expect(civilization.people.get(host.id).languageId).toBe(originCommunity.languageId);
    expect(civilization.people.get(traveler.id).religionId).toBe(destinationCommunity.religionId);
    expect(civilization.describeCreature(traveler).memories).toContain('Cruzó el gran mar');
  });

  it('restaura genes, felicidad, recuerdos y sistemas sociales desde el guardado', () => {
    const { scene, world, creatures, settlements, civilization, settlement, empire, land } = setup();
    const resident = creatures.spawn('human', land.wx, land.wz, { sex: 'm' });
    creatures.setHome(resident, settlement.id, empire.id, settlement.x, settlement.z, 8);
    civilization.update(1.6);
    civilization.remember(resident, 'founding', 'Fundó una nueva tradición', 12);
    const saved = civilization.serialize();
    const restored = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
    disposable.push(restored);
    restored.restore(saved);

    const person = restored.people.get(resident.id);
    expect(saved.version).toBe(2);
    expect(person.genome).toMatchObject(civilization.people.get(resident.id).genome);
    expect(person.memories[0].text).toBe('Fundó una nueva tradición');
    expect(restored.cultures.size).toBeGreaterThan(0);
    expect(restored.languages.size).toBeGreaterThan(0);
    expect(restored.religions.size).toBeGreaterThan(0);
  });

  it('convierte guerras y tratados en recuerdos colectivos', () => {
    const { creatures, settlements, civilization, settlement, empire, land } = setup();
    const witness = creatures.spawn('human', land.wx, land.wz, { sex: 'f' });
    creatures.setHome(witness, settlement.id, empire.id, settlement.x, settlement.z, 8);
    const enemy = settlements.createEmpire();
    settlements.settlements.push({ ...settlement, id: 2, name: 'Villa Rival', empireId: enemy.id, resources: { ...settlement.resources } });
    enemy.capitalId = 2;

    expect(settlements.declareWar(empire, enemy)).toBe(true);
    expect(civilization.describeCreature(witness).memories.some(memory => memory.includes('guerra'))).toBe(true);
    expect(settlements.makePeace(empire, enemy)).toBe(true);
    expect(civilization.describeCreature(witness).memories.some(memory => memory.includes('paz'))).toBe(true);
  });
});
