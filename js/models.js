import * as THREE from 'three';
import { buildLowPolyCreature } from './low-poly-creatures.js';

function mat(color, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
  m.userData.base = m.color.clone();
  return m;
}

function mesh(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// ---------- Weapons (attached to the right hand of humanoid units in war) ----------
const SWORD_GEO = new THREE.BoxGeometry(0.06, 0.5, 0.06);
const SPEAR_SHAFT_GEO = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5);
const SPEAR_TIP_GEO = new THREE.ConeGeometry(0.05, 0.16, 5);
const BOW_GEO = new THREE.TorusGeometry(0.2, 0.022, 6, 8, Math.PI * 1.3);

export function attachWeapon(built, kind) {
  if (!built?.armR || built.weapon || built.isGltf) return null;
  const group = new THREE.Group();
  if (kind === 'bow') {
    const bow = mesh(BOW_GEO, mat(0x6b4a2c, { roughness: 0.85 }), 0, 0, 0);
    bow.rotation.z = Math.PI / 2 + 0.3;
    group.add(bow);
  } else if (kind === 'spear') {
    const shaft = mesh(SPEAR_SHAFT_GEO, mat(0x6b5a3f), 0, 0.15, 0);
    const tip = mesh(SPEAR_TIP_GEO, mat(0xd8dce2, { metalness: 0.6, roughness: 0.3 }), 0, 0.62, 0);
    group.add(shaft, tip);
  } else {
    const sword = mesh(SWORD_GEO, mat(0xc8ccd4, { metalness: 0.6, roughness: 0.35 }), 0, 0.22, 0);
    group.add(sword);
  }
  group.traverse(o => { if (o.isMesh) o.castShadow = false; });
  group.position.set(0, -0.36, 0.04);
  built.armR.add(group);
  built.weapon = group;
  return group;
}

export function detachWeapon(built) {
  if (!built?.weapon) return;
  built.armR.remove(built.weapon);
  built.weapon.traverse(o => { if (o.isMesh) o.material?.dispose?.(); });
  built.weapon = null;
}

const PALETTES = {
  herbivore: { kind: 'quad', body: 0xefe8d6, head: 0xefe8d6, legs: 0x3a3128, ear: 0xcbb98f },
  carnivore: { kind: 'quad', body: 0x6b5850, head: 0x6b5850, legs: 0x332722, ear: 0x4d3f39 },
  human: { kind: 'human', skin: 0xe0ab7c, tunic: 0xc96a3f, legs: 0x4a3524, hair: 0x4a3524 },
  orc: { kind: 'human', skin: 0x5c7a4a, tunic: 0x4a4034, legs: 0x2b2420, tusks: true },
  elf: { kind: 'human', skin: 0xf0d5b0, tunic: 0x3f8f5f, legs: 0x3e5c4a, hair: 0xe8d477, ears: 'pointed' },
  dwarf: { kind: 'human', skin: 0xd9a878, tunic: 0xa5622b, legs: 0x3a2c1e, beard: 0xc9c2b0, helmet: 0x8a8a92 },
  zombie: { kind: 'human', skin: 0x7d9270, tunic: 0x5a6b4a, legs: 0x3a3a2e },
  fish: { kind: 'fish', body: 0x5f9fc4, fin: 0xdcefff },
  boar: { kind: 'quad', body: 0x754b32, head: 0x68412b, legs: 0x3a281f, ear: 0x512f25 },
  bear: { kind: 'quad', body: 0x49382d, head: 0x3e3027, legs: 0x2b211c, ear: 0x34271f },
  dragon: { kind: 'quad', body: 0xaa2d24, head: 0x7d1f1a, legs: 0x561713, ear: 0xe0a34d },
  demon: { kind: 'human', skin: 0x8f2330, tunic: 0x2a1820, legs: 0x171218, tusks: true },
  skeleton: { kind: 'human', skin: 0xd4cfb9, tunic: 0x6b6252, legs: 0x423d35 },
  mage: { kind: 'human', skin: 0xd7b08a, tunic: 0x4169b1, legs: 0x242b46, hair: 0xdad7cf },
  fairy: { kind: 'human', skin: 0xffcfdf, tunic: 0xff72c7, legs: 0xa84892, hair: 0xfff0a8, ears: 'pointed' },
  ghost: { kind: 'human', skin: 0xa9dbe5, tunic: 0x79afbd, legs: 0x5b8994 },
  alien: { kind: 'human', skin: 0x73d66d, tunic: 0x35445c, legs: 0x20293a },
};

// Models are generated synchronously; retained exports keep session startup compatible.
export function preloadCreatureModels() {}
export function creatureAssetReady() { return false; }
export function buildCreatureModel(type, sex) {
  return buildLowPolyCreature(type, PALETTES[type] || PALETTES.human, sex);
}
