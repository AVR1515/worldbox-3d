import * as THREE from 'three';

const lodCache = new Map();
const lodUrls = {
  tree_001: new URL('../assets/tree-lods/tree_001.json', import.meta.url).href,
  fir_001: new URL('../assets/tree-lods/fir_001.json', import.meta.url).href,
};
export function loadTreeLods(file, height) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  if (!lodCache.has(file)) {
    lodCache.set(file, fetch(lodUrls[file]).then(response => {
      if (!response.ok) throw new Error(`Tree LOD HTTP ${response.status}`);
      return response.json();
    }).then(data => data.map(level => new THREE.BufferGeometryLoader().parse(level))).catch(error => {
      console.warn('Tree LOD unavailable; retaining full geometry.', error);
      return null;
    }));
  }
  return lodCache.get(file).then(levels => levels?.map(source => {
    const geometry = source.clone();
    // All offline levels share the full model's unit-height transform.
    geometry.scale(height, height, height);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return geometry;
  }) ?? null);
}

// Logical slots stay compact in World. Spatial batches only change representation;
// Three.js tests each batch independently against the view and shadow frusta.
export class TreeRenderer {
  constructor(world, { sectorSize = 48 } = {}) {
    this.world = world;
    this.sectorSize = sectorSize;
    this.group = new THREE.Group();
    this.group.name = 'Tree sectors';
    world.group.add(this.group);
    this.batches = new Map();
    this.revision = -1;
    this.cameraPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
    this.matrix = new THREE.Matrix4();
    this.point = new THREE.Vector3();
    this.boundPoint = new THREE.Vector3();
    this.stats = { active: 0, full: 0, medium: 0, far: 0, batches: 0, triangles: 0 };
  }

  update(camera) {
    const world = this.world;
    // Visibility/shadow controls may change without a tree or camera transform.
    for (const batch of this.batches.values()) {
      const source = world.treeMeshes[batch.kind].trunk;
      batch.mesh.castShadow = source.castShadow;
      batch.mesh.receiveShadow = source.receiveShadow;
    }
    const changed = this.revision !== world._treeVisualRevision;
    const projectionKey = `${camera.fov}:${camera.zoom}:${camera.userData.viewportHeight || 1080}:${world.graphics.vegetation}`;
    const moved = this.cameraPosition.distanceToSquared(camera.position) > .25 || this.projectionKey !== projectionKey;
    if (!changed && !moved) return;
    this.cameraPosition.copy(camera.position);
    this.projectionKey = projectionKey;
    if (changed) {
      for (const batch of this.batches.values()) batch.cells.length = 0;
      for (const [cell, rec] of world.treeSlots) {
        const x = cell % world.verts, z = Math.floor(cell / world.verts);
        const key = `${rec.kind}:${Math.floor(x / this.sectorSize)}:${Math.floor(z / this.sectorSize)}`;
        let batch = this.batches.get(key);
        if (!batch) {
          batch = { kind: rec.kind, cells: [], mesh: null, level: -1, bounds: new THREE.Box3(), sphere: new THREE.Sphere() };
          this.batches.set(key, batch);
        }
        batch.cells.push(cell);
      }
    }
    const stats = { active: world.treeSlots.size, full: 0, medium: 0, far: 0, batches: 0, triangles: 0 };
    for (const [key, batch] of this.batches) {
      if (!batch.cells.length) {
        this.group.remove(batch.mesh); batch.mesh?.dispose(); this.batches.delete(key); continue;
      }
      const source = world.treeMeshes[batch.kind];
      if (!batch.mesh || batch.mesh.instanceMatrix.count < batch.cells.length) {
        this.group.remove(batch.mesh); batch.mesh?.dispose();
        batch.mesh = new THREE.InstancedMesh(source.trunk.geometry, source.trunk.material, Math.ceil(batch.cells.length / 32) * 32);
        batch.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        batch.mesh.customDepthMaterial = source.trunk.customDepthMaterial;
        batch.mesh.name = `Trees ${key}`;
        this.group.add(batch.mesh);
      }
      const mesh = batch.mesh;
      if (changed) {
        batch.bounds.makeEmpty();
        let index = 0;
        for (const cell of batch.cells) {
          const rec = world.treeSlots.get(cell);
          source.trunk.getMatrixAt(rec.slot, this.matrix);
          mesh.setMatrixAt(index++, this.matrix);
          // Conservative bound includes full model and the wind displacement.
          this.point.setFromMatrixPosition(this.matrix);
          const radius = 5 * this.matrix.getMaxScaleOnAxis();
          batch.bounds.expandByPoint(this.boundPoint.copy(this.point).addScalar(radius));
          batch.bounds.expandByPoint(this.boundPoint.copy(this.point).addScalar(-radius));
        }
        batch.bounds.getBoundingSphere(batch.sphere);
        mesh.boundingSphere = batch.sphere.clone();
        mesh.boundingBox = batch.bounds.clone();
        mesh.count = batch.cells.length;
        mesh.instanceMatrix.needsUpdate = true;
      }
      const distance = Math.max(1, camera.position.distanceTo(batch.sphere.center) - batch.sphere.radius);
      const projected = 3.2 * (camera.userData.viewportHeight || 1080) * camera.zoom /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance) * (.65 + world.graphics.vegetation * .7);
      // Hysteresis avoids repeated switches near either projected-size threshold.
      const near = batch.level === 0 ? 54 : 66;
      const far = batch.level === 2 ? 23 : 19;
      const level = projected >= near ? 0 : projected >= far ? 1 : 2;
      mesh.geometry = level === 0 ? source.trunk.geometry : source.lods[level - 1];
      mesh.castShadow = source.trunk.castShadow;
      mesh.receiveShadow = source.trunk.receiveShadow;
      batch.level = level;
      stats[['full', 'medium', 'far'][level]] += mesh.count;
      stats.batches++;
      stats.triangles += mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    }
    this.stats = stats;
    this.revision = world._treeVisualRevision;
  }

  dispose() {
    for (const { mesh } of this.batches.values()) mesh?.dispose();
    this.batches.clear(); this.group.clear(); this.world.group.remove(this.group);
  }
}
