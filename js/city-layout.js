import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

export const CITY_BLOCK = 3.6;

export function createTownhouse(variant) {
  const pieces = [];
  const colorize = (g, color) => {
    g.deleteAttribute('uv');
    const c = new THREE.Color(color), data = [];
    for (let i = 0; i < g.attributes.position.count; i++) data.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(data, 3));
    pieces.push(g);
  };
  const box = (x, y, z, w, h, d, color) => colorize(new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z), color);
  const tall = variant % 3 !== 0, height = tall ? 1.38 : .95;
  const width = variant % 2 ? 1.25 : 1.4, depth = 1.15;
  const timber = 0x514333, plaster = [0xe6dab8, 0xd8c5a2, 0xe1d9c9][variant % 3];
  const roof = [0xa85335, 0x597689, 0x8d6245, 0xb88543, 0x6a737d, 0x985747][variant];
  box(0, .09, 0, width + .08, .18, depth + .08, 0x898579);
  box(0, height / 2 + .12, 0, width, height, depth, plaster);
  for (const x of [-width / 2, 0, width / 2]) {
    for (const z of [-depth / 2 - .015, depth / 2 + .015]) box(x, height / 2 + .12, z, .065, height, .055, timber);
  }
  for (const y of [.22, height + .1, ...(tall ? [.83] : [])]) {
    box(0, y, 0, width + .06, .07, depth + .06, timber);
  }
  for (const z of [-depth / 2 - .04, depth / 2 + .04]) {
    for (const x of [-width * .29, width * .29]) {
      box(x, .57, z, .25, .3, .035, 0x344e53);
      box(x, .57, z + Math.sign(z) * .02, .025, .3, .02, 0xc8b687);
      if (tall) box(x, 1.12, z, .24, .25, .035, 0x405c65);
    }
  }
  box(0, .38, depth / 2 + .055, .26, .52, .06, 0x745235);
  box(0, .07, depth / 2 + .17, .5, .12, .28, 0xaaa394);
  const w = width / 2 + .13, d = depth / 2 + .14, y = height + .12, top = y + .58;
  const vertices = [-w,y,-d, w,y,-d, 0,top,-d, -w,y,d, w,y,d, 0,top,d];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex([0,2,1,3,4,5,0,3,5,0,5,2,2,5,4,2,4,1,0,1,4,0,4,3]);
  g.computeVertexNormals();
  const flatRoof = g.toNonIndexed(); flatRoof.computeVertexNormals(); colorize(flatRoof, roof); g.dispose();
  box(width * .27, top - .04, -.23, .16, .56, .19, 0x908b7d);
  box(width * .27, top + .25, -.23, .21, .065, .24, 0xb0a694);
  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return geometry;
}

// Stable plots: growth fills the centre first without moving existing residents.
export function cityPlots(s, radius) {
  const plots = [];
  const n = Math.ceil(radius / CITY_BLOCK);
  for (let row = -n; row < n; row++) for (let col = -n; col < n; col++) {
    const dx = (col + 0.5) * CITY_BLOCK, dz = (row + 0.5) * CITY_BLOCK;
    const boundary = radius + (radius < 9 ? 2.2 : 1.2);
    if (Math.hypot(Math.abs(dx) + CITY_BLOCK / 2, Math.abs(dz) + CITY_BLOCK / 2) > boundary) continue;
    plots.push({ x: s.x + dx, z: s.z + dz, col, row,
      rotationY: dz > 0 ? Math.PI : 0 });
  }
  return plots.sort((a, b) => Math.hypot(a.col + .5, a.row + .5) - Math.hypot(b.col + .5, b.row + .5) || a.row - b.row || a.col - b.col);
}

// Fill the blocks between each occupied plot and the civic centre. This produces one
// connected, hole-free footprint, including older saves whose houses weren't on a grid.
export function cityBoundary(s) {
  const cells = new Set();
  const occupy = (col, row) => cells.add(`${col},${row}`);
  for (const h of [...s.houses, ...(s.farms || [])]) {
    const col = Math.floor((h.x - s.x) / CITY_BLOCK), row = Math.floor((h.z - s.z) / CITY_BLOCK);
    for (let z = Math.min(-1, row); z <= Math.max(0, row); z++) {
      for (let x = Math.min(-1, col); x <= Math.max(0, col); x++) occupy(x, z);
    }
  }
  if (!cells.size) for (const x of [-1, 0]) for (const z of [-1, 0]) occupy(x, z);
  const edges = new Map();
  for (const cell of cells) {
    const [x, z] = cell.split(',').map(Number);
    for (const [a, b, neighbor] of [
      [[x,z], [x+1,z], [x,z-1]], [[x+1,z], [x+1,z+1], [x+1,z]],
      [[x+1,z+1], [x,z+1], [x,z+1]], [[x,z+1], [x,z], [x-1,z]],
    ]) if (!cells.has(neighbor.join(','))) edges.set(a.join(','), b);
  }
  const start = edges.keys().next().value, points = [];
  let cursor = start;
  do {
    points.push(cursor.split(',').map(Number));
    cursor = edges.get(cursor).join(',');
  } while (cursor !== start);
  // Drop collinear vertices, then offset beyond the outer street edge.
  const corners = points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
    return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
  });
  const normal = (a, b) => { const length = Math.hypot(b[0]-a[0], b[1]-a[1]); return [(b[1]-a[1])/length, -(b[0]-a[0])/length]; };
  const polygon = corners.map((p, i) => {
    const n1 = normal(corners[(i + corners.length - 1) % corners.length], p), n2 = normal(p, corners[(i + 1) % corners.length]);
    return [s.x + p[0] * CITY_BLOCK + (n1[0] + n2[0]) * .7, s.z + p[1] * CITY_BLOCK + (n1[1] + n2[1]) * .7];
  });
  const segments = polygon.map((a, i) => ({ a, b: polygon[(i + 1) % polygon.length] }));
  // Four entrances at the ends of the central avenues, following the stepped boundary.
  const centre = [s.x, s.z];
  const gates = [[0,-1,'west'],[0,1,'east'],[1,-1,'north'],[1,1,'south']].map(([axis,side,direction]) => {
    const cross = 1-axis;
    const candidates = segments.map((edge, index) => ({ ...edge, index })).filter(e => e.a[axis] === e.b[axis] && (e.a[axis] - centre[axis]) * side > 0 && Math.min(e.a[cross], e.b[cross]) <= centre[cross] && Math.max(e.a[cross], e.b[cross]) >= centre[cross]);
    const edge = candidates.sort((a, b) => (b.a[axis] - a.a[axis]) * side)[0];
    const position = [...centre];
    position[axis] = edge.a[axis];
    position[cross] = Math.max(Math.min(edge.a[cross], edge.b[cross]) + 1, Math.min(Math.max(edge.a[cross], edge.b[cross]) - 1, centre[cross]));
    return { x: position[0], z: position[1], edge: edge.index, side, axis, direction };
  });
  return { polygon, segments, gates };
}

export function cityWallPieces(s) {
  const { segments, gates } = cityBoundary(s), pieces = [];
  segments.forEach(({ a, b }, edge) => {
    const length = Math.hypot(b[0]-a[0], b[1]-a[1]);
    const dx = (b[0]-a[0])/length, dz = (b[1]-a[1])/length;
    const gate = gates.find(g => g.edge === edge);
    const gateAt = gate ? Math.hypot(gate.x-a[0], gate.z-a[1]) : null;
    const spans = gate ? [[0, gateAt-.85, false], [gateAt-.85, gateAt+.85, true], [gateAt+.85, length, false]] : [[0, length, false]];
    for (const [from, to, isGate] of spans) {
      const count = isGate ? 1 : Math.ceil((to-from)/1.2);
      for (let i = 0; i < count; i++) {
        const width = (to-from)/count, t = from + (i+.5)*width;
        pieces.push({ x: a[0]+dx*t, z: a[1]+dz*t, rotationY: Math.atan2(dz, -dx), width: width + .04, isGate });
      }
    }
  });
  return pieces;
}

export function cityStreets(s) {
  const edges = new Map();
  const add = (x, z, xx, zz) => {
    const a = [x, z], b = [xx, zz];
    const key = [a.join(','), b.join(',')].sort().join('|');
    edges.set(key, [[s.x + x * CITY_BLOCK, s.z + z * CITY_BLOCK], [s.x + xx * CITY_BLOCK, s.z + zz * CITY_BLOCK]]);
  };
  for (const h of [...s.houses, ...(s.farms || [])]) {
    if (!h.gridPlot) continue;
    const col = Math.round((h.x - s.x) / CITY_BLOCK - .5);
    const row = Math.round((h.z - s.z) / CITY_BLOCK - .5);
    add(col, row, col + 1, row); add(col, row + 1, col + 1, row + 1);
    add(col, row, col, row + 1); add(col + 1, row, col + 1, row + 1);
    // Spine connections remain connected even when terrain rejects an intervening plot.
    for (let x = Math.min(0, col); x < Math.max(0, col); x++) add(x, 0, x + 1, 0);
    for (let z = Math.min(0, row); z < Math.max(0, row); z++) add(col, z, col, z + 1);
  }
  if (s.houses.some(h => h.gridPlot)) {
    for (const gate of cityBoundary(s).gates) {
      const blocks = Math.round((Math.abs(gate.axis === 0 ? gate.x-s.x : gate.z-s.z)-.7)/CITY_BLOCK);
      for (let i = 0; i < blocks; i++) {
        if (gate.axis === 0) add(gate.side*i, 0, gate.side*(i+1), 0);
        else add(0, gate.side*i, 0, gate.side*(i+1));
      }
      const end = [s.x, s.z], bend = [s.x, s.z];
      end[gate.axis] += gate.side*blocks*CITY_BLOCK;
      bend[gate.axis] = gate.axis === 0 ? gate.x : gate.z;
      edges.set(`gate-${gate.direction}`, [end, bend, [gate.x,gate.z]]);
    }
  }
  return [...edges.values()];
}

// One shared draw call for gardens, fences, market stalls and the village well.
export function cityDetails(world, settlements) {
  const parts = [];
  const box = (x, z, w, h, d, color, lift = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.translate(x, world.heightAtWorld(x, z) + h / 2 + lift, z);
    const c = new THREE.Color(color), colors = [];
    for (let i = 0; i < g.attributes.position.count; i++) colors.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    parts.push(g);
  };
  for (const s of settlements) {
    const homes = s.houses.filter(h => h.gridPlot);
    if (!homes.length) continue;
    box(s.x, s.z, 1.5, .09, 1.5, 0xb9afa0);
    box(s.x, s.z, .65, .38, .65, 0x929282, .09);
    box(s.x, s.z, .43, .025, .43, 0x51949b, .47);
    for (let i = 0; i < homes.length; i++) {
      const h = homes[i], side = h.z > s.z ? 1 : -1;
      // A planted rear yard, with low hedges that leave the street frontage open.
      box(h.x, h.z + side * 1.03, 2.15, .04, .64, i % 2 ? 0x71834c : 0x85965a, .025);
      box(h.x, h.z + side * 1.4, 2.45, .24, .12, 0x4e663c);
      if (i % 4 === 0) {
        // Produce stall: timber counter, four posts, alternating canvas panels.
        const x = h.x + 1.08, z = h.z;
        box(x, z, .55, .4, .8, 0x88623e);
        for (const dx of [-.25, .25]) for (const dz of [-.36, .36]) box(x + dx, z + dz, .045, .95, .045, 0x5f4931);
        for (let k = 0; k < 4; k++) box(x, z - .3 + k * .2, .72, .075, .2, k % 2 ? 0xeee0b6 : [0xae563e, 0x5f8593, 0xbd913e][i % 3], .95);
      } else if (i % 4 === 1) {
        box(h.x + 1.08, h.z, .55, .65, .75, 0x9c805c);
        box(h.x + 1.08, h.z, .68, .12, .88, 0x665d51, .65);
      } else {
        for (let k = 0; k < 3; k++) box(h.x - .7 + k * .65, h.z + side * 1.03, .3, .17, .3, i % 2 ? 0xc59b4c : 0x557940, .06);
      }
    }
  }
  const result = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  for (const part of parts) part.dispose();
  return result;
}
