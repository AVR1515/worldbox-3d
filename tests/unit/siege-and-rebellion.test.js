import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { World } from '../../js/world.js';

// Regression/coverage tests for a gap found during the Fase A functional-matrix audit: siege
// (_updateSieges), conquest (captureSettlement) and rebellion (rebellionSupport/updateLoyalty/
// rebel) — central "war" systems — had zero test coverage despite being logically complex enough
// to break silently.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 22 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: true }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
  creatures.setCivilizationSystem(civilization);
  settlements.setCivilizationSystem(civilization);
  disposable.push(world, creatures, settlements, civilization);
  return { world, creatures, settlements, civilization };
}

function makeSettlement(settlements, empireId, id, x, z, level = 1) {
  const s = {
    id, x, z, level, houses: [], farms: [], empireId, race: 'human',
    name: `Ciudad ${id}`, pop: 20, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0, ore: 0, fish: 0, tools: 0, weapons: 0, armor: 0, goods: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

describe('asedio y conquista (_updateSieges / captureSettlement)', () => {
  it.each(['civil', 'otro imperio', 'guarnición', 'duplicado'])('no suma presión con una lista de ejército obsoleta: %s', kind => {
    const { creatures, settlements, civilization } = setup();
    const attacker = settlements.createEmpire(), defender = settlements.createEmpire();
    attacker.relations.set(defender.id, { status: 'war' });
    const city = makeSettlement(settlements, defender.id, 1, 0, 0, 3);
    settlements.addWall(city);
    const soldiers = [creatures.spawn('human', 1, 1), creatures.spawn('human', -1, 1)];
    for (const c of soldiers) { c.empireId = attacker.id; c.role = 'soldado'; }
    if (kind === 'civil') soldiers[1].role = null;
    if (kind === 'otro imperio') soldiers[1].empireId = defender.id;
    if (kind === 'guarnición') soldiers[1].garrison = true;
    const soldierIds = kind === 'duplicado' ? [soldiers[0].id, soldiers[0].id] : soldiers.map(c => c.id);
    civilization.armies.set(attacker.id, { empireId: attacker.id, order: 'siege', targetSettlementId: city.id, soldierIds });
    civilization._updateSieges(100);
    expect(settlements.walls.has(city.id)).toBe(true);
  });

  it('una orden antigua no sigue dañando la ciudad después de firmar la paz y cargar', () => {
    const { creatures, settlements, civilization } = setup();
    const attacker = settlements.createEmpire(), defender = settlements.createEmpire();
    attacker.relations.set(defender.id, { status: 'war' });
    makeSettlement(settlements, attacker.id, 2, -15, 0);
    const city = makeSettlement(settlements, defender.id, 1, 0, 0, 3);
    settlements.addWall(city);
    settlements.declareWar(attacker, defender);
    const soldiers = [creatures.spawn('human', 1, 1), creatures.spawn('human', -1, 1)];
    for (const c of soldiers) { c.empireId = attacker.id; c.role = 'soldado'; c.warTargetEmpire = defender.id; }
    civilization._syncArmies(0);
    settlements.makePeace(attacker, defender);
    civilization.restore(JSON.parse(JSON.stringify(civilization.serialize())));
    civilization._updateSieges(60);
    expect(settlements.walls.has(city.id)).toBe(true);
    expect(city.empireId).toBe(defender.id);
  });

  it('guardar y cargar después de un asedio no reconstruye gratis la muralla', () => {
    const { creatures, settlements, civilization } = setup();
    vi.spyOn(settlements, 'addLabel').mockImplementation(() => {});
    const attacker = settlements.createEmpire(), defender = settlements.createEmpire();
    attacker.relations.set(defender.id, { status: 'war' });
    const city = makeSettlement(settlements, defender.id, 1, 0, 0, 3);
    for (let i = 0; i < 14; i++) city.houses.push({ x: (i % 4 - 1.5) * 2.2, z: (Math.floor(i / 4) - 1.5) * 2.2, scaleMul: 1, variant: 1 });
    settlements.addWall(city);
    const soldiers = [creatures.spawn('human', 1, 1), creatures.spawn('human', -1, 1)];
    for (const c of soldiers) { c.empireId = attacker.id; c.role = 'soldado'; }
    civilization.armies.set(attacker.id, { empireId: attacker.id, order: 'siege', targetSettlementId: city.id, soldierIds: soldiers.map(c => c.id) });
    civilization._updateSieges(25);
    expect(settlements.walls.has(city.id)).toBe(false);
    const saved = JSON.parse(JSON.stringify(settlements.serialize()));
    settlements.restore(saved);
    const loaded = settlements.settlements.find(s => s.id === city.id);
    expect(loaded.level).toBe(3);
    expect(settlements.walls.has(city.id)).toBe(false);
    settlements._syncDefenses(loaded);
    expect(settlements.walls.has(city.id)).toBe(false);
    const empire = settlements.empires.find(e => e.id === loaded.empireId);
    empire.relations.clear();
    loaded.pop = 20;
    const resources = { ...loaded.resources };
    settlements._updateWallRepair(loaded, 30);
    expect(loaded.wallRepairRemaining).toBe(30);
    settlements.restore(JSON.parse(JSON.stringify(settlements.serialize())));
    const repairing = settlements.settlements.find(s => s.id === city.id);
    expect(repairing.wallRepairRemaining).toBe(30);
    repairing.pop = 20;
    settlements._updateWallRepair(repairing, 30);
    expect(settlements.walls.has(city.id)).toBe(true);
    expect(repairing.resources.wood).toBe(resources.wood - 15);
    expect(repairing.resources.stone).toBe(resources.stone - 30);
    settlements._updateWallRepair(repairing, 60);
    expect(repairing.resources.stone).toBe(resources.stone - 30);
  });

  it('no repara durante la guerra ni sin recursos y no produce inventarios negativos', () => {
    const { settlements } = setup();
    const empire = settlements.createEmpire(), enemy = settlements.createEmpire();
    const city = makeSettlement(settlements, empire.id, 1, 0, 0, 3);
    settlements.addWall(city); settlements.breachWall(city);
    empire.relations.set(enemy.id, { status: 'war' });
    settlements._updateWallRepair(city, 120);
    expect(city.wallRepairRemaining).toBe(60);
    expect(settlements.describeWallRepair(city)).toContain('paz');
    empire.relations.clear(); city.resources.stone = 29;
    settlements._updateWallRepair(city, 120);
    expect(city.wallRepairRemaining).toBe(60);
    expect(city.resources.stone).toBe(29);
    expect(settlements.describeWallRepair(city)).toContain('30 de piedra');
  });
  it('primero derriba la muralla y solo conquista después, sin defensores cerca', () => {
    const { creatures, settlements, civilization } = setup();
    const attackerEmpire = settlements.createEmpire();
    const defenderEmpire = settlements.createEmpire();
    attackerEmpire.relations.set(defenderEmpire.id, { status: 'war' });
    const target = makeSettlement(settlements, defenderEmpire.id, 1, 0, 0, 3);
    settlements.addWall(target);
    expect(settlements.walls.has(target.id)).toBe(true);

    const soldier1 = creatures.spawn('human', 1, 1, { sex: 'm' });
    const soldier2 = creatures.spawn('human', -1, 1, { sex: 'f' });
    for (const soldier of [soldier1, soldier2]) { soldier.empireId = attackerEmpire.id; soldier.role = 'soldado'; }
    civilization.armies.set(attackerEmpire.id, {
      empireId: attackerEmpire.id, order: 'siege', targetSettlementId: target.id,
      soldierIds: [soldier1.id, soldier2.id], posture: 'balanced',
    });

    // First pass: enough sustained pressure (no defenders) to fully deplete the default siege
    // health (100) — but the settlement is still walled, so this must knock the wall down instead
    // of capturing outright.
    civilization._updateSieges(25);
    expect(settlements.walls.has(target.id)).toBe(false);
    expect(target.empireId).toBe(defenderEmpire.id); // still not captured

    // Second pass: wall is gone now, no defenders nearby — this is what actually captures it.
    civilization._updateSieges(25);
    expect(target.empireId).toBe(attackerEmpire.id);
  });

  it('no conquista mientras haya defensores cerca, aunque la salud de asedio llegue a cero', () => {
    const { creatures, settlements, civilization } = setup();
    const attackerEmpire = settlements.createEmpire();
    const defenderEmpire = settlements.createEmpire();
    attackerEmpire.relations.set(defenderEmpire.id, { status: 'war' });
    const target = makeSettlement(settlements, defenderEmpire.id, 1, 0, 0, 1); // sin muralla (nivel < 3)

    const soldier1 = creatures.spawn('human', 1, 1, { sex: 'm' });
    const soldier2 = creatures.spawn('human', -1, 1, { sex: 'f' });
    for (const soldier of [soldier1, soldier2]) { soldier.empireId = attackerEmpire.id; soldier.role = 'soldado'; }
    const defender = creatures.spawn('human', 0, 0.5, { sex: 'm' });
    defender.empireId = defenderEmpire.id;
    civilization.armies.set(attackerEmpire.id, {
      empireId: attackerEmpire.id, order: 'siege', targetSettlementId: target.id,
      soldierIds: [soldier1.id, soldier2.id], posture: 'balanced',
    });

    civilization._updateSieges(60);
    expect(target.empireId).toBe(defenderEmpire.id); // defensor presente: nunca cae, solo se resetea la salud de asedio
  });

  it('captureSettlement() transfiere el imperio, desmoviliza soldados y libera al rey', () => {
    const { creatures, settlements } = setup();
    const attackerEmpire = settlements.createEmpire();
    const defenderEmpire = settlements.createEmpire();
    attackerEmpire.relations.set(defenderEmpire.id, { status: 'war' });
    const target = makeSettlement(settlements, defenderEmpire.id, 1, 0, 0, 2);
    const king = creatures.spawn('human', 0, 0, { sex: 'm' });
    king.profession = 'Rey';
    king.settlementId = target.id;
    king.empireId = defenderEmpire.id;
    defenderEmpire.kingId = king.id;
    const soldier = creatures.spawn('human', 0.2, 0, { sex: 'f' });
    soldier.settlementId = target.id;
    soldier.empireId = defenderEmpire.id;
    soldier.role = 'soldado';

    const result = settlements.captureSettlement(target, attackerEmpire);

    expect(result).toBe(true);
    expect(target.empireId).toBe(attackerEmpire.id);
    expect(target.loyalty).toBe(100);
    expect(king.profession).toBe('Aldeano'); // ya no es rey de nadie
    expect(defenderEmpire.kingId).toBeNull();
    expect(soldier.role).toBeNull(); // _demobilize() lo desarmó
    expect(king.empireId).toBe(attackerEmpire.id);
  });

  it('captureSettlement() no hace nada si el atacante ya es el dueño', () => {
    const { settlements } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, 0, 0);
    expect(settlements.captureSettlement(s, empire)).toBe(false);
  });
});

describe('rebeliones (rebellionSupport / updateLoyalty / rebel)', () => {
  it('rebel() funda un imperio nuevo, corona al residente de más edad y resetea la lealtad', () => {
    const { creatures, settlements } = setup();
    const oldEmpire = settlements.createEmpire();
    const s = makeSettlement(settlements, oldEmpire.id, 1, 0, 0, 2);
    s.loyalty = 5;
    const younger = creatures.spawn('human', 0.1, 0, { sex: 'f' });
    younger.settlementId = s.id; younger.empireId = oldEmpire.id; younger.age = 10;
    const elder = creatures.spawn('human', -0.1, 0, { sex: 'm' });
    elder.settlementId = s.id; elder.empireId = oldEmpire.id; elder.age = 40;

    const empiresBefore = settlements.empires.length;
    const ok = settlements.rebel(s);

    expect(ok).toBe(true);
    expect(settlements.empires.length).toBe(empiresBefore + 1);
    expect(s.empireId).not.toBe(oldEmpire.id);
    expect(s.loyalty).toBe(100);
    const newEmpire = settlements.empires.find(e => e.id === s.empireId);
    expect(newEmpire.capitalId).toBe(s.id);
    expect(newEmpire.kingId).toBe(elder.id); // el mayor de los residentes, a falta de líder de clan
    expect(elder.profession).toBe('Rey');
    expect(younger.empireId).toBe(newEmpire.id); // los residentes emigran al nuevo imperio
  });

  it('rebel() no hace nada si la ley de rebeliones está desactivada', () => {
    const scene = new THREE.Scene();
    const world = new World(scene, { size: 32 });
    world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 5 });
    const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
    const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: false }, toast: vi.fn() });
    disposable.push(world, creatures, settlements);
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, 0, 0);
    expect(settlements.rebel(s)).toBe(false);
    expect(s.empireId).toBe(empire.id);
  });

  it('updateLoyalty() reduce la lealtad de un asentamiento lejos de la capital, no de la capital misma', () => {
    const { settlements } = setup();
    // Force away the random rebellion roll itself so this test only exercises the loyalty decay
    // math, not whether rebel() also fires this tick.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      const empire = settlements.createEmpire();
      const capital = makeSettlement(settlements, empire.id, 1, 0, 0);
      empire.capitalId = capital.id;
      const distant = makeSettlement(settlements, empire.id, 2, 200, 200);

      settlements.updateLoyalty();

      expect(capital.loyalty).toBe(100); // la capital siempre tiene lealtad plena
      expect(distant.loyalty).toBeLessThan(100);
      expect(distant.rebellionSupport).toBeGreaterThanOrEqual(0);
      expect(distant.rebellionSupport).toBeLessThanOrEqual(100);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
