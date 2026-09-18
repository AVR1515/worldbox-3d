import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared, vertex-coloured botanical silhouettes, with genuinely cheaper distant levels.
export function createTreeGeometry(kind, level = 0) {
  const parts = [];
  const add = (geometry, color, x, y, z, sx = 1, sy = 1, sz = 1) => {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    g.deleteAttribute('uv');
    g.scale(sx, sy, sz); g.translate(x, y, z);
    const c = new THREE.Color(color), colors = [];
    for (let i = 0; i < g.attributes.position.count; i++) colors.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); parts.push(g);
  };
  const branch = (a, b, radius, color) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    const g = new THREE.CylinderGeometry(radius * .45, radius, delta.length(), level ? 4 : 8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    const mid = start.add(end).multiplyScalar(.5); add(g, color, mid.x, mid.y, mid.z);
  };
  const pine = kind === 'pine', dry = kind === 'dry', birch = kind === 'birch';
  const bark = birch ? 0xdad5bb : dry ? 0x806047 : 0x765039;
  branch([0, 0, 0], [.08, pine ? 3.7 : 2.9, 0], birch ? .095 : .17, bark);
  if (level === 0) {
    // A couple of thin root-flare branches near the base add silhouette detail only where
    // the camera is close enough (level 0 = full geometry) to actually notice it.
    branch([0, .05, 0], [.22, .55, .12], .05, bark);
    branch([0, .05, 0], [-.16, .45, -.1], .045, bark);
  }
  if (pine) {
    const tiers = level === 2 ? 4 : level === 1 ? 7 : 9;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, y = 1.05 + t * 2.7, reach = 1.05 * (1 - t * .8);
      const arms = level === 2 ? 3 : level === 1 ? 5 : 6;
      for (let j = 0; j < arms; j++) {
        const angle = j * Math.PI * 2 / arms + i * 1.7;
        const length = reach * (.7 + .3 * Math.sin(i * 7 + j * 3) ** 2);
        const x = Math.cos(angle) * length, z = Math.sin(angle) * length;
        if (level === 0) branch([0,y-.1,0], [x,y+.12,z], .028 * (1-t*.5), bark);
        add(new THREE.ConeGeometry(.39 * (1-t*.6), .65 * (1-t*.45), level ? 4 : 7), (i+j)%2 ? 0x4f7458 : 0x345641, x*.7, y+.12, z*.7, 1, .7, 1);
      }
    }
    add(new THREE.ConeGeometry(.22,.65,level ? 6 : 8), 0x577c5a, .04,3.72,0);
  } else {
    const palette = kind === 'autumn' ? [0xb65a2d, 0xdd8736, 0xeca948] : birch ? [0x759a45, 0x9cb65c, 0xb4c96a] : dry ? [0x7d9146, 0x9fa957, 0xb5b970] : [0x3d793e, 0x60954a, 0x83ad58];
    const n = level === 2 ? 4 : level === 1 ? 7 : 15;
    for (let i = 0; i < n; i++) {
      const angle = i * 2.39996, radius = i === 0 ? 0 : .6 + (i % 4) * .16;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const y = dry ? 2.65 + (i % 4) * .14 : 2.4 + (i % 5) * .26;
      if (level === 0) branch([0, 1.1 + (i % 3) * .24, 0], [x, y, z], .065, bark);
      add(new THREE.IcosahedronGeometry(1, level === 0 ? 1 : 0), palette[i % 3], x, y, z, birch ? .5 : .68, dry ? .28 : birch ? .8 : .62, birch ? .5 : .66);
    }
  }
  const result = mergeGeometries(parts); parts.forEach(g => g.dispose());
  result.computeBoundingBox(); result.computeBoundingSphere(); return result;
}

export function createGrassGeometry() {
  const p = [];
  for (let i = 0; i < 32; i++) {
    const a = i * 2.39996, r = .09 + Math.sqrt((i + .5) / 32) * .46;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = .055 + (i % 4) * .018, w = .018;
    p.push(x - w, 0, z, x + w, 0, z, x + Math.cos(a) * .055, h, z + Math.sin(a) * .055);
  }
  // Fine stem connects the flower head to the ground.
  p.push(.175, 0, .1, .185, 0, .1, .18, .095, .1);
  const colors = [];
  const green = new THREE.Color(0x83ad53);
  for (let i = 0; i < p.length / 3; i++) colors.push(green.r, green.g, green.b);
  // A few small wildflowers amongst the blades; no textures or extra draw calls.
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, b = a + .8;
    p.push(.18, .09, .1, .18 + Math.cos(a) * .035, .10, .1 + Math.sin(a) * .035, .18 + Math.cos(b) * .035, .10, .1 + Math.sin(b) * .035);
    const c = new THREE.Color(0xeee1ac); for (let j = 0; j < 3; j++) colors.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); g.computeVertexNormals(); return g;
}
