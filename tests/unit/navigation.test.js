import { describe, expect, it } from 'vitest';
import { NavigationGrid } from '../../js/navigation.js';

function fakeWorld(size = 8) {
  const verts = size + 1;
  return {
    size, verts, half: size / 2,
    height: new Float32Array(verts * verts).fill(6),
    riverMask: new Uint8Array(verts * verts),
    ice: new Uint8Array(verts * verts),
    lava: new Uint8Array(verts * verts),
    danger: new Float32Array(verts * verts),
    idx(x, z) { return z * verts + x; },
    inBounds(x, z) { return x >= 0 && z >= 0 && x <= size && z <= size; },
    isWater(x, z) { return this.height[this.idx(x, z)] <= 5 || this.riverMask[this.idx(x, z)] === 1; },
    worldToGrid(x, z) { return [Math.round(x + this.half), Math.round(z + this.half)]; },
    gridToWorld(x, z) { return [x - this.half, z - this.half]; },
    biomeIdAt() { return 'grassland'; },
  };
}

describe('NavigationGrid', () => {
  it('recalcula tras destruir un puente, cerrar una puerta y cortar un canal', () => {
    const world = fakeWorld();
    const navigation = new NavigationGrid(world);
    for (let z = 0; z <= world.size; z++) world.height[world.idx(4, z)] = 4;
    world.height[world.idx(4, 4)] = 6;
    expect(navigation.findPathGrid(1, 4, 7, 4).length).toBeGreaterThan(0);
    expect(navigation.findPathGrid(1, 4, 7, 4, { isBlocked: (x, z) => x === 4 && z === 4 })).toEqual([]);
    world.height[world.idx(4, 4)] = 4;
    expect(navigation.findPathGrid(1, 4, 7, 4)).toEqual([]);
    expect(navigation.findPathGrid(4, 1, 4, 7, { mode: 'water' }).length).toBeGreaterThan(0);
    world.height[world.idx(4, 4)] = 6;
    expect(navigation.findPathGrid(4, 1, 4, 7, { mode: 'water' })).toEqual([]);
  });
  it('rodea obstáculos sólidos por tierra', () => {
    const world = fakeWorld();
    const navigation = new NavigationGrid(world);
    const path = navigation.findPathGrid(1, 4, 7, 4, { isBlocked: (x, z) => x === 4 && z !== 1 });
    expect(path.length).toBeGreaterThan(6);
    expect(path.some(([x, z]) => x === 4 && z === 1)).toBe(true);
  });

  it('mantiene separadas las rutas terrestres y acuáticas', () => {
    const world = fakeWorld();
    for (let x = 0; x <= world.size; x++) world.height[world.idx(x, 3)] = 4;
    const navigation = new NavigationGrid(world);
    expect(navigation.findPathGrid(1, 3, 7, 3, { mode: 'water' }).length).toBeGreaterThan(0);
    expect(navigation.findPathGrid(1, 2, 1, 4, { mode: 'land' }).length).toBe(0);
  });

  it('permite caminar sobre agua congelada pero no sobre lava', () => {
    const world = fakeWorld(3);
    world.height.fill(4);
    world.ice.fill(1);
    const navigation = new NavigationGrid(world);
    expect(Number.isFinite(navigation.traversalCost(1, 1, 0, 1, 'land'))).toBe(true);
    world.lava[world.idx(1, 1)] = 1;
    expect(navigation.traversalCost(1, 1, 0, 1, 'land')).toBe(Infinity);
  });

  describe('modo aire', () => {
    it('cruza agua y tierra por igual, a diferencia de tierra/agua que se bloquean entre sí', () => {
      const world = fakeWorld();
      for (let x = 0; x <= world.size; x++) world.height[world.idx(x, 3)] = 4; // franja de agua
      const navigation = new NavigationGrid(world);
      // Una ruta terrestre que cruzaría esa franja de agua es imposible por tierra...
      expect(navigation.findPathGrid(1, 2, 1, 4, { mode: 'land' }).length).toBe(0);
      // ...pero perfectamente válida por aire, sobre la misma franja.
      expect(navigation.findPathGrid(1, 2, 1, 4, { mode: 'air' }).length).toBeGreaterThan(0);
    });

    it('ignora los obstáculos de navegación terrestre (isBlocked), a diferencia de tierra', () => {
      const world = fakeWorld();
      const navigation = new NavigationGrid(world);
      const isBlocked = (x, z) => x === 4 && z === 4; // una única celda bloqueada
      expect(navigation.traversalCost(4, 4, 3, 4, 'land', isBlocked)).toBe(Infinity);
      expect(navigation.traversalCost(4, 4, 3, 4, 'air', isBlocked)).not.toBe(Infinity); // el aire ni lo consulta
    });

    it('trata la lava como transitable pero costosa en vez de intransitable', () => {
      const world = fakeWorld(3);
      world.height.fill(6);
      const navigation = new NavigationGrid(world);
      world.lava[world.idx(1, 1)] = 1;
      expect(navigation.traversalCost(1, 1, 0, 1, 'land')).toBe(Infinity);
      expect(navigation.traversalCost(1, 1, 0, 1, 'air')).toBe(8);
    });

    it('penaliza el peligro con un multiplicador menor que tierra/agua', () => {
      const world = fakeWorld(3);
      world.height.fill(6);
      world.danger[world.idx(1, 1)] = 10;
      const navigation = new NavigationGrid(world);
      const landCost = navigation.traversalCost(1, 1, 0, 1, 'land');
      const airCost = navigation.traversalCost(1, 1, 0, 1, 'air');
      expect(airCost).toBeLessThan(landCost); // 10*0.025=0.25 de recargo frente a 10*0.06=0.6
    });
  });
});
