import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 32 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 1, seed: 4421 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: true, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: true }, toast: vi.fn() });
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
  creatures.setSettlementManager(settlements).setCivilizationSystem(civilization);
  settlements.setCivilizationSystem(civilization);
  disposable.push(world, creatures, settlements, civilization);
  let land = null;
  for (let z = 2; z < world.size - 2 && !land; z++) for (let x = 2; x < world.size - 2; x++) {
    if (!world.isWater(x, z)) { const [wx, wz] = world.gridToWorld(x, z); land = { x, z, i: world.idx(x, z), wx, wz }; break; }
  }
  const empire = settlements.createEmpire();
  const settlement = {
    id: 1, x: land.wx, z: land.wz, level: 2, houses: [], farms: [], empireId: empire.id, race: 'human',
    name: 'Villa Prueba', pop: 3, loyalty: 80,
    resources: { wood: 200, food: 100, stone: 200, gold: 20, gems: 10, ore: 0, fish: 0, tools: 3, weapons: 3, armor: 3, goods: 0 },
  };
  settlements.settlements.push(settlement);
  empire.capitalId = settlement.id;
  return { world, creatures, settlements, civilization, settlement, empire, land };
}

describe('civilizaciones profundas de la fase 4', () => {
  it('transforma mineral finito en equipo, descuenta una vez y conserva equipo al cargar', () => {
    const { world, creatures, civilization, settlement, empire, land } = setup();
    world.mineralType.fill(0); world.mineralAmount.fill(0);
    world.mineralType[land.i] = 1; world.mineralAmount[land.i] = 20;
    for (const key of Object.keys(settlement.resources)) settlement.resources[key] = 0;
    settlement.resources.wood = 10;
    const worker = creatures.spawn('human', land.wx, land.wz, { profession: 'Minero' });
    const soldier = creatures.spawn('human', land.wx + .2, land.wz, { profession: 'Soldado' });
    soldier.role = 'soldado';
    for (const c of [worker, soldier]) creatures.setHome(c, settlement.id, empire.id, settlement.x, settlement.z, 8);
    for (const c of [worker, soldier]) civilization.ensurePerson(c);
    civilization._updateAdaptationAndWellbeing(0);
    // Neutral productivity (1.0): keep this conservation scenario independent of morale.
    for (const c of [worker, soldier]) civilization.people.get(c.id).happiness = 70;
    const site = { settlementId: settlement.id, siegeHealth: 100, buildings: ['mine', 'workshop', 'smithy'].map(type => ({ type, level: 1, health: 120 })) };
    civilization.productionSites.set(settlement.id, site);
    civilization._runProduction(settlement, site, 10);
    civilization._runProduction(settlement, site, 10);
    expect(world.mineralAmount[land.i]).toBeCloseTo(5);
    expect(settlement.resources.ore).toBeCloseTo(.8);
    expect(settlement.resources.wood).toBeCloseTo(4);
    const before = { ...settlement.resources };
    civilization._syncEquipment();
    expect(settlement.resources.tools).toBeCloseTo(before.tools - 1);
    expect(settlement.resources.weapons).toBeCloseTo(before.weapons - 1);
    expect(settlement.resources.armor).toBeCloseTo(before.armor - 1);
    const equippedResources = { ...settlement.resources };
    const inventory = civilization.people.get(soldier.id).inventory.map(item => ({ ...item }));
    const damage = soldier.damageMul, health = soldier.maxHealth;
    civilization.restore(JSON.parse(JSON.stringify(civilization.serialize())));
    civilization._syncEquipment();
    expect(settlement.resources).toEqual(equippedResources);
    expect(civilization.people.get(soldier.id).inventory).toEqual(inventory);
    expect(soldier.damageMul).toBe(damage);
    expect(soldier.maxHealth).toBe(health);
    for (let i = 0; i < 20; i++) civilization._runProduction(settlement, site, 10);
    expect(world.mineralAmount[land.i]).toBe(0);
    for (const value of Object.values(settlement.resources)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it('registra pareja, padres, hijos, generación y herencia', () => {
    const { creatures, civilization, settlement, empire, land } = setup();
    const mother = creatures.spawn('human', land.wx, land.wz, { sex: 'f', traits: ['fertile'] });
    const father = creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'm', traits: ['strong'] });
    const child = creatures.spawn('human', land.wx + 0.1, land.wz + 0.1, { sex: 'f', traits: ['strong'] });
    for (const person of [mother, father, child]) creatures.setHome(person, settlement.id, empire.id, settlement.x, settlement.z, 8);
    civilization.ensurePerson(mother);
    civilization.ensurePerson(father);
    civilization._createClan(mother, empire.id);
    civilization.registerBirth(child, mother, father);

    const family = civilization.people.get(child.id);
    expect(family.parentIds).toEqual([mother.id, father.id]);
    expect(family.generation).toBe(1);
    expect(civilization.people.get(mother.id).childrenIds).toContain(child.id);
    expect(civilization.canReproduce(mother, father)).toBe(true);
    expect(family.clanId).toBe(civilization.people.get(mother.id).clanId);
  });

  it('otorga experiencia, niveles y atributos después de una baja', () => {
    const { creatures, civilization, land } = setup();
    const attacker = creatures.spawn('human', land.wx, land.wz, { sex: 'm' });
    const victim = creatures.spawn('orc', land.wx + 0.2, land.wz, { sex: 'f' });
    const beforeHealth = attacker.maxHealth;
    civilization._grantXp(attacker, 100);
    civilization.recordKill(attacker, victim);
    const progression = civilization.people.get(attacker.id).progression;
    expect(progression.level).toBeGreaterThan(1);
    expect(progression.kills).toBe(1);
    expect(attacker.maxHealth).toBeGreaterThan(beforeHealth);
    expect(attacker.health).toBeLessThanOrEqual(attacker.maxHealth);
  });

  it('construye una mina, consume el depósito y equipa trabajadores y soldados', () => {
    const { world, creatures, civilization, settlement, empire, land } = setup();
    world.mineralType.fill(0); world.mineralAmount.fill(0);
    world.mineralType[land.i] = 1; world.mineralAmount[land.i] = 20;
    const miner = creatures.spawn('human', land.wx, land.wz, { sex: 'm', profession: 'Minero' });
    const soldier = creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'f', profession: 'Soldado' });
    soldier.role = 'soldado';
    for (const person of [miner, soldier]) creatures.setHome(person, settlement.id, empire.id, settlement.x, settlement.z, 8);
    const before = world.mineralAmount[land.i];

    civilization.update(1.6);

    expect(civilization.describeSettlement(settlement).buildings).toContain('Mina');
    expect(world.mineralAmount[land.i]).toBeLessThan(before);
    expect(civilization.describeCreature(miner).items.some(item => item.includes('Herramienta'))).toBe(true);
    expect(civilization.describeCreature(soldier).items.some(item => item.includes('Arma'))).toBe(true);
    expect(civilization.describeCreature(soldier).items.some(item => item.includes('Armadura'))).toBe(true);
  });

  it('topa el mineral extraído igual que los recursos primarios en vez de acumularlo sin límite', () => {
    // wood/food/stone/gold/gems se topan en SettlementManager.updateEconomy(), pero ore/fish/
    // tools/weapons/armor/goods producidos en CivilizationSystem._runProduction() nunca pasaban
    // por ese tope — con un depósito grande y una sesión larga podían crecer indefinidamente.
    const { world, creatures, civilization, settlement, empire, land } = setup();
    world.mineralType.fill(0); world.mineralAmount.fill(0);
    world.mineralType[land.i] = 1; world.mineralAmount[land.i] = 100000;
    const miner = creatures.spawn('human', land.wx, land.wz, { sex: 'm', profession: 'Minero' });
    creatures.setHome(miner, settlement.id, empire.id, settlement.x, settlement.z, 8);

    for (let i = 0; i < 40; i++) civilization.update(50);

    const cap = 150 + settlement.level * 80;
    expect(settlement.resources.ore).toBeLessThanOrEqual(cap);
    expect(settlement.resources.ore).toBeGreaterThan(0);
  });

  it('mantiene ejércitos, alianzas y sucesión dinástica en el guardado', () => {
    const { creatures, settlements, civilization, settlement, empire, land } = setup();
    const king = creatures.spawn('human', land.wx, land.wz, { sex: 'm' });
    const heir = creatures.spawn('human', land.wx + 0.2, land.wz, { sex: 'f' });
    creatures.setHome(king, settlement.id, empire.id, settlement.x, settlement.z, 8);
    creatures.setHome(heir, settlement.id, empire.id, settlement.x, settlement.z, 8);
    king.role = 'soldado';
    civilization.registerBirth(heir, king, creatures.spawn('human', land.wx - 0.2, land.wz, { sex: 'f' }));
    const ally = settlements.createEmpire();
    settlements.settlements.push({ ...settlement, id: 2, empireId: ally.id, name: 'Puerto Aliado', resources: { ...settlement.resources } });
    ally.capitalId = 2;
    expect(settlements.makeAlliance(empire, ally)).toBe(true);
    expect(settlements.empires[0].relations.get(ally.id).status).toBe('alliance');
    expect(civilization.chooseHeir(empire, king.id)?.id).toBe(heir.id);

    civilization.update(1.6);
    const saved = civilization.serialize();
    expect(saved.armies).toEqual(expect.arrayContaining([
      expect.objectContaining({ empireId: empire.id, captainId: king.id, soldierIds: [king.id] }),
    ]));
    const restored = new CivilizationSystem(settlements.scene, civilization.world, creatures, settlements);
    disposable.push(restored);
    restored.restore(saved);
    expect(restored.people.get(heir.id).parentIds).toContain(king.id);
    expect(restored.clans.size).toBeGreaterThan(0);
    expect(restored.armies.get(empire.id)?.captainId).toBe(king.id);
  });

  it('evita que una aldea joven quede bloqueada antes de construir su mina', () => {
    const { world, creatures, civilization, settlement, empire, land } = setup();
    settlement.level = 0;
    settlement.resources = { wood: 20, food: 20, stone: 3, gold: 0, gems: 0 };
    world.mineralType.fill(0); world.mineralAmount.fill(0);
    world.mineralType[land.i] = 1; world.mineralAmount[land.i] = 30;
    const miner = creatures.spawn('human', land.wx, land.wz, { sex: 'm', profession: 'Minero' });
    creatures.setHome(miner, settlement.id, empire.id, settlement.x, settlement.z, 8);

    civilization.update(1.6);

    expect(settlement.resources.stone).toBeGreaterThan(3);
    expect(world.mineralAmount[land.i]).toBeLessThan(30);
  });

  it('mantiene viable una población fundadora generada con un solo sexo', () => {
    const { creatures, settlements, land } = setup();
    const founders = [0, 1, 2].map(offset => creatures.spawn('elf', land.wx + offset * 0.1, land.wz, { sex: 'm' }));
    settlements.addLabel = vi.fn();
    settlements.foundSettlement(land.wx + 12, land.wz + 12, founders, 'elf');

    expect(new Set(founders.map(founder => founder.sex))).toEqual(new Set(['m', 'f']));
  });

  it('coloca los edificios de producción en parcelas de la cuadrícula, no encima de casas/granjas', () => {
    // Regresión: _rebuildBuildingVisuals() colocaba cada edificio en un círculo alrededor del
    // centro del asentamiento, calculado sin tener en cuenta la cuadrícula de manzanas
    // (city-layout.js) que ya usan casas y granjas — en una ciudad real, ese círculo caía sobre
    // casas ya construidas en cuanto la ciudad crecía más allá de las primeras parcelas
    // (reportado en vivo, con captura: un mercado hundido en medio de una fila de casas).
    const { world, settlements, civilization, settlement } = setup();
    // This test is about grid placement, not coastal terrain, but the shared setup() drops the
    // settlement at the very first land tile scanned — often right at the coast on a size-32
    // island. flattenArea() no longer paves over water/rivers (see js/world.js — it used to,
    // which silently broke docks and erased rivers under a city), so a coastal spot that used to
    // get "topped up" to a full level-3 radius of dry land now genuinely doesn't have room for 16
    // houses + 2 farms + 6 buildings — exactly what a real playthrough would also run into on a
    // sliver of coastline. Give the site the same generous dry surroundings a settlement that
    // actually reached level 3 in play would have found.
    for (let dz = -15; dz <= 15; dz++) for (let dx = -15; dx <= 15; dx++) {
      const [vx, vz] = world.worldToGrid(settlement.x + dx, settlement.z + dz);
      if (!world.inBounds(vx, vz)) continue;
      const i = world.idx(vx, vz);
      world.height[i] = Math.max(world.height[i], 8);
      world.riverMask[i] = 0; world.riverHeight[i] = 0;
    }
    settlement.level = 3;
    settlement.resources = { wood: 500, food: 500, stone: 500, gold: 0, gems: 0 };
    settlements._prepareSettlementGround(settlement, 3);
    for (let i = 0; i < 16; i++) settlements.addHouse(settlement);
    settlements.addFarm(settlement); settlements.addFarm(settlement);
    const site = civilization._siteFor(settlement);
    for (const type of ['warehouse', 'workshop', 'smithy', 'barracks', 'market']) site.buildings.push({ type, level: 1, health: 120 });
    civilization._visualDirty = true;
    civilization.getBuildingObstacles();

    const CITY_BLOCK = 3.6; // must match city-layout.js's own constant
    const plotKey = (x, z) => `${Math.floor((x - settlement.x) / CITY_BLOCK)},${Math.floor((z - settlement.z) / CITY_BLOCK)}`;
    const occupied = new Set([...settlement.houses, ...settlement.farms].map(h => plotKey(h.x, h.z)));
    for (const building of site.buildings) {
      expect(building.x).not.toBeNull();
      expect(occupied.has(plotKey(building.x, building.z))).toBe(false);
    }
    // Two different buildings shouldn't double up on the same plot either.
    const buildingKeys = site.buildings.filter(b => b.type !== 'mine').map(b => plotKey(b.x, b.z));
    expect(new Set(buildingKeys).size).toBe(buildingKeys.length);
    expect(site.buildings).toHaveLength(6);
    expect([...civilization.buildingMeshes.values()].every(mesh=>!mesh.visible&&mesh.count===0)).toBe(true);
    expect(civilization.getBuildingObstacles()).toEqual([]);
  });
});
