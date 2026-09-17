import * as THREE from 'three';

// Converts a THREE.SkinnedMesh, frozen at whatever pose its skeleton is currently in, into a
// plain THREE.Mesh with that pose baked directly into its vertex positions — no skeleton, no
// skinIndex/skinWeight attributes, no per-frame bone-matrix work. For a model with hundreds of
// bones and no animation clips to ever play (see human_malefemale_basemesh_rigged.glb in
// models.js), keeping it as a live SkinnedMesh would mean every instance drags its entire bone
// hierarchy through updateMatrixWorld() every frame for a pose that never changes — pure waste.
// getVertexPosition() (SkinnedMesh.applyBoneTransform under the hood) already returns each
// vertex in the mesh's own local space exactly as a plain, unskinned Mesh would store it, so the
// new geometry can carry the original UV/normal attributes unmodified and only replace position.
export function bakeSkinnedMeshToStatic(skinnedMesh) {
  const srcGeo = skinnedMesh.geometry;
  const count = srcGeo.attributes.position.count;
  const positions = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    skinnedMesh.getVertexPosition(i, v);
    positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (srcGeo.attributes.normal) geo.setAttribute('normal', srcGeo.attributes.normal.clone());
  if (srcGeo.attributes.uv) geo.setAttribute('uv', srcGeo.attributes.uv.clone());
  if (srcGeo.index) geo.setIndex(srcGeo.index.clone());
  const mesh = new THREE.Mesh(geo, skinnedMesh.material);
  mesh.matrix.copy(skinnedMesh.matrixWorld);
  mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.castShadow = true;
  return mesh;
}

// Same idea as fitToHeight below, but bakes the scale/centering directly into a mesh's own
// BufferGeometry instead of wrapping it in a positioned Group — for a real asset that has to
// become raw InstancedMesh geometry (many cheap instances sharing one draw call, e.g. houses in
// settlements.js) rather than an individually-cloned Object3D. Returns a new, independent
// geometry; the source mesh/geometry is left untouched.
export function fitGeometryToHeight(mesh, targetHeight) {
  const geo = mesh.geometry.clone();
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox.getSize(size);
  const scale = targetHeight / (size.y || 1);
  geo.scale(scale, scale, scale);
  geo.computeBoundingBox();
  const center = new THREE.Vector3();
  geo.boundingBox.getCenter(center);
  geo.translate(-center.x, -geo.boundingBox.min.y, -center.z);
  return geo;
}

// Centers `object` on X/Z and drops it so its lowest point sits at local y=0, then scales it to
// `targetHeight` tall — lets a downloaded .glb of whatever original size/pivot its artist used
// drop into the same slot a hand-built (procedural) model would, without per-model tuning.
// Shared by models.js (creatures), ships.js and settlements.js (buildings) — anywhere a real
// asset replaces primitive geometry built to a known in-game size.
export function fitToHeight(object, targetHeight) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetHeight / (size.y || 1);
  const wrapper = new THREE.Group();
  object.scale.setScalar(scale);
  wrapper.add(object);
  wrapper.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(wrapper);
  object.position.x -= (fitted.min.x + fitted.max.x) / 2;
  object.position.y -= fitted.min.y;
  object.position.z -= (fitted.min.z + fitted.max.z) / 2;
  return wrapper;
}
