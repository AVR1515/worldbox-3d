import { describe, it, expect } from 'vitest';
import { cityPlots, cityStreets, cityBoundary, cityWallPieces, CITY_BLOCK, cityDetails } from '../../js/city-layout.js';

describe('planned city blocks', () => {
  it('traces a closed stepped boundary with four gates and leaves the outer streets clear', () => {
    const s = { x: 0, z: 0, houses: [{ x: 1.8, z: 1.8, gridPlot: true }, { x: 5.4, z: 1.8, gridPlot: true }, { x: 1.8, z: 5.4, gridPlot: true }], farms: [] };
    const { polygon, segments, gates } = cityBoundary(s);
    expect(polygon.length).toBeGreaterThan(4);
    expect(gates).toHaveLength(4);
    for (let i = 0; i < segments.length; i++) {
      const { a, b } = segments[i];
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      expect(b).toEqual(segments[(i+1)%segments.length].a);
      for (const h of s.houses) {
        const dx = b[0]-a[0], dz = b[1]-a[1], len2 = dx*dx+dz*dz;
        const t = Math.max(0, Math.min(1, ((h.x-a[0])*dx+(h.z-a[1])*dz)/len2));
        expect(Math.hypot(h.x-a[0]-t*dx, h.z-a[1]-t*dz)).toBeGreaterThan(2.4);
      }
    }
    const pieces = cityWallPieces(s);
    expect(pieces.filter(p => p.isGate)).toHaveLength(4);
    expect(pieces.every(p => p.width > 0 && Number.isFinite(p.rotationY))).toBe(true);
  });
  it('has enough plots to grow through every settlement level, with farms reserved', () => {
    for (const [radius, minimum] of [[4, 3], [6, 9], [9, 16], [13, 25]]) {
      const plots = cityPlots({ x: 11, z: -7 }, radius);
      expect(plots.length).toBeGreaterThanOrEqual(minimum);
      for (let i = 0; i < plots.length; i++) for (const p of plots.slice(i + 1)) {
        expect(Math.hypot(p.x - plots[i].x, p.z - plots[i].z)).toBeGreaterThanOrEqual(CITY_BLOCK - 1e-8);
      }
    }
  });
  it('deduplicates block boundaries and connects separated plots with orthogonal streets', () => {
    const s = { x: 0, z: 0, houses: cityPlots({ x: 0, z: 0 }, 13).filter((_, i) => i % 3 === 0).map(p => ({ ...p, gridPlot: true })) };
    const roads = cityStreets(s);
    expect(roads.length).toBeGreaterThan(0);
    const graph = new Map();
    for (const [a, b] of roads) {
      expect(a[0] === b[0] || a[1] === b[1]).toBe(true);
      for (const [from, to] of [[a, b], [b, a]]) {
        const key = from.join(',');
        if (!graph.has(key)) graph.set(key, []);
        graph.get(key).push(to.join(','));
      }
    }
    const visited = new Set(), pending = ['0,0'];
    while (pending.length) {
      const key = pending.pop();
      if (visited.has(key)) continue;
      visited.add(key); pending.push(...graph.get(key));
    }
    expect(visited.size).toBe(graph.size);
    expect(new Set(roads.map(r => r.map(p => p.join(',')).sort().join('|'))).size).toBe(roads.length);
  });
  it('keeps legacy homes intact and produces finite decorative geometry', () => {
    const legacy = { x: 0, z: 0, houses: [{ x: 2, z: 2 }] };
    expect(cityStreets(legacy)).toEqual([]);
    const geometry = cityDetails({ heightAtWorld: () => 7 }, [{ ...legacy, houses: [{ x: 1.8, z: 1.8, gridPlot: true }] }]);
    expect(geometry.attributes.position.count).toBeGreaterThan(0);
    expect([...geometry.attributes.position.array].every(Number.isFinite)).toBe(true);
    geometry.dispose();
  });
});
