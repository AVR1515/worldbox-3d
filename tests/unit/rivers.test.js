import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { World, CONFIG } from '../../js/world.js';
import { MAX_RIVER_CUT } from '../../js/river-routing.js';

let world;
afterEach(() => world?.dispose());

function terrain(heightAt = x => x < 12 ? 14 : Math.max(3, 14 - (x - 12) * 0.4)) {
  world = new World(new THREE.Scene(), { size: 48, events: { emit: vi.fn() } });
  for (let z = 0; z <= world.size; z++) {
    for (let x = 0; x <= world.size; x++) world.height[world.idx(x, z)] = heightAt(x, z);
  }
  world.buildTerrainMesh();
  return world;
}

describe('lagos de montaña y ríos', () => {
  it('sale de una meseta, llega al mar sin ciclos y conserva un cauce poco profundo', () => {
    terrain();
    const surface = world._lakeSurface(8, 24, 3);
    const before = world.height.slice();
    const trail = world._traceDownhillTrail(8, 24, 0, surface, 1.35);
    expect(trail.length).toBeGreaterThan(25);
    expect(new Set(trail.map(([x, z]) => world.idx(x, z))).size).toBe(trail.length);
    const last = trail.at(-1);
    expect(before[world.idx(last[0], last[1])]).toBeLessThanOrEqual(CONFIG.WATER_LEVEL);
    for (let k = 1; k < trail.length; k++) expect(trail[k][2]).toBeLessThanOrEqual(trail[k - 1][2]);

    world.floodWater(8, 24, 3);
    for (const [x, z, water] of trail) {
      const i = world.idx(x, z);
      expect(world.isWater(x, z)).toBe(true);
      expect(before[i] - world.height[i]).toBeLessThanOrEqual(MAX_RIVER_CUT + 1e-5);
      expect(world.height[i]).toBeLessThan(water);
      if (water > CONFIG.WATER_LEVEL) expect(world.riverHeight[i]).toBeCloseTo(water, 5);
    }
    expect(world.riverHeight[world.idx(8, 24)]).toBeGreaterThan(13);
  });

  it('busca una salida alrededor de una depresión en vez de terminar allí', () => {
    terrain((x, z) => {
      const slope = Math.max(3, 14 - Math.max(0, x - 12) * 0.4);
      return x >= 17 && x <= 20 && z >= 22 && z <= 26 ? slope - 2.5 : slope;
    });
    const trail = world._traceDownhillTrail(8, 24, 0, 13.65, 1.35);
    expect(trail.length).toBeGreaterThan(0);
    expect(world.height[world.idx(...trail.at(-1))]).toBeLessThanOrEqual(CONFIG.WATER_LEVEL);
  });

  it('mantiene un lago cerrado elevado y nunca baja un recorrido incompleto al mar', () => {
    terrain(() => 14);
    expect(world._traceDownhillTrail(24, 24, 0, 13.65)).toEqual([]);
    world.floodWater(24, 24, 3);
    expect(world.riverHeight[world.idx(24, 24)]).toBeCloseTo(13.65);
    const trail = Array.from({ length: 6 }, (_, k) => [24 + k, 24]);
    world._carveRiverBed(trail, 13.65);
    expect(Math.min(...world.height)).toBeGreaterThan(13);
  });

  it('actualiza el terreno visible y los recursos hasta la desembocadura', () => {
    terrain();
    const trail = world._traceDownhillTrail(8, 24, 0, 13.65, 1.35);
    const [x, z] = trail[Math.floor(trail.length / 2)];
    const i = world.idx(x, z);
    world.mineralType[i] = 1;
    world.mineralAmount[i] = 25;
    world.floodWater(8, 24, 3);
    expect(world.mineralType[i]).toBe(0);
    expect(world.biomeIdAt(x, z)).toBe('ocean');
    for (let j = 0; j < world.n; j++) {
      expect(world.terrainMesh.geometry.attributes.position.getY(j)).toBe(world.height[j]);
    }
    const [, bounds] = world.events.emit.mock.calls.at(-1);
    expect(bounds.maxX).toBeGreaterThanOrEqual(trail.at(-1)[0]);
    expect(world._riverVisualDirty).toBe(true);
  });

  it('mantener el pincel pulsado y bajar el fondo no hunden la superficie del lago', () => {
    terrain();
    world.floodWater(8, 24, 3);
    const i = world.idx(8, 24), surface = world.riverHeight[i], floor = world.height[i];
    for (let k = 0; k < 30; k++) world.floodWater(8, 24, 3);
    expect(world.riverHeight[i]).toBe(surface);
    expect(world.height[i]).toBe(floor);
    world.terraform(8, 24, 0, -1);
    expect(world.riverHeight[i]).toBe(surface);
    world.terraform(8, 24, 0, 2);
    expect(world.riverMask[i]).toBe(0);
  });

  it('recorta el agua en las orillas sin grietas ni paredes hacia el fondo', () => {
    terrain();
    world.floodWater(8, 24, 3);
    world.buildRiverMesh();
    const positions = world.riverMesh.geometry.attributes.position;
    expect(positions.count).toBeGreaterThan(0);
    const shared = new Map();
    for (let k = 0; k < positions.count; k++) {
      const x = positions.getX(k), y = positions.getY(k), z = positions.getZ(k);
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBeGreaterThanOrEqual(world.heightAtWorld(x, z) - 1e-5);
      const key = `${x.toFixed(5)},${z.toFixed(5)}`;
      if (shared.has(key)) expect(y).toBeCloseTo(shared.get(key), 4);
      shared.set(key, y);
    }
  });

  it('conserva los niveles existentes cuando un segundo río se une al primero', () => {
    terrain();
    world.floodWater(8, 24, 3);
    const before = world.riverHeight.slice();
    const trail = world._traceDownhillTrail(8, 28, 0, 13.65, 1.35);
    expect(trail.length).toBeGreaterThan(0);
    world.floodWater(8, 28, 3);
    for (const [x, z, surface] of trail) {
      const i = world.idx(x, z);
      expect(world.isWater(x, z)).toBe(true);
      if (surface > CONFIG.WATER_LEVEL) expect(world.riverHeight[i]).toBeCloseTo(surface, 5);
    }
    for (let i = 0; i < world.n; i++) if (before[i]) expect(world.riverHeight[i]).toBe(before[i]);
  });

  it('conserva el lago elevado y el cauce al guardar y restaurar', () => {
    terrain();
    world.floodWater(8, 24, 3);
    const saved = world.serialize();
    world.restore(saved);
    expect(Array.from(world.height)).toEqual(saved.height);
    expect(Array.from(world.riverMask)).toEqual(saved.riverMask);
    expect(Array.from(world.riverHeight)).toEqual(saved.riverHeight);
    expect(world.riverMesh.visible).toBe(true);
  });
});
