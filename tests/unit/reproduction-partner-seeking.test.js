import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CivilizationSystem } from '../../js/civilization-system.js';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// Regression test: CivilizationSystem.canReproduce() only allows an already-matched couple to have
// children (mutual partnerId, set by SettlementManager/CivilizationSystem's _formFamilies()), but
// CreatureManager's mate search used to just grab whichever same-type settlement-mate happened to
// be nearest — almost never the creature's actual partner once a settlement has more than two
// people. That silently capped most villages at their founding population forever (real play
// showed a map of 3-person settlements next to one lone city that reached 14+, purely by the luck
// of its one matched pair wandering close together). See _seekPartner() in creatures.js and
// CivilizationSystem.getPartner().
if (typeof document === 'undefined') {
  const fakeCtx = new Proxy({}, { get: () => () => fakeCtx });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };
}

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 5 });
  const creatures = new CreatureManager(scene, world, { laws: { aging: false, hunger: true, reproduction: true, disease: false } });
  const settlements = new SettlementManager(scene, world, creatures, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
  const civilization = new CivilizationSystem(scene, world, creatures, settlements, { toast: vi.fn() });
  creatures.setSettlementManager(settlements).setCivilizationSystem(civilization);
  settlements.setCivilizationSystem(civilization);
  disposable.push(world, creatures, settlements, civilization);
  let cx = null, cz = null;
  outer: for (let z = 10; z < world.size - 10; z++) {
    for (let x = 10; x < world.size - 10; x++) {
      if (!world.isWater(x, z) && world.isFlatEnough(x, z, 1.6)) { [cx, cz] = world.gridToWorld(x, z); break outer; }
    }
  }
  return { world, creatures, settlements, civilization, cx, cz };
}

describe('una pareja emparejada se busca activamente para reproducirse', () => {
  it('una aldea pequeña crece más allá de sus colonos fundadores', () => {
    const { creatures, settlements, civilization, cx, cz } = setup();
    const members = [
      creatures.spawn('human', cx, cz, { sex: 'm' }),
      creatures.spawn('human', cx + 0.2, cz, { sex: 'f' }),
      creatures.spawn('human', cx - 0.2, cz, { sex: 'f' }),
    ];
    // Founders otherwise start too young (age < 6) and mid-cooldown to reproduce right away —
    // fast-forward past that startup window instead of simulating it, so the test stays quick and
    // isolates the actual thing under test: whether a ready, matched pair ever finds each other.
    for (const m of members) { m.age = 8; m.hunger = 10; m.reproCooldown = 0; }
    settlements.foundSettlement(cx, cz, members, 'human');

    const dt = 0.1;
    let grew = false;
    for (let i = 0; i < 3000 && !grew; i++) {
      creatures.update(dt);
      settlements.update(dt);
      civilization.update(dt);
      grew = creatures.creatures.filter(c => c.alive).length > members.length;
    }
    expect(grew).toBe(true);
  });

  it('getPartner() encuentra a la pareja emparejada, no simplemente al vecino más cercano', () => {
    const { creatures, settlements, civilization, cx, cz } = setup();
    const partner = creatures.spawn('human', cx + 15, cz, { sex: 'f' }); // far away — the real match
    const person = creatures.spawn('human', cx, cz, { sex: 'm' });
    const bystander = creatures.spawn('human', cx + 0.5, cz, { sex: 'f' }); // nearest, but unrelated
    settlements.foundSettlement(cx, cz, [person, partner, bystander], 'human');
    civilization.ensurePerson(person).partnerId = partner.id;
    civilization.ensurePerson(partner).partnerId = person.id;

    expect(civilization.getPartner(person)?.id).toBe(partner.id);
    expect(civilization.getPartner(person)?.id).not.toBe(bystander.id);
    expect(civilization.getPartner(bystander)).toBeNull();
  });
});
