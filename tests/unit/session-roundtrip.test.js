import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameSession } from '../../js/game-session.js';
import { SaveRepository, SAVE_FORMAT_VERSION } from '../../js/save-system.js';

const sessions = [];
afterEach(() => { while (sessions.length) sessions.pop().dispose(); vi.restoreAllMocks(); });
const laws = { aging: true, hunger: true, reproduction: true, disease: true, diplomacy: true, rebellions: true, naturalDisasters: false };
function session() {
  const result = new GameSession({ scene: new THREE.Scene(), size: 48, laws });
  // Solo se omite el texto dibujado en canvas; todos los sistemas de simulación son reales.
  vi.spyOn(result.settlements, 'addLabel').mockImplementation(() => {});
  sessions.push(result);
  return result;
}
function capture(s) {
  return { version: SAVE_FORMAT_VERSION, schema: { version: SAVE_FORMAT_VERSION },
    ...Object.fromEntries(['world', 'creatures', 'settlements', 'ships', 'civilization', 'cataclysms'].map(key => [key, s[key].serialize()])) };
}
describe('partida integrada y persistencia', () => {
  it.each([17, 41, 4421])('conserva aldea, ciudadanos, estados y recursos al continuar la semilla %i', seed => {
    let rng = seed;
    vi.spyOn(Math, 'random').mockImplementation(() => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; });
    const original = session();
    original.world.generate({ seed, mapType: 'island', mountainLevel: 0 });
    let land;
    for (let z = 12; z < 36 && !land; z++) for (let x = 12; x < 36 && !land; x++) {
      if (!original.world.isWater(x, z) && original.world.isFlatEnough(x, z, 1.6)) land = original.world.gridToWorld(x, z);
    }
    expect(land).toBeTruthy();
    const members = ['m', 'f', 'f', 'm'].map(sex => original.creatures.spawn('human', ...land, { sex }));
    original.settlements.foundSettlement(...land, members, 'human');
    original.statuses.apply(members[0], 'shielded', { duration: 100 });
    for (let i = 0; i < 150; i++) original.runtime.update(1 / 30, 1);
    const before = capture(original);
    const values = new Map();
    const repository = new SaveRepository({ getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) });
    repository.save(before);
    const saved = repository.load();
    const restored = session();
    restored.world.restore(saved.world);
    restored.creatures.restore(saved.creatures);
    restored.statuses.syncFromCreatures();
    restored.settlements.restore(saved.settlements);
    restored.ships.restore(saved.ships);
    restored.civilization.restore(saved.civilization);
    restored.cataclysms.restore(saved.cataclysms);
    expect(restored.creatures.creatures.map(c => c.id)).toEqual(original.creatures.creatures.map(c => c.id));
    expect(restored.world.height).toEqual(original.world.height);
    expect(restored.settlements.settlements[0].resources).toEqual(original.settlements.settlements[0].resources);
    expect(restored.statuses.describe(restored.creatures.creatureById.get(members[0].id))).toEqual(original.statuses.describe(members[0]));
    for (let i = 0; i < 150; i++) restored.runtime.update(1 / 30, 1);
    for (const c of restored.creatures.creatures) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.health)).toBe(true);
      if (c.settlementId != null) expect(restored.settlements.settlements.some(s => s.id === c.settlementId)).toBe(true);
    }
    for (const s of restored.settlements.settlements) for (const value of Object.values(s.resources)) expect(Number.isFinite(value) && value >= 0).toBe(true);
    expect(restored.runtime.snapshot().droppedSeconds).toBe(0);
  });
});
