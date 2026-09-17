import { lowestSupport } from './ground-support.js';
import * as THREE from 'three';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

// Cosmetic only: deterministic placement never consumes the simulation RNG.
const profiles = {
  ocean: [0x697e79, 'stone', 0x899990], beach: [0xb6a38a, 'twig', 0x9d896b],
  grassland: [0x929184, 'litter', 0x939d58], meadow: [0x9a9987, 'litter', 0xb4ac65],
  forest: [0x7a8572, 'twig', 0x79563a], autumn: [0x93826a, 'litter', 0xbd763b],
  jungle: [0x617c62, 'fern', 0x488749], swamp: [0x617266, 'reed', 0x81854b],
  desert: [0xb89c76, 'scrub', 0xa38b53], savanna: [0xa79973, 'scrub', 0x9a9958],
  tundra: [0x9da6a3, 'scrub', 0x89917b], alpine: [0xa1a5a6, 'stone', 0xc1c5c2],
  volcanic: [0x514b49, 'stone', 0x716059],
};
function hash(x, z, salt) {
  let h = Math.imul(x + salt, 374761393) ^ Math.imul(z + salt, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function geometry(kind) {
  if (kind === 'stone') { const g = new THREE.IcosahedronGeometry(1, 0); g.scale(.13, .065, .10); g.translate(0, .025, 0); return g; }
  const parts = [];
  if (kind === 'twig') {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.CylinderGeometry(.008, .016, i ? .18 : .48, 4);
      g.rotateZ(i ? 1.0 : Math.PI / 2); g.rotateY(i * 1.3); g.translate(i * .055, .025, 0); parts.push(g);
    }
  } else {
    const p = [];
    const n = kind === 'reed' ? 6 : kind === 'fern' ? 12 : 8;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, x = Math.cos(a), z = Math.sin(a);
      const height = kind === 'litter' ? .015 : kind === 'reed' ? .24 + i * .017 : .09 + (i % 3) * .025;
      const r = kind === 'reed' ? .055 : .15 + (i % 3) * .025;
      p.push(x * .03 - .018, .009, z * .03, x * .03 + .018, .009, z * .03, x * r, height, z * r);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
  }
  const g = mergeGeometries(parts); parts.forEach(p => p.dispose()); return g;
}

export class GroundDetails {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group(); this.group.name = 'Biome ground details'; world.group.add(this.group);
    this.geometries = new Map(); this.meshes = [];
    this.material = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });
  }
  rebuild() {
    for (const mesh of this.meshes) mesh.dispose();
    this.group.clear(); this.meshes = [];
    const w = this.world, buckets = new Map();
    let seed = 17; for (const ch of String(w.seed)) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) | 0;
    const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3(), color = new THREE.Color();
    for (let z = 1; z < w.size; z++) for (let x = 1; x < w.size; x++) {
      const i = w.idx(x, z);
      if (w.settlementGround[i] || w._roadGrassMask?.[i] || w.burnt[i] || w.lava[i] || w.ice[i]) continue;
      // Keep decorations out of the full width of roads and building clearances.
      if ([[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dz]) => w.settlementGround[w.idx(x+dx,z+dz)] || w._roadGrassMask?.[w.idx(x+dx,z+dz)])) continue;
      const profile = profiles[w.biomeIdAt(x, z)] || profiles.grassland;
      const wet = w.isWater(x, z);
      if (wet && w.biomeIdAt(x, z) !== 'ocean') continue;
      const chance = hash(x, z, seed);
      if (chance > .30 * Math.min(1, w.graphics.vegetation)) continue;
      const kind = chance < .19 || wet ? 'stone' : profile[1];
      const [wx, wz] = w.gridToWorld(x, z);
      const px = wx + (hash(x,z,seed+1)-.5)*.65, pz = wz + (hash(x,z,seed+2)-.5)*.65;
      const py = w.heightAtWorld(px, pz);
      normal.set(w.heightAtWorld(px-.1,pz)-w.heightAtWorld(px+.1,pz), .2, w.heightAtWorld(px,pz-.1)-w.heightAtWorld(px,pz+.1)).normalize();
      if (normal.y < .65) continue;
      q.setFromUnitVectors(up, normal); yaw.setFromAxisAngle(up, hash(x,z,seed+3)*Math.PI*2); q.multiply(yaw);
      const bank = !wet && [[2,0],[-2,0],[0,2],[0,-2]].some(([dx,dz]) => w.inBounds(x+dx,z+dz) && w.isWater(x+dx,z+dz));
      const rocky = ['alpine', 'volcanic'].includes(w.biomeIdAt(x,z));
      const size = (.65 + hash(x,z,seed+4)*1.1) * (kind === 'stone' && (bank || rocky) ? 2.8 : 1);
      matrix.compose(new THREE.Vector3(px, kind === 'stone' || kind === 'twig' ? lowestSupport(w, px, pz, (kind === 'stone' ? .13 : .24)*size) - .012 : py - .025, pz), q, new THREE.Vector3(size, size, size));
      color.set(kind === 'stone' ? profile[0] : profile[2]).multiplyScalar(.8+hash(x,z,seed+5)*.35);
      const key = `${kind}:${Math.floor(x/24)}:${Math.floor(z/24)}`;
      if (!buckets.has(key)) buckets.set(key, {kind, instances: []});
      buckets.get(key).instances.push({matrix: matrix.clone(), color: color.clone()});
    }
    for (const {kind, instances} of buckets.values()) {
      if (!this.geometries.has(kind)) this.geometries.set(kind, geometry(kind));
      const mesh = new THREE.InstancedMesh(this.geometries.get(kind), this.material, instances.length);
      instances.forEach((item, i) => { mesh.setMatrixAt(i, item.matrix); mesh.setColorAt(i, item.color); });
      mesh.receiveShadow = true; mesh.computeBoundingSphere();
      this.group.add(mesh); this.meshes.push(mesh);
    }
  }
  update(camera) {
    if (!camera) return;
    const radius = this.world.graphics.quality === 'ultra' ? 65 : 48;
    for (const mesh of this.meshes) mesh.visible = camera.position.distanceTo(mesh.boundingSphere.center) < radius + mesh.boundingSphere.radius;
  }
  dispose() {
    for (const mesh of this.meshes) mesh.dispose();
    for (const g of this.geometries.values()) g.dispose();
    this.material.dispose(); this.group.clear(); this.world.group.remove(this.group);
  }
}
