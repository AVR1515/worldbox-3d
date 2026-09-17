import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';

// restore() calls addLabel(), which draws the city name onto a <canvas> for a sprite texture —
// real DOM work this suite's plain-Node environment doesn't have (see founding-and-hunger.test.js
// for the same stub).
if (typeof document === 'undefined') {
  const fakeCtx = new Proxy({}, { get: () => () => fakeCtx });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };
}

// Every race (elves included) builds from the same six urban timber-and-plaster townhouses now —
// the pack's old mushroom-cottage and regular house_00X GLBs are only still picked when restoring
// a save that already has houses in one of them (see HOUSE_VARIANTS and houseVariantIndicesFor()
// in settlements.js) — reported live as "old city generation houses" still appearing (a mushroom
// cottage mixed into an otherwise new-style grid). Also guards against the file-path bug this was
// written after: the house pack used to ship as one combined scene (Fantasy_FREE.glb) and was
// later split into one .glb per prop on disk, which silently broke house rendering (every house
// fell back to a magenta Three.js "material missing" box) until the loader was pointed at the new
// per-file paths.
const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop()?.dispose?.(); });

function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 48 });
  world.generate({ mapType: 'island', climate: 'templado', humidity: 'normal', waterLevel: 'normal', mountainLevel: 0, seed: 41 });
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

function makeSettlement(settlements, empireId, id, x, z, race) {
  const s = {
    id, x, z, level: 3, houses: [], farms: [], empireId, race,
    name: `Ciudad ${id}`, pop: 20, loyalty: 100, growTimer: 999, emptyTimer: 0,
    resources: { wood: 999, food: 999, stone: 999, gold: 0, gems: 0 },
  };
  settlements.settlements.push(s);
  return s;
}

describe('las casas se eligen según la raza del asentamiento', () => {
  it('un asentamiento élfico también construye las casas urbanas nuevas, no hongos', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 'elf');
    for (let i = 0; i < 10; i++) settlements.addHouse(s);
    expect(s.houses.length).toBeGreaterThan(0);
    for (const house of s.houses) {
      expect(house.variant).toBeGreaterThanOrEqual(7); // six new timber-and-plaster designs
      expect(house.variant).toBeLessThan(13);
    }
  });

  it('un asentamiento humano nunca construye una variante de hongo', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 'human');
    for (let i = 0; i < 10; i++) settlements.addHouse(s);
    expect(s.houses.length).toBeGreaterThan(0);
    for (const house of s.houses) {
      expect(house.variant).toBeGreaterThanOrEqual(7); // six new timber-and-plaster designs
      expect(house.variant).toBeLessThan(13);
    }
  });

  it('serialize()/restore() conservan la variante y se autocorrigen si no coincide con la raza', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 'elf');
    settlements.addHouse(s);
    const snapshot = settlements.serialize();
    // Corrupt the saved variant to a human one, as if this row predated the elf/mushroom split.
    snapshot.settlements[0].houses[0].variant = 0;

    const scene2 = new THREE.Scene();
    disposable.push(scene2);
    const world2 = settlements.world;
    const creatures2 = new CreatureManager(scene2, world2, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
    const settlements2 = new SettlementManager(scene2, world2, creatures2, { laws: { diplomacy: false, rebellions: false }, toast: vi.fn() });
    creatures2.setSettlementManager(settlements2);
    disposable.push(creatures2, settlements2);
    settlements2.restore(snapshot);

    const restored = settlements2.settlements.find(x => x.id === 1);
    expect(restored.houses[0].variant).toBeGreaterThanOrEqual(3); // self-healed back to a mushroom variant
    expect(restored.houses[0].gridPlot).toBe(true);
    expect(restored.houses[0].x).toBe(s.houses[0].x);
    expect(restored.houses[0].z).toBe(s.houses[0].z);
    expect(restored.houses[0].rotationY).toBe(s.houses[0].rotationY);
  });

  // Regression test: allocHouseSlot() grows every variant's InstancedMesh .count together (house
  // slots are one shared index space, not per-variant), but only the winning variant's mesh ever
  // gets a real transform written at a given slot — every other variant's mesh defaulted to an
  // untouched identity matrix at that same slot index, which is now within .count and so got
  // drawn: a phantom house of every other variant stacked at world (0,0,0). Fixed by explicitly
  // parking a slot out of view in every mesh that isn't the one actually used.
  it('las variantes de casa no usadas no dejan una instancia fantasma en el origen', () => {
    const { settlements, cx, cz } = setup();
    const empire = settlements.createEmpire();
    const s = makeSettlement(settlements, empire.id, 1, cx, cz, 'human');
    // addHouse() rolls an unseeded random angle/distance per try (14 tries) — setup() already
    // guarantees flat, non-water land at (cx, cz), but a run of bad rolls can still occasionally
    // exhaust all 14 by chance. Retrying keeps this deterministic without weakening what it checks.
    for (let i = 0; i < 20 && !s.houses.length; i++) settlements.addHouse(s);
    expect(s.houses.length).toBe(1);
    const { variant: usedVariant, slot } = s.houses[0];
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < settlements.houseMeshes.length; i++) {
      if (i === usedVariant) continue;
      settlements.houseMeshes[i].getMatrixAt(slot, matrix);
      const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(pos.y).toBeLessThan(-50); // parked well below ground, not left visible at the origin
    }
  });
});
