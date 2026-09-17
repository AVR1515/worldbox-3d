import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { World } from '../../js/world.js';

// Regression/feature tests for the Fase 12 "editor de órdenes y formaciones militares": letting
// the player retarget an army's siege mid-campaign, force a stand-down, and set a combat posture
// ("formación") — see the "Player-facing army orders" section in civilization-system.js and the
// postureMul line in creatures.js's combat damage resolution.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 22 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: true, rebellions: false }, toast: vi.fn() });
  creatures.setSettlementManager(settlements);
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
  disposable.push(world, creatures, settlements, civilization);
  return { world, creatures, settlements, civilization };
}

function makeSettlement(settlements, empireId, id, x, z, level = 1) {
  const s = {
    id, x, z, level, houses: [], farms: [], empireId, race: 'human',
    name: `Ciudad ${id}`, pop: 20, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

describe('retargetArmy', () => {
  it('declara la guerra si hace falta y apunta al asentamiento elegido, no al de mayor nivel por defecto', () => {
    const { settlements, civilization } = setup();
    const empireA = settlements.createEmpire();
    const empireB = settlements.createEmpire();
    makeSettlement(settlements, empireA.id, 1, 0, 0);
    // Empire B has two settlements — _warTarget()'s default picks the highest-level one (id 3).
    // The player should be able to point the army at the *other* one (id 2) instead.
    const lowLevelTarget = makeSettlement(settlements, empireB.id, 2, 20, 0, 1);
    makeSettlement(settlements, empireB.id, 3, 40, 0, 3);

    expect(empireA.relations.get(empireB.id)?.status).not.toBe('war');
    const ok = civilization.retargetArmy(empireA.id, lowLevelTarget.id);
    expect(ok).toBe(true);
    expect(empireA.relations.get(empireB.id).status).toBe('war');
    expect(empireA.relations.get(empireB.id).warGoal).toBe(lowLevelTarget.id);

    civilization.update(2); // >= UPDATE_INTERVAL, forces a real _syncArmies() pass
    const army = civilization.armies.get(empireA.id);
    expect(army.order).toBe('siege');
    expect(army.targetSettlementId).toBe(lowLevelTarget.id); // not settlement 3, despite its higher level
  });

  it('rechaza apuntar a un asentamiento del propio imperio', () => {
    const { settlements, civilization } = setup();
    const empireA = settlements.createEmpire();
    const own = makeSettlement(settlements, empireA.id, 1, 0, 0);
    expect(civilization.retargetArmy(empireA.id, own.id)).toBe(false);
  });

  it('rechaza un imperio o asentamiento inexistente', () => {
    const { civilization } = setup();
    expect(civilization.retargetArmy(999, 999)).toBe(false);
  });
});

describe('standDownArmy', () => {
  it('hace las paces con el enemigo actual y desmoviliza a los soldados', () => {
    const { creatures, settlements, civilization } = setup();
    const empireA = settlements.createEmpire();
    const empireB = settlements.createEmpire();
    makeSettlement(settlements, empireA.id, 1, 0, 0);
    const targetB = makeSettlement(settlements, empireB.id, 2, 20, 0);
    civilization.retargetArmy(empireA.id, targetB.id);
    expect(empireA.relations.get(empireB.id).status).toBe('war');

    const soldier = creatures.spawn('human', 1, 1, { sex: 'm' });
    soldier.empireId = empireA.id;
    soldier.role = 'soldado';
    soldier.warTargetEmpire = empireB.id;

    const ok = civilization.standDownArmy(empireA.id);
    expect(ok).toBe(true);
    expect(empireA.relations.get(empireB.id).status).toBe('peace');
    expect(soldier.role).toBeNull(); // _demobilize() ran, same path a natural peace treaty takes
    expect(soldier.warTargetEmpire).toBeNull();
  });

  it('no hace nada si el imperio no está en guerra con nadie', () => {
    const { settlements, civilization } = setup();
    const empireA = settlements.createEmpire();
    makeSettlement(settlements, empireA.id, 1, 0, 0);
    expect(civilization.standDownArmy(empireA.id)).toBe(false);
  });
});

describe('setArmyPosture', () => {
  it('rechaza valores inválidos y aplica los multiplicadores a los soldados vía _syncArmies()', () => {
    const { creatures, settlements, civilization } = setup();
    const empire = settlements.createEmpire();
    makeSettlement(settlements, empire.id, 1, 0, 0);
    expect(civilization.setArmyPosture(empire.id, 'berserker')).toBe(false);
    expect(civilization.setArmyPosture(empire.id, 'aggressive')).toBe(true);

    const soldier = creatures.spawn('human', 1, 1, { sex: 'm' });
    soldier.empireId = empire.id;
    soldier.role = 'soldado';
    civilization.update(2);

    expect(soldier.stanceOffenseMul).toBeCloseTo(1.25);
    expect(soldier.stanceDefenseMul).toBeCloseTo(0.85);
  });
});

describe('la postura de combate afecta el daño real entre soldados', () => {
  it('una postura agresiva inflige más daño que una cautelosa, para el mismo golpe', () => {
    const { world, creatures } = setup();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // clears both the attack-rate and dodge rolls every time
    try {
      const [x, z] = world.gridToWorld(Math.floor(world.size / 2), Math.floor(world.size / 2));
      const attacker = creatures.spawn('human', x, z, { sex: 'm' });
      const defender = creatures.spawn('human', x + 0.3, z, { sex: 'f' }); // within COMBAT_ATTACK_RANGE (0.78)
      for (const c of [attacker, defender]) { c.role = 'soldado'; c.archer = false; c.aiTimer = 999; }
      attacker.combatTarget = defender.id;
      attacker.stanceOffenseMul = 1.25; // 'aggressive'
      defender.stanceDefenseMul = 1;
      const healthBefore = defender.health;
      creatures.update(1);
      const aggressiveDamage = healthBefore - defender.health;
      expect(aggressiveDamage).toBeGreaterThan(0); // sanity check the mocked RNG actually landed a hit

      defender.health = healthBefore;
      defender.stanceDefenseMul = 1.22; // 'cautious'
      creatures.update(1);
      const cautiousDamage = healthBefore - defender.health;

      expect(aggressiveDamage).toBeGreaterThan(cautiousDamage);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
