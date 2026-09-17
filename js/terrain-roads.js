import * as THREE from 'three';
import { planRiverBridges, bridgeHeightAt } from './river-bridges.js';

export const ROAD_LIFT = 0.018;

// Clip a polygon without losing the height interpolated on its terrain triangle.
function clip(polygon, distance) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = distance(a), db = distance(b);
    if (da >= -1e-8) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

// Project each footprint onto the SAME triangles as World.buildTerrainMesh().
// Unlike an endpoint-height ribbon, this cannot cut through a ridge or span a dip.
export function buildTerrainRoad(world, nodes, width = 0.65, elevation = null, bridges = planRiverBridges(world, nodes, width)) {
  const positions = [], uvs = [];
  let traveled = 0;
  const offsets = nodes.map((p, i) => {
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(nodes.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    const variation = 1 + Math.sin(p[0] * 1.7 + p[1] * 1.1) * 0.07;
    return [dz / length * width * 0.5 * variation, -dx / length * width * 0.5 * variation];
  });
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1], b = nodes[k], oa = offsets[k - 1], ob = offsets[k];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const quad = [[a[0] - oa[0], a[1] - oa[1]], [a[0] + oa[0], a[1] + oa[1]], [b[0] + ob[0], b[1] + ob[1]], [b[0] - ob[0], b[1] - ob[1]]];
    // Use consistently counterclockwise footprints in the X/Z plane.
    const area = quad.reduce((sum, p, i) => sum + p[0] * quad[(i + 1) % 4][1] - p[1] * quad[(i + 1) % 4][0], 0);
    if (area < 0) quad.reverse();
    const minX = Math.max(0, Math.floor(Math.min(...quad.map(p => p[0])) + world.half));
    const maxX = Math.min(world.size - 1, Math.floor(Math.max(...quad.map(p => p[0])) + world.half));
    const minZ = Math.max(0, Math.floor(Math.min(...quad.map(p => p[1])) + world.half));
    const maxZ = Math.min(world.size - 1, Math.floor(Math.max(...quad.map(p => p[1])) + world.half));
    const vertex = (x, z) => {
      const wx = x - world.half, wz = z - world.half;
      const deck = bridgeHeightAt(bridges, wx, wz, 1.5);
      const i = world.idx(x, z);
      const dry = deck != null || !world.riverMask?.[i] ? .05 : world.height[i] - world.riverHeight[i];
      return [wx, deck != null ? deck - .14 : elevation ? elevation(wx, wz).y : world.height[i] + ROAD_LIFT, wz, dry];
    };
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const va = vertex(x, z), vb = vertex(x + 1, z), vc = vertex(x, z + 1), vd = vertex(x + 1, z + 1);
      for (const triangle of [[va, vb, vc], [vb, vd, vc]]) {
        let polygon = triangle;
        for (let edge = 0; edge < 4 && polygon.length; edge++) {
          const p = quad[edge], q = quad[(edge + 1) % 4];
          polygon = clip(polygon, v => (q[0] - p[0]) * (v[2] - p[1]) - (q[1] - p[1]) * (v[0] - p[0]));
        }
        polygon = clip(polygon, v => v[1] - 5.04);
        polygon = clip(polygon, v => v[3]);
        for (let i = 1; i < polygon.length - 1; i++) {
          // Reverse winding in X/Z for upward-facing triangles in 3D.
          for (const v of [polygon[0], polygon[i + 1], polygon[i]]) {
            positions.push(v[0], v[1], v[2]);
            uvs.push(0.5 + ((v[0] - a[0]) * dz - (v[2] - a[1]) * dx) / (length * width), traveled + ((v[0] - a[0]) * dx + (v[2] - a[1]) * dz) / length);
          }
        }
      }
    }
    traveled += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.userData.bridges = bridges.filter(bridge => bridge.points.some(p => nodes.some((a,i) => {
    if(!i)return false; const b=nodes[i-1], dx=a[0]-b[0], dz=a[1]-b[1], l2=dx*dx+dz*dz;
    const t=((p.x-b[0])*dx+(p.z-b[1])*dz)/(l2||1);
    return t>=0 && t<=1 && Math.hypot(p.x-b[0]-t*dx,p.z-b[1]-t*dz)<.2;
  })));
  return geometry;
}

export function mergeRoads(geometries) {
  const result = new THREE.BufferGeometry();
  for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const sources = geometries.map(g => g.getAttribute(name).array);
    const data = new Float32Array(sources.reduce((n, a) => n + a.length, 0));
    let offset = 0;
    for (const source of sources) { data.set(source, offset); offset += source.length; }
    result.setAttribute(name, new THREE.BufferAttribute(data, size));
  }
  return result;
}

export function createRoadMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xa48d69, roughness: 1, metalness: 0, envMapIntensity: 0.3,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    depthWrite: false,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoadUv;\nvarying vec2 vRoadWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoadUv = uv; vRoadWorld = position.xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vRoadUv; varying vec2 vRoadWorld;
      float roadHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float roadNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(roadHash(i), roadHash(i+vec2(1,0)),f.x),mix(roadHash(i+vec2(0,1)),roadHash(i+vec2(1,1)),f.x),f.y);
      }`).replace('#include <color_fragment>', `#include <color_fragment>
      float grain = roadNoise(vRoadWorld * 32.0);
      float mottling = roadNoise(vRoadWorld * 4.0);
      float edge = abs(vRoadUv.x - 0.5) * 2.0;
      float shoulder = smoothstep(0.68, 1.02, edge + (roadNoise(vRoadWorld * 9.0)-0.5)*0.12);
      if (roadHash(floor(vRoadWorld * 180.0)) < shoulder) discard;
      float ruts = exp(-pow((abs(vRoadUv.x - 0.5) - 0.22) * 19.0, 2.0));
      diffuseColor.rgb *= 0.90 + mottling * 0.16 + grain * 0.09 - ruts * 0.075;
      float pebbles = step(0.88, roadHash(floor(vRoadWorld * 24.0))) * (1.0 - smoothstep(0.15, 0.38, length(fract(vRoadWorld * 24.0) - 0.5)));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.20, 0.18, 0.14), pebbles * 0.45);
    `);
  };
  return material;
}
