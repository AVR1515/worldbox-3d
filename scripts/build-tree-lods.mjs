// Offline asset preparation; never run mesh simplification during gameplay.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { SimplifyModifier } from '../node_modules/three/examples/jsm/modifiers/SimplifyModifier.js';

const root = new URL('../assets/packs/village-props/Separate_assets_glb/', import.meta.url);
const output = new URL('../assets/tree-lods/', import.meta.url);
await mkdir(output, { recursive: true });
for (const file of ['tree_001', 'fir_001']) {
  const data = await readFile(new URL(`${file}.glb`, root));
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  const binStart = 20 + jsonLength + 8;
  const primitive = gltf.meshes[0].primitives[0];
  const geometry = new THREE.BufferGeometry();
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const types = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  function attribute(index) {
    const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView], Type = types[a.componentType];
    if (!Type || view.byteStride || a.sparse) throw new Error('Unsupported GLB accessor');
    const start = binStart + (view.byteOffset || 0) + (a.byteOffset || 0);
    const bytes = data.subarray(start, start + a.count * components[a.type] * Type.BYTES_PER_ELEMENT);
    return new THREE.BufferAttribute(new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)), components[a.type]);
  }
  for (const [key, name] of [['POSITION', 'position'], ['NORMAL', 'normal'], ['TEXCOORD_0', 'uv']]) {
    if (primitive.attributes[key] != null) geometry.setAttribute(name, attribute(primitive.attributes[key]));
  }
  geometry.setIndex(attribute(primitive.indices));
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox, center = bounds.getCenter(new THREE.Vector3());
  const scale = 1 / (bounds.max.y - bounds.min.y);
  geometry.translate(-center.x, -bounds.min.y, -center.z);
  geometry.scale(scale, scale, scale);
  const levels = [];
  for (const target of [300, 100]) {
    let low = 0, high = geometry.attributes.position.count - 1, best = null;
    while (low <= high) {
      const remove = Math.floor((low + high) / 2);
      const result = new SimplifyModifier().modify(geometry, remove);
      const triangles = result.index.count / 3;
      if (triangles > target) { low = remove + 1; result.dispose(); }
      else { best?.dispose(); best = result; high = remove - 1; }
    }
    if (!best || !best.index.count) throw new Error(`Invalid LOD for ${file}`);
    best.computeBoundingBox(); best.computeBoundingSphere();
    const json = best.toJSON();
    delete json.uuid;
    levels.push(json);
    console.log(`${file}: ${best.index.count / 3} triangles`);
    best.dispose();
  }
  await writeFile(new URL(`${file}.json`, output), JSON.stringify(levels));
  geometry.dispose();
}
