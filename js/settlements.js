import { buildTerrainRoad, mergeRoads, createRoadMaterial } from './terrain-roads.js';
import { planRiverBridges, buildBridgeGeometry } from './river-bridges.js';
import { cityPlots, cityStreets, cityDetails, cityBoundary, cityWallPieces, createTownhouse, CITY_BLOCK } from './city-layout.js';
import { reuseRoadNetwork, roadEdgeKey, softenRoad, existingRoadPath } from './road-network.js';
import { cityRoadBounds, cityRoadAccess, outsideCities, exteriorRoad } from './city-roads.js';
import * as THREE from 'three';
import { CIVILIZED_TYPES } from './creatures.js';
import { CONFIG } from './world.js';
import { attachWeapon, detachWeapon } from './models.js';
import { SpatialIndex } from './core/spatial-index.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { fitGeometryToHeight } from './core/gltf-utils.js';

const FOUND_CLUSTER_RADIUS = 3;
const FOUND_MIN_MEMBERS = 3;
// Needs to clear TWICE the level-3 wall radius (~14.6 each), not just one of them — a pair of
// max-level neighbors each get their own ring, so the distance that matters is the sum of both
// radii, not either alone. The old value (22) only cleared a single radius, so two "Gran ciudad"
// neighbors at the minimum distance had their walls overlap by several units: part of one ring
// would sit visibly closer to the *other* city than to its own, reading as a stray wall segment
// that doesn't enclose anything (reported after real play, reproduced in
// tests/unit/wall-resize.test.js).
const MIN_SETTLEMENT_DIST = 32;
const EMPIRE_JOIN_DIST = 32;
const LEVEL_HOUSE_THRESHOLD = [1, 3, 7, 14];
// Exported so civilization-system.js can place production buildings on the same grid plots as
// houses/farms (see _rebuildBuildingVisuals()) instead of a circle independent of the city layout.
export const RADIUS_BY_LEVEL = [4, 6, 9, 13];
const LEVEL_NAMES = ['Aldea', 'Pueblo', 'Ciudad', 'Gran ciudad'];
const WALL_REPAIR = Object.freeze({ seconds: 60, wood: 15, stone: 30 });
// Lowered from 1800: reproduction is now capped by each settlement's own house count
// (see creatures.js _canReproducePair), so a handful of sprawling 1800-house cities was
// never a realistic scenario — this just wastes GPU on always-allocated instance slots.
const HOUSE_CAP = 900;

// ---------- Real house models ----------
// Each variant is its own standalone .glb (the pack used to ship as one combined scene —
// assets/packs/village-props/Fantasy_FREE.glb — but was later split apart into one file per prop
// under Separate_assets_glb/, which is what's actually on disk now). 'default' variants are
// regular houses; 'elf' variants are the pack's mushroom-cottage props. Neither is ever picked for
// a newly-built house any more (see addHouse(), which only rolls the urban townhouse variants
// below, for every race) — these seven stay here purely so an old save's already-placed houses
// still have a model to render.
// Unlike the mine (civilization-system.js), a settlement can have up to HOUSE_CAP (900) houses at
// once, so cloning each one individually the way the mine does isn't an option — that many
// separate draw calls would blow the <120 draw-call budget performance.spec.js checks. Each
// variant instead gets its own InstancedMesh, same as any other instanced building; a house
// starts on a small placeholder box geometry (so construction stays synchronous — GLTFLoader is
// async) and every existing instance of that variant updates automatically the moment its real
// geometry loads, since the swap happens on the shared InstancedMesh itself, not per-house. Each
// variant loads independently, so a slow file never blocks the others.
const HOUSE_REFERENCE_HEIGHT = 1.65; // adult human ~0.60; a cottage is nearly three people tall
const HOUSE_MODEL_DIR = './assets/packs/village-props/Separate_assets_glb/';
const HOUSE_VARIANTS = [
  { file: 'house_001', race: 'default' },
  { file: 'house_002', race: 'default' },
  { file: 'house_003', race: 'default' },
  { file: 'fabulous_mushroom_001', race: 'elf' },
  { file: 'fabulous_mushroom_002', race: 'elf' },
  { file: 'fabulous_mushroom_003', race: 'elf' },
  { file: 'fabulous_mushroom_004', race: 'elf' },
].map(v => ({ ...v, geometry: null, material: null, requested: false, readyCallbacks: [] }));
// Keep legacy variant indices stable for saved games; every race's new houses (elves included)
// come from these six timber-and-plaster homes now.
for (let i = 0; i < 6; i++) HOUSE_VARIANTS.push({
  race: 'default', urban: true, geometry: createTownhouse(i),
  material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }),
  requested: true, readyCallbacks: [],
});
const HOUSE_PLACEHOLDER_GEO = new THREE.BoxGeometry(0.95, 1.65, 0.95).translate(0, 0.825, 0);
const HOUSE_PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: 0xcdb896, roughness: 0.95 });
const houseLoader = new GLTFLoader();

function ensureHouseVariantRequested(variant, onReady) {
  if (variant.geometry) { onReady(variant.geometry, variant.material); return; }
  variant.readyCallbacks.push(onReady);
  // Vitest's unit-test environment is plain Node (no `document`/`window`), and Three's loaders
  // resolve relative URLs against `document.baseURI` — this guard keeps settlement unit tests on
  // the placeholder geometry instead of throwing, without affecting real browser play.
  if (variant.requested || typeof document === 'undefined' || typeof document.baseURI !== 'string') return;
  variant.requested = true;
  houseLoader.load(`${HOUSE_MODEL_DIR}${variant.file}.glb`, gltf => {
    const mesh = gltf.scene.getObjectByName(variant.file) || gltf.scene.children.find(o => o.isMesh);
    if (!mesh?.isMesh) return; // unexpected export shape — stays on the placeholder
    variant.geometry = fitGeometryToHeight(mesh, HOUSE_REFERENCE_HEIGHT);
    // Wide cottages must still fit the existing village plots and navigation footprint.
    variant.geometry.computeBoundingBox();
    const bounds = variant.geometry.boundingBox;
    const width = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
    if (width > 1.4) variant.geometry.scale(1.4 / width, 1, 1.4 / width);
    variant.material = mesh.material.clone();
    variant.material.roughness = 0.92;
    variant.material.envMapIntensity = 0.3;
    for (const callback of variant.readyCallbacks.splice(0)) callback(variant.geometry, variant.material);
  }, undefined, error => {
    console.warn(`No se pudo cargar el modelo 3D de la casa "${variant.file}" (${HOUSE_MODEL_DIR}${variant.file}.glb); se usará el modelo generado por código.`, error);
  });
}

function houseVariantIndicesFor(race) {
  const group = race === 'elf' ? 'elf' : 'default';
  const indices = [];
  for (let i = 0; i < HOUSE_VARIANTS.length; i++) if (HOUSE_VARIANTS[i].race === group) indices.push(i);
  return indices;
}

// Exported so main.js can call this when the map creator opens, same as models.js's
// preloadCreatureModels() and for the same reason: an eager top-level call here fires before
// tests/e2e/game.spec.js's "no requests before Jugar is visible" check runs.
export function preloadHouseModels() {
  for (const variant of HOUSE_VARIANTS) ensureHouseVariantRequested(variant, () => {});
}

// ---------- Real wall/tower models ----------
// low_poly_mega_assets_pack/ ships as 308 separated mesh-N.glb files with no names and no linked
// material/texture (flat grey, despite the pack including a Wall_baseColor.png that nothing was
// left wired to) — bounding-box triage (dz thin, dx/dy of a wall run vs. a squarish tall footprint
// for towers) plus a visual render pass identified these three as a matching set: 'mesh' is a
// crenellated straight wall run, 'mesh-1' the same run with a gate arch cut into it, 'mesh-3' a
// crenellated corner tower. Same recentring (fitGeometryToHeight) the house/mine models already
// needed, since every piece still carries its original position from the combined source scene.
const WALL_REFERENCE_HEIGHT = 1.5; // a defender should be able to see over it — see docs/GRAPHICS.md
const TOWER_REFERENCE_HEIGHT = 2.6; // taller than the wall and the 1.65-tall houses it watches over
const WALL_MODEL_DIR = './assets/packs/low_poly_mega_assets_pack/';
const WALL_TINT = 0x8f887a; // same stone tone the old procedural wall/tower already used
const WALL_PIECES = {
  segment: { file: 'mesh', height: WALL_REFERENCE_HEIGHT },
  gate: { file: 'mesh-1', height: WALL_REFERENCE_HEIGHT },
  tower: { file: 'mesh-3', height: TOWER_REFERENCE_HEIGHT },
};
for (const piece of Object.values(WALL_PIECES)) Object.assign(piece, { geometry: null, material: null, requested: false, readyCallbacks: [] });
const wallLoader = new GLTFLoader();

function ensureWallPieceRequested(piece, onReady) {
  if (piece.geometry) { onReady(piece.geometry, piece.material); return; }
  piece.readyCallbacks.push(onReady);
  if (piece.requested || typeof document === 'undefined' || typeof document.baseURI !== 'string') return;
  piece.requested = true;
  wallLoader.load(`${WALL_MODEL_DIR}${piece.file}.glb`, gltf => {
    const mesh = gltf.scene.getObjectByName(piece.file) || gltf.scene.children.find(o => o.isMesh);
    if (!mesh?.isMesh) return; // unexpected export shape — stays on the placeholder
    piece.geometry = fitGeometryToHeight(mesh, piece.height);
    // The pack left every piece on a flat, textureless grey material — tint by hand instead.
    piece.material = new THREE.MeshStandardMaterial({ color: WALL_TINT, roughness: 0.93 });
    for (const callback of piece.readyCallbacks.splice(0)) callback(piece.geometry, piece.material);
  }, undefined, error => {
    console.warn(`No se pudo cargar el modelo 3D de la muralla "${piece.file}" (${WALL_MODEL_DIR}${piece.file}.glb); se usará el modelo generado por código.`, error);
  });
}

// Exported for the same reason as preloadHouseModels(): fires the asset request as early as the
// map creator opens, well before any settlement can actually grow to TOWER_MIN_LEVEL/WALL_MIN_LEVEL
// and need it.
export function preloadWallModels() {
  for (const piece of Object.values(WALL_PIECES)) ensureWallPieceRequested(piece, () => {});
}

const PATH_SEGMENTS = 12;
const UPDATE_INTERVAL = 1.4;
const DIPLO_INTERVAL = 3.5;
const WAR_TENSION_THRESHOLD = 65;
const WAR_DECLARE_CHANCE = 0.16;
const SOLDIER_RAISE_CHANCE = 0.35;
const PEACE_CHANCE_BASE = 0.05;
const CAPTURE_RANGE = 6;
const LOYALTY_DECAY_BASE = 0.5;
const FARM_CAP = 400;
// Same reasoning as HOUSE_CAP: a global instance pool shared by every settlement's wall, sized
// generously rather than per-settlement. A max-level ("Gran ciudad") ring is ~70 segments; HOUSE_CAP
// (900) bounds how many such cities can even exist (14+ houses needed for that level), so this
// comfortably covers more walled cities than the house budget could ever produce.
const WALL_SEGMENT_CAP = 4500;
const WALL_GATE_CAP = 256;
const MAX_FARMS_PER_SETTLEMENT = 2;
// Basic timber homes must not depend on finding a stone deposit. Stone is required
// for upgrades and civic buildings, after the village can sustain its population.
const HOUSE_COST = { wood: 10, stone: 0 };
const FARM_COST = { wood: 6, stone: 2 };
export const RESOURCE_CAP_BASE = 150;
const ECONOMIC_ROLES = ['Aldeano', 'Leñador', 'Agricultor', 'Constructor', 'Minero'];
const ECONOMIC_ROLE_WEIGHTS = [0.26, 0.19, 0.19, 0.18, 0.18];
const LUMBERJACK_CAP_BASE = 2;
const HOUSE_UPGRADE_COST = { gold: 35, stone: 12 };
const TOWER_MIN_LEVEL = 2;
const WALL_MIN_LEVEL = 3;
const MASTERWORK_GEM_COST = 2;
// Territory grid now matches the terrain grid 1:1 (step = 1 world unit) so vertex
// heights are read directly from the heightmap instead of re-interpolated — that
// mismatch was what let the overlay dip below the surface on slopes.
const TERRITORY_STEP = 1;
const TERRITORY_BASE_RADIUS = 7;
const TERRITORY_PER_HOUSE = 1.15;
const TERRITORY_MAX_RADIUS = 30;
const TERRITORY_ALPHA = 0.5;
const TERRITORY_BORDER_LIFT = 0.62;
const SAVE_VERSION = 1;

const NAME_PRE = ['Val', 'Rio', 'Puerto', 'Alto', 'Santa', 'Monte', 'Bella', 'Los', 'Playa', 'Nueva'];
const NAME_SUF = ['vista', 'mar', 'dorado', 'sol', 'luz', 'piedra', 'viento', 'norte', 'sur', 'flor'];
const EMPIRE_SYL1 = ['Val', 'Kor', 'Aer', 'Sil', 'Dun', 'Mor', 'Bel', 'Tar', 'Nor', 'Cal'];
const EMPIRE_SYL2 = ['an', 'or', 'ith', 'wyn', 'dor', 'ric', 'mar', 'lan', 'vor', 'eth'];
const EMPIRE_TITLE = ['Reino', 'Imperio', 'Dominio', 'Confederación'];

function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// Arc-length helpers for walking a trade route's [x,z] node polyline at a 0..1 progress value —
// used by merchant caravans so they follow the actual road (curves, terrain-hugging detours and
// all) instead of a straight chord between the two capitals, which used to cut across water,
// hills and buildings in between.
function nodesLength(nodes) {
  let total = 0;
  for (let i = 1; i < nodes.length; i++) total += Math.hypot(nodes[i][0] - nodes[i - 1][0], nodes[i][1] - nodes[i - 1][1]);
  return total;
}
function sampleNodes(nodes, progress) {
  if (!nodes?.length) return { x: 0, z: 0, heading: 0 };
  if (nodes.length === 1) return { x: nodes[0][0], z: nodes[0][1], heading: 0 };
  const total = nodesLength(nodes) || 1;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < nodes.length; i++) {
    const [fx, fz] = nodes[i - 1], [tx, tz] = nodes[i];
    const length = Math.hypot(tx - fx, tz - fz);
    if (remaining <= length || i === nodes.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 1;
      return { x: fx + (tx - fx) * t, z: fz + (tz - fz) * t, heading: Math.atan2(tx - fx, tz - fz) };
    }
    remaining -= length;
  }
  const [lx, lz] = nodes[nodes.length - 1];
  return { x: lx, z: lz, heading: 0 };
}
// Deterministic per-point hash (0..1) used to jitter road segment width so a path reads as
// hand-worn earth rather than a ruler-uniform ribbon.
function pointHash(a, b, salt) {
  let h = (a * 374761393 + b * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const _hslTmp = { h: 0, s: 0, l: 0 };
const _colorTmp = new THREE.Color();
const _whiteTmp = new THREE.Color(0xffffff);
const _blackTmp = new THREE.Color(0x1a1712);
// Single tint applied to a whole real house model (see _setHouseColor) — replaces what used to
// be two separate colors on the old primitive's separate body/roof meshes.
const ABANDONED_HOUSE_COLOR = new THREE.Color(0x847e70);
const RECLAIM_RADIUS = 15;
const _upAxisTmp = new THREE.Vector3(0, 1, 0);
const _unitScaleTmp = new THREE.Vector3(1, 1, 1);
const ZERO_MATRIX = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
const PLANK_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.95 });
const POST_MAT = new THREE.MeshStandardMaterial({ color: 0x5c4630, roughness: 1 });
const CRATE_MAT = new THREE.MeshStandardMaterial({ color: 0xa5793f, roughness: 0.9 });
const BARREL_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });

// Bottom-anchored (base at local y=0, like fitGeometryToHeight's output below) so a placeholder
// and its eventual real model both drop in at the exact same ground-height position with no
// per-mesh offset math to keep in sync between the two.
const TOWER_PLACEHOLDER_GEO = new THREE.CylinderGeometry(0.28, 0.36, TOWER_REFERENCE_HEIGHT * 0.85, 8).translate(0, TOWER_REFERENCE_HEIGHT * 0.425, 0);
const TOWER_PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: WALL_TINT, roughness: 0.9 });
const TOWER_SENTRY_GEO = new THREE.BoxGeometry(0.15, 0.32, 0.15);
const TOWER_SENTRY_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.9 });
const WALL_PLACEHOLDER_GEO = new THREE.BoxGeometry(1.5, 0.95, 0.32).translate(0, 0.475, 0);
const WALL_PLACEHOLDER_MAT = new THREE.MeshStandardMaterial({ color: WALL_TINT, roughness: 0.95 });
// An old-fashioned market/trade cart: wooden bed on two spoked wheels, front draw shafts,
// and a peaked striped-cloth awning on corner poles.
const MERCHANT_CART_MAT = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
const MERCHANT_RAIL_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
const MERCHANT_WHEEL_MAT = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85 });
const MERCHANT_HUB_MAT = new THREE.MeshStandardMaterial({ color: 0x201510, roughness: 0.8 });
const MERCHANT_POLE_MAT = new THREE.MeshStandardMaterial({ color: 0x5a3f26, roughness: 0.85 });
const MERCHANT_CANOPY_MAT = new THREE.MeshStandardMaterial({ color: 0xd9c48f, roughness: 0.9 });
const MERCHANT_CANOPY_STRIPE_MAT = new THREE.MeshStandardMaterial({ color: 0xa8402f, roughness: 0.9 });
const MERCHANT_CRATE_MAT = new THREE.MeshStandardMaterial({ color: 0xb08a52, roughness: 0.9 });

const MERCHANT_CART_GEO = new THREE.BoxGeometry(0.4, 0.16, 0.6);
const MERCHANT_RAIL_GEO = new THREE.BoxGeometry(0.42, 0.09, 0.62);
const MERCHANT_WHEEL_GEO = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10);
const MERCHANT_HUB_GEO = new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8);
const MERCHANT_SHAFT_GEO = new THREE.CylinderGeometry(0.018, 0.018, 0.5, 5);
const MERCHANT_POLE_GEO = new THREE.CylinderGeometry(0.018, 0.018, 0.34, 5);
// A peaked awning made of two panels sloping down from a central ridge — built by rotating
// each panel around its inner (ridge) edge rather than its center.
function buildCanopyPanel(sign) {
  const g = new THREE.BoxGeometry(0.26, 0.025, 0.58);
  g.translate(sign * 0.13, 0, 0);
  g.rotateZ(sign * -0.45);
  return g;
}
const MERCHANT_CANOPY_LEFT_GEO = buildCanopyPanel(1);
const MERCHANT_CANOPY_RIGHT_GEO = buildCanopyPanel(-1);
const MERCHANT_CRATE_GEO = new THREE.BoxGeometry(0.14, 0.14, 0.14);
const TRADE_ROUTE_MAX_DIST = 150;

const LABEL_W = 320, LABEL_H = 112;
function buildLabelTexture(name, pop) {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_W; canvas.height = LABEL_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, LABEL_W, LABEL_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  ctx.font = '700 40px "Segoe UI", sans-serif';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(8,6,3,0.88)';
  ctx.strokeText(name, LABEL_W / 2, 40);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, LABEL_W / 2, 40);

  const popText = `👥 ${pop}`;
  ctx.font = '600 30px "Segoe UI", sans-serif';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(8,6,3,0.88)';
  ctx.strokeText(popText, LABEL_W / 2, 84);
  ctx.fillStyle = '#ffd76b';
  ctx.fillText(popText, LABEL_W / 2, 84);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class SettlementManager {
  constructor(scene, world, creatures, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.creatures = creatures;
    this.toast = opts.toast || (() => {});
    this.laws = opts.laws || {};
    this.events = opts.events || null;
    this.settlements = [];
    this.empires = [];
    this.nextSettlementId = 1;
    this.nextEmpireId = 1;
    this._tick = 0;
    this._diploTick = 0;
    this._preserveCreatureState = false;
    this._disposed = false;
    this.civilizationSystem = null;
    this._settlementSpatialIndex = new SpatialIndex(TERRITORY_MAX_RADIUS);
    this._obstacleSpatialIndex = new SpatialIndex(3);
    this._navigationObstacles = [];
    this._obstacleCandidates = [];
    this._navigationObstaclesDirty = true;
    this._territoryCandidates = [];
    this._territoryDirty = false;
    this._territoryFullDirty = false;
    this._territoryDirtyBounds = null;
    this._territoryRefreshDelay = 0;

    this.group = new THREE.Group();
    scene.add(this.group);

    // One InstancedMesh per house variant (see the "Real house models" comment above) — starts
    // on a shared placeholder box geometry/material so construction stays synchronous, then every
    // existing instance picks up the real look automatically once the .glb finishes loading,
    // since the swap happens on the geometry/material of the (already-placed) shared mesh itself.
    this.houseMeshes = HOUSE_VARIANTS.map((variant, i) => {
      const mesh = new THREE.InstancedMesh(HOUSE_PLACEHOLDER_GEO, HOUSE_PLACEHOLDER_MAT, HOUSE_CAP);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(HOUSE_CAP * 3), 3);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      // Instanced meshes default their draw .count to the full declared capacity — start every
      // one of these at 0 and grow it as slots are actually claimed (see allocHouseSlot /
      // allocFarmSlot) so an empty world doesn't pay the GPU cost of hundreds of unused houses.
      mesh.count = 0;
      this.group.add(mesh);
      // Closes over `mesh` directly, not this.houseMeshes[i] — if this variant's geometry was
      // already cached by an earlier settlement manager this session, ensureHouseVariantRequested
      // calls back synchronously, before the .map() below has finished assigning this.houseMeshes.
      ensureHouseVariantRequested(variant, (geometry, material) => {
        mesh.geometry = geometry;
        mesh.material = material;
        this._pathsDirty = true;
      });
      return mesh;
    });
    this.freeHouseSlots = [];
    this.nextHouseSlot = 0;
    this.slotOwner = new Map();

    // Chimney: a small extra detail shown only on upgraded (stone-tier) houses, keyed 1:1
    // to the house's own instance slot — no separate allocation pool needed.
    const chimneyGeo = new THREE.BoxGeometry(0.13, 0.34, 0.13);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x5c4a3a, roughness: 1 });
    this.chimneyMesh = new THREE.InstancedMesh(chimneyGeo, chimneyMat, HOUSE_CAP);
    this.chimneyMesh.castShadow = true;
    this.chimneyMesh.receiveShadow = true;
    this.chimneyMesh.frustumCulled = false;
    this.chimneyMesh.count = 0;
    this.group.add(this.chimneyMesh);

    this.housePaths = new Map();
    this.pathMesh = new THREE.Mesh(mergeRoads([]), createRoadMaterial());
    this.pathMesh.receiveShadow = true;
    this.pathMesh.frustumCulled = false;
    this.pathMesh.renderOrder = 1;
    this.group.add(this.pathMesh);
    this.cityDetailMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 }));
    this.cityDetailMesh.castShadow = true;
    this.cityDetailMesh.receiveShadow = true;
    this.group.add(this.cityDetailMesh);
    this.bridgeMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9 }));
    this.bridgeMesh.castShadow = true; this.bridgeMesh.receiveShadow = true;
    this.group.add(this.bridgeMesh);
    this._pathsDirty = false;

    this.towers = new Map();
    this.walls = new Map();
    this.tradeRoutes = new Map();
    this.roadNetwork = new Map();
    this.merchants = [];

    // Wall segments/gates: one InstancedMesh per piece type shared by every settlement (same
    // pattern as houseMeshes above), instead of a THREE.Mesh per segment — a single max-level ring
    // was ~70 individual Mesh objects, so several walled cities meant hundreds of draw calls for
    // geometry that's identical (and shared) across every instance anyway. this.walls still maps
    // settlement id -> { children: [...] }, where each entry is a lightweight descriptor (position/
    // quaternion/userData.isGate/slot), not a real Object3D — navigation, save-adjacent code and
    // existing tests only ever read those fields, never scene-graph methods on the wall itself.
    const segPieceInit = WALL_PIECES.segment, gatePieceInit = WALL_PIECES.gate;
    this.wallSegmentMesh = new THREE.InstancedMesh(segPieceInit.geometry || WALL_PLACEHOLDER_GEO, segPieceInit.material || WALL_PLACEHOLDER_MAT, WALL_SEGMENT_CAP);
    this.wallSegmentMesh.castShadow = true;
    this.wallSegmentMesh.receiveShadow = true;
    this.wallSegmentMesh.frustumCulled = false;
    this.wallSegmentMesh.count = 0;
    this.group.add(this.wallSegmentMesh);
    ensureWallPieceRequested(segPieceInit, (geometry, material) => {
      this.wallSegmentMesh.geometry = geometry;
      this.wallSegmentMesh.material = material;
      this._syncWallModelTransforms();
    });
    this.wallGateMesh = new THREE.InstancedMesh(gatePieceInit.geometry || WALL_PLACEHOLDER_GEO, gatePieceInit.material || WALL_PLACEHOLDER_MAT, WALL_GATE_CAP);
    this.wallGateMesh.castShadow = true;
    this.wallGateMesh.receiveShadow = true;
    this.wallGateMesh.frustumCulled = false;
    this.wallGateMesh.count = 0;
    this.group.add(this.wallGateMesh);
    ensureWallPieceRequested(gatePieceInit, (geometry, material) => {
      this.wallGateMesh.geometry = geometry;
      this.wallGateMesh.material = material;
      this._syncWallModelTransforms();
    });
    this.freeWallSegmentSlots = [];
    this.nextWallSegmentSlot = 0;
    this.freeWallGateSlots = [];
    this.nextWallGateSlot = 0;

    // A flat gold square read as a rug, not a field. Give it real tilled furrows (small ridges
    // running in rows) and alternate soil/crop vertex colors along those rows, all in geometry so
    // it stays a single cheap InstancedMesh draw call like the plain plane it replaces.
    const farmGeo = new THREE.PlaneGeometry(1.3, 1.3, 10, 7);
    farmGeo.rotateX(-Math.PI / 2);
    {
      const pos = farmGeo.attributes.position;
      const soil = new THREE.Color(0x7a5a2f), crop = new THREE.Color(0xd4b13a), tip = new THREE.Color(0xe8cf6a);
      const colors = [];
      const tmp = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const row = Math.sin(z * 15.5);
        pos.setY(i, Math.max(0, row) * 0.018);
        const stripe = row * 0.5 + 0.5;
        tmp.copy(soil).lerp(crop, stripe);
        if (row > 0.75) tmp.lerp(tip, (row - 0.75) * 3);
        colors.push(tmp.r, tmp.g, tmp.b);
      }
      farmGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      farmGeo.computeVertexNormals();
    }
    const farmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    this.farmMesh = new THREE.InstancedMesh(farmGeo, farmMat, FARM_CAP);
    this.farmMesh.receiveShadow = true;
    this.farmMesh.frustumCulled = false;
    this.farmMesh.count = 0;
    this.group.add(this.farmMesh);
    this.freeFarmSlots = [];
    this.nextFarmSlot = 0;

    // Territory overlay: one continuous mesh (shared vertices -> no seams between cells).
    // Per-vertex RGBA color: alpha=0 for unclaimed/water, empire color elsewhere. A small
    // per-settlement shade offset makes borders between same-empire cities read as a subtle
    // lighter line, while borders between different empires show the full color jump.
    const gridN = Math.floor(world.size / TERRITORY_STEP) + 1;
    this.territoryGridN = gridN;
    this.territoryHalf = world.size / 2;
    const positions = new Float32Array(gridN * gridN * 3);
    const colors = new Float32Array(gridN * gridN * 4);
    for (let gz = 0; gz < gridN; gz++) {
      for (let gx = 0; gx < gridN; gx++) {
        const i = gz * gridN + gx;
        positions[i * 3] = -this.territoryHalf + gx * TERRITORY_STEP;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = -this.territoryHalf + gz * TERRITORY_STEP;
      }
    }
    const indices = [];
    for (let gz = 0; gz < gridN - 1; gz++) {
      for (let gx = 0; gx < gridN - 1; gx++) {
        const a = gz * gridN + gx, b = gz * gridN + gx + 1, c = (gz + 1) * gridN + gx, d = (gz + 1) * gridN + gx + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const terrGeo = new THREE.BufferGeometry();
    terrGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    terrGeo.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    terrGeo.setIndex(indices);
    const terrMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    this.territoryMesh = new THREE.Mesh(terrGeo, terrMat);
    this.territoryMesh.frustumCulled = false;
    this.territoryMesh.visible = false;
    this.territoryMesh.renderOrder = 1;
    this.group.add(this.territoryMesh);
    this.docks = new Map();
    this.labelsVisible = true;
  }

  _markNavigationObstaclesDirty() {
    this._navigationObstaclesDirty = true;
    this.world.navigationRevision = (this.world.navigationRevision || 0) + 1;
  }

  setCivilizationSystem(system) {
    this.civilizationSystem = system || null;
    this._markNavigationObstaclesDirty();
    return this;
  }

  markNavigationChanged() {
    this._markNavigationObstaclesDirty();
  }

  _ensureNavigationObstacles() {
    if (!this._navigationObstaclesDirty) return this._obstacleSpatialIndex;
    const obstacles = [];
    for (const settlement of this.settlements) {
      for (const house of settlement.houses || []) {
        if (house.slot != null) obstacles.push({ x: house.x, z: house.z, radius: 0.72, kind: 'house' });
      }
    }
    for (const wall of this.walls.values()) {
      for (const segment of wall.children || []) {
        if (segment.userData.isGate) continue;
        obstacles.push({ x: segment.position.x, z: segment.position.z, radius: 0.62, kind: 'wall' });
      }
    }
    for (const tower of this.towers.values()) {
      obstacles.push({ x: tower.position.x, z: tower.position.z, radius: 0.46, kind: 'tower' });
    }
    for (const obstacle of this.civilizationSystem?.getBuildingObstacles?.() || []) obstacles.push(obstacle);
    this._navigationObstacles = obstacles;
    this._obstacleSpatialIndex.rebuild(obstacles);
    this._navigationObstaclesDirty = false;
    return this._obstacleSpatialIndex;
  }

  isNavigationBlockedGrid(vx, vz) {
    if (!this.world.inBounds(vx, vz)) return true;
    const [x, z] = this.world.gridToWorld(vx, vz);
    const candidates = this._ensureNavigationObstacles().queryRadius(x, z, 1.05, null, this._obstacleCandidates);
    return candidates.some(obstacle => {
      const dx = obstacle.x - x, dz = obstacle.z - z;
      return dx * dx + dz * dz <= obstacle.radius * obstacle.radius;
    });
  }

  // ---------- City labels (name + population, always facing the camera) ----------
  addLabel(s) {
    const tex = buildLabelTexture(s.name, s.pop);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(mat);
    sprite.center.set(0.5, 0);
    sprite.scale.set(0.15, 0.15 * (LABEL_H / LABEL_W), 1);
    sprite.renderOrder = 15;
    sprite.visible = this.labelsVisible;
    this.group.add(sprite);
    s.labelSprite = sprite;
    s._labelPop = s.pop;
    this._positionLabel(s);
  }

  _positionLabel(s) {
    if (!s.labelSprite) return;
    const y = this.world.heightAtWorld(s.x, s.z) + 2.05 + s.level * 0.42;
    s.labelSprite.position.set(s.x, y, s.z);
  }

  _syncLabel(s) {
    if (!s.labelSprite) { this.addLabel(s); return; }
    this._positionLabel(s);
    if (s._labelPop !== s.pop) {
      s._labelPop = s.pop;
      const oldTex = s.labelSprite.material.map;
      s.labelSprite.material.map = buildLabelTexture(s.name, s.pop);
      s.labelSprite.material.needsUpdate = true;
      oldTex?.dispose();
    }
  }

  removeLabel(s) {
    if (!s.labelSprite) return;
    this.group.remove(s.labelSprite);
    s.labelSprite.material.map?.dispose();
    s.labelSprite.material.dispose();
    s.labelSprite = null;
  }

  setLabelsVisible(visible) {
    this.labelsVisible = !!visible;
    for (const s of this.settlements) if (s.labelSprite) s.labelSprite.visible = this.labelsVisible;
  }

  // ---------- Player-driven renaming / recoloring ----------
  renameSettlement(s, name) {
    const trimmed = String(name ?? '').trim().slice(0, 24);
    if (!trimmed || !s) return false;
    s.name = trimmed;
    if (s.labelSprite) {
      const oldTex = s.labelSprite.material.map;
      s.labelSprite.material.map = buildLabelTexture(s.name, s.pop);
      s.labelSprite.material.needsUpdate = true;
      oldTex?.dispose();
      s._labelPop = s.pop;
    }
    return true;
  }

  renameEmpire(empire, name) {
    const trimmed = String(name ?? '').trim().slice(0, 28);
    if (!trimmed || !empire) return false;
    empire.name = trimmed;
    return true;
  }

  setEmpireColor(empire, hexColor) {
    if (!empire) return false;
    try { empire.color.set(hexColor); } catch { return false; }
    for (const s of this.settlements) {
      if (s.empireId !== empire.id) continue;
      for (const h of s.houses) if (h.slot != null) this._setHouseColor(h, empire.color);
      this.updateFlag(s);
    }
    this._markHouseColorsDirty();
    if (this.territoryMesh.visible) this.scheduleTerritoryUpdate();
    return true;
  }

  _lawEnabled(name) {
    return !this.laws || this.laws[name] !== false;
  }

  setLaws(laws) {
    this.laws = laws || {};
  }

  _demobilize(c) {
    c.role = null;
    c.profession = 'Aldeano';
    c.economicRoleSet = false;
    c.warTargetEmpire = null;
    c.warDestination = null;
    c.combatTarget = null;
    c.target = null;
    c.choppingTree = null;
    c.commander = false;
    c.archer = false;
    c.weaponKind = null;
    if (c.masterwork) { c.damageMul /= 1.18; c.masterwork = false; }
    if (c.model3d) detachWeapon(c.model3d);
  }

  _syncResidentHomes(s) {
    const radius = RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0];
    for (const c of this.creatures.creatures) {
      if (!c.alive || c.settlementId !== s.id) continue;
      c.empireId = s.empireId;
      c.homeX = s.x;
      c.homeZ = s.z;
      c.homeRadius = radius;
    }
  }

  _hasActiveEmpire(empireId) {
    return this.settlements.some(s => s.empireId === empireId);
  }

  _ensureActiveRelations() {
    for (let i = 0; i < this.empires.length; i++) {
      const a = this.empires[i];
      for (let j = i + 1; j < this.empires.length; j++) {
        const b = this.empires[j];
        let ab = a.relations.get(b.id);
        let ba = b.relations.get(a.id);
        if (!ab && !ba) {
          ab = { status: 'peace', tension: 15, warTime: 0, opinion: 45, treatyTime: 0, warGoal: null };
          ba = { ...ab };
        } else if (!ab) {
          ab = { ...ba };
        } else if (!ba) {
          ba = { ...ab };
        }
        const status = ab.status === 'war' || ba.status === 'war' ? 'war' :
          (ab.status === 'alliance' && ba.status === 'alliance' ? 'alliance' : 'peace');
        const tension = Math.max(0, Math.min(100, (Number(ab.tension) + Number(ba.tension)) / 2 || 0));
        const warTime = Math.max(Number(ab.warTime) || 0, Number(ba.warTime) || 0);
        const opinion = Math.max(-100, Math.min(100, (Number(ab.opinion ?? 45) + Number(ba.opinion ?? 45)) / 2));
        const treatyTime = Math.max(Number(ab.treatyTime) || 0, Number(ba.treatyTime) || 0);
        ab.status = status; ab.tension = tension; ab.warTime = warTime; ab.opinion = opinion; ab.treatyTime = treatyTime;
        ba.status = status; ba.tension = tension; ba.warTime = warTime; ba.opinion = opinion; ba.treatyTime = treatyTime;
        a.relations.set(b.id, ab);
        b.relations.set(a.id, ba);
      }
    }
  }

  _cleanupExtinctEmpires() {
    const activeIds = new Set(this.settlements.map(s => s.empireId));
    const extinctIds = new Set(this.empires.filter(e => !activeIds.has(e.id)).map(e => e.id));
    if (extinctIds.size) {
      this.empires = this.empires.filter(e => activeIds.has(e.id));
    }
    const validEmpireIds = new Set(this.empires.map(e => e.id));
    for (const c of this.creatures.creatures) {
      if (c.empireId == null || validEmpireIds.has(c.empireId)) continue;
      if (c.role === 'soldado') this._demobilize(c);
      c.empireId = null;
    }
    for (const empire of this.empires) {
      for (const otherId of Array.from(empire.relations.keys())) {
        if (otherId === empire.id || !activeIds.has(otherId)) empire.relations.delete(otherId);
      }
    }
    this._ensureActiveRelations();
    return extinctIds.size;
  }

  setTerritoryVisible(visible) {
    this.territoryMesh.visible = visible;
    if (visible) this.updateTerritoryOverlay();
  }

  scheduleTerritoryUpdate(bounds = null, delay = 0.08) {
    if (!this.territoryMesh.visible) return;
    this._territoryDirty = true;
    this._territoryRefreshDelay = Math.min(this._territoryRefreshDelay || Infinity, Math.max(0, delay));
    if (!bounds) {
      this._territoryFullDirty = true;
      this._territoryDirtyBounds = null;
      return;
    }
    if (this._territoryFullDirty) return;
    const next = {
      minX: Math.max(0, Math.floor(Number(bounds.minX) || 0)),
      minZ: Math.max(0, Math.floor(Number(bounds.minZ) || 0)),
      maxX: Math.min(this.world.size, Math.ceil(Number(bounds.maxX) || 0)),
      maxZ: Math.min(this.world.size, Math.ceil(Number(bounds.maxZ) || 0)),
    };
    if (!this._territoryDirtyBounds) this._territoryDirtyBounds = next;
    else {
      const current = this._territoryDirtyBounds;
      current.minX = Math.min(current.minX, next.minX);
      current.minZ = Math.min(current.minZ, next.minZ);
      current.maxX = Math.max(current.maxX, next.maxX);
      current.maxZ = Math.max(current.maxZ, next.maxZ);
    }
  }

  updateVisuals(dt) {
    this._flushHousePaths();
    if (!this._territoryDirty || !this.territoryMesh.visible) return;
    this._territoryRefreshDelay -= Math.max(0, Number(dt) || 0);
    if (this._territoryRefreshDelay > 0) return;
    const bounds = this._territoryFullDirty ? null : this._territoryDirtyBounds;
    this.updateTerritoryOverlay(bounds);
  }

  // Territory now grows with the settlement itself — a lone hut claims a small patch and
  // the border pushes outward one house at a time, instead of every settlement instantly
  // claiming the same fixed 26-unit radius regardless of how built-up it actually is.
  _territoryRadius(s) {
    return Math.min(TERRITORY_MAX_RADIUS, TERRITORY_BASE_RADIUS + s.houses.length * TERRITORY_PER_HOUSE);
  }

  _territoryColor(base, out) {
    base.getHSL(_hslTmp);
    return out.setHSL(_hslTmp.h, Math.min(1, _hslTmp.s * 1.3 + 0.12), Math.min(0.68, Math.max(0.38, _hslTmp.l)));
  }

  // Every city of the same empire now shares one flat color (no per-city shade offset).
  // A lighter seam is drawn only where two cells belong to the same empire but different
  // settlements — the frontier between two different empires stays a hard color jump.
  updateTerritoryOverlay(dirtyBounds = null) {
    const geo = this.territoryMesh.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const gridN = this.territoryGridN;
    const world = this.world;
    const n = gridN * gridN;
    if (!this._ownerScratch || this._ownerScratch.length !== n) {
      this._ownerScratch = new Int32Array(n);
      this._empireScratch = new Int32Array(n);
    }
    const owner = this._ownerScratch, empireOf = this._empireScratch;
    const colorBounds = dirtyBounds ? {
      minX: Math.max(0, dirtyBounds.minX - 1), minZ: Math.max(0, dirtyBounds.minZ - 1),
      maxX: Math.min(gridN - 1, dirtyBounds.maxX + 1), maxZ: Math.min(gridN - 1, dirtyBounds.maxZ + 1),
    } : { minX: 0, minZ: 0, maxX: gridN - 1, maxZ: gridN - 1 };
    const ownerBounds = {
      minX: Math.max(0, colorBounds.minX - 1), minZ: Math.max(0, colorBounds.minZ - 1),
      maxX: Math.min(gridN - 1, colorBounds.maxX + 1), maxZ: Math.min(gridN - 1, colorBounds.maxZ + 1),
    };
    this._settlementSpatialIndex.rebuild(this.settlements);
    const empireById = new Map(this.empires.map(empire => [empire.id, empire]));

    for (let gz = ownerBounds.minZ; gz <= ownerBounds.maxZ; gz++) {
      for (let gx = ownerBounds.minX; gx <= ownerBounds.maxX; gx++) {
        const i = gz * gridN + gx;
        const x = pos.getX(i), z = pos.getZ(i);
        const vx = Math.round(Math.min(world.size, Math.max(0, x + world.half)));
        const vz = Math.round(Math.min(world.size, Math.max(0, z + world.half)));
        const inBounds = world.inBounds(vx, vz);
        pos.setY(i, (inBounds ? world.height[world.idx(vx, vz)] : world.groundY(0, 0)) + 0.08);
        if (!inBounds || world.isWater(vx, vz)) { owner[i] = -1; empireOf[i] = -1; continue; }
        let best = null, bestScore = 1;
        const candidates = this._settlementSpatialIndex.queryRadius(x, z, TERRITORY_MAX_RADIUS, null, this._territoryCandidates);
        for (const s of candidates) {
          const radius = this._territoryRadius(s);
          const score = dist2(x, z, s.x, s.z) / (radius * radius);
          if (score < bestScore) { bestScore = score; best = s; }
        }
        owner[i] = best ? best.id : -1;
        empireOf[i] = best ? best.empireId : -1;
      }
    }

    for (let gz = colorBounds.minZ; gz <= colorBounds.maxZ; gz++) {
      for (let gx = colorBounds.minX; gx <= colorBounds.maxX; gx++) {
        const i = gz * gridN + gx;
        const eid = empireOf[i];
        if (eid < 0) { col.setXYZW(i, 0, 0, 0, 0); continue; }
        const empire = empireById.get(eid);
        if (!empire) { col.setXYZW(i, 0, 0, 0, 0); continue; }
        this._territoryColor(empire.color, _colorTmp);
        const sid = owner[i];
        // Only check the "forward" neighbors (+x/+z) so each boundary crossing lights up
        // a single row of cells instead of one row on each side — a thinner seam.
        let internalBorder = false;
        if (gx + 1 < gridN && empireOf[i + 1] === eid && owner[i + 1] !== sid && owner[i + 1] !== -1) internalBorder = true;
        if (!internalBorder && gz + 1 < gridN && empireOf[i + gridN] === eid && owner[i + gridN] !== sid && owner[i + gridN] !== -1) internalBorder = true;
        if (internalBorder) {
          empire.color.getHSL(_hslTmp);
          _colorTmp.lerp(_hslTmp.l > 0.58 ? _blackTmp : _whiteTmp, TERRITORY_BORDER_LIFT);
        }
        col.setXYZW(i, _colorTmp.r, _colorTmp.g, _colorTmp.b, TERRITORY_ALPHA);
      }
    }
    pos.clearUpdateRanges?.();
    col.clearUpdateRanges?.();
    if (pos.addUpdateRange && col.addUpdateRange) {
      for (let gz = ownerBounds.minZ; gz <= ownerBounds.maxZ; gz++) {
        pos.addUpdateRange((gz * gridN + ownerBounds.minX) * 3, (ownerBounds.maxX - ownerBounds.minX + 1) * 3);
      }
      for (let gz = colorBounds.minZ; gz <= colorBounds.maxZ; gz++) {
        col.addUpdateRange((gz * gridN + colorBounds.minX) * 4, (colorBounds.maxX - colorBounds.minX + 1) * 4);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this._territoryDirty = false;
    this._territoryFullDirty = false;
    this._territoryDirtyBounds = null;
    this._territoryRefreshDelay = 0;
  }

  genSettlementName() {
    return NAME_PRE[Math.floor(Math.random() * NAME_PRE.length)] + ' ' + NAME_SUF[Math.floor(Math.random() * NAME_SUF.length)];
  }
  genEmpireName() {
    const w = EMPIRE_SYL1[Math.floor(Math.random() * EMPIRE_SYL1.length)] + EMPIRE_SYL2[Math.floor(Math.random() * EMPIRE_SYL2.length)];
    return `${EMPIRE_TITLE[Math.floor(Math.random() * EMPIRE_TITLE.length)]} de ${w}`;
  }

  createEmpire() {
    const id = this.nextEmpireId++;
    const color = new THREE.Color().setHSL(Math.random(), 0.55 + Math.random() * 0.2, 0.48 + Math.random() * 0.1);
    const empire = { id, name: this.genEmpireName(), color, capitalId: null, kingId: null, relations: new Map() };
    for (const other of this.empires) {
      const relation = { status: 'peace', tension: 10 + Math.random() * 15, warTime: 0, opinion: 40 + Math.random() * 15, treatyTime: 0, warGoal: null };
      empire.relations.set(other.id, { ...relation });
      other.relations.set(id, { ...relation });
    }
    this.empires.push(empire);
    return empire;
  }

  nearestSettlementDist(x, z) {
    let best = Infinity;
    for (const s of this.settlements) best = Math.min(best, Math.sqrt(dist2(x, z, s.x, s.z)));
    return best;
  }

  nearestEmpireId(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      const d = dist2(x, z, s.x, s.z);
      if (d < bestD) { bestD = d; best = s.empireId; }
    }
    return best;
  }

  nearestSettlement(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const s of this.settlements) {
      if (s.abandoned) continue;
      const d = dist2(x, z, s.x, s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  _nearestAbandonedSettlement(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const s of this.settlements) {
      if (!s.abandoned) continue;
      const d = dist2(x, z, s.x, s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  allocHouseSlot() {
    if (this.freeHouseSlots.length) return this.freeHouseSlots.pop();
    if (this.nextHouseSlot >= HOUSE_CAP) return null;
    const slot = this.nextHouseSlot++;
    for (const mesh of this.houseMeshes) mesh.count = this.nextHouseSlot;
    this.chimneyMesh.count = this.nextHouseSlot;
    return slot;
  }

  allocWallSegmentSlot() {
    if (this.freeWallSegmentSlots.length) return this.freeWallSegmentSlots.pop();
    if (this.nextWallSegmentSlot >= WALL_SEGMENT_CAP) return null;
    const slot = this.nextWallSegmentSlot++;
    this.wallSegmentMesh.count = this.nextWallSegmentSlot;
    return slot;
  }

  allocWallGateSlot() {
    if (this.freeWallGateSlots.length) return this.freeWallGateSlots.pop();
    if (this.nextWallGateSlot >= WALL_GATE_CAP) return null;
    const slot = this.nextWallGateSlot++;
    this.wallGateMesh.count = this.nextWallGateSlot;
    return slot;
  }

  // Each village shares one draw call; individual paths are regenerated only on edits.
  _syncPathInstance(s, house, force = false) {
    if (house.slot == null) return;
    const revision = this.world.terrainMesh?.geometry.attributes.position.version || 0;
    const signature = [revision, s.x, s.z, house.x, house.z, house.pathCurveSign].join(':');
    const previous = this.housePaths.get(house.slot);
    if (!force && previous?.userData.signature === signature) return;
    previous?.dispose();
    const dx = s.x - house.x, dz = s.z - house.z, distance = Math.hypot(dx, dz);
    const nodes = [];
    if (house.gridPlot) {
      const side = house.z > s.z ? -1 : 1;
      nodes.push([house.x, house.z], [house.x, house.z + side * CITY_BLOCK / 2]);
    }
    if (!house.gridPlot && distance > 0.1) for (let k = 0; k <= PATH_SEGMENTS; k++) {
      const t = k / PATH_SEGMENTS;
      const bend = Math.sin(t * Math.PI) * Math.min(distance * 0.12, 0.8) * (house.pathCurveSign ?? 1);
      nodes.push([house.x + dx * t - dz / distance * bend, house.z + dz * t + dx / distance * bend]);
    }
    const geometry = buildTerrainRoad(this.world, nodes, 0.7);
    geometry.userData.signature = signature;
    this.housePaths.set(house.slot, geometry);
    this._pathsDirty = true;
  }

  _flushHousePaths() {
    if (!this._pathsDirty) return;
    for (const s of this.settlements) if (s.level >= WALL_MIN_LEVEL && this.walls && !s.abandoned) this.addWall(s);
    this.pathMesh.geometry.dispose();
    const streets = this.settlements.flatMap(s => cityStreets(s).map(nodes => buildTerrainRoad(this.world, nodes, .88)));
    const bridgeSources = [...this.housePaths.values(), ...streets,
      ...[...this.tradeRoutes.values()].flatMap(r => (r.meshes || []).filter(m => m.visible).map(m => m.geometry))];
    const bridges = new Map();
    for (const geometry of bridgeSources) for (const bridge of geometry.userData.bridges || []) bridges.set(bridge.key, bridge);
    const bridgeSignature = JSON.stringify([[...bridges.values()], bridges.size ? this.world.terrainMesh?.geometry.attributes.position.version : 0]);
    if (bridgeSignature !== this._bridgeSignature) {
      this._bridgeSignature = bridgeSignature;
      this.world.setBridges([...bridges.values()]);
      if (this.bridgeMesh) {
        this.bridgeMesh.geometry.dispose();
        this.bridgeMesh.geometry = buildBridgeGeometry(this.world, this.world._bridges);
      }
    }
    this.pathMesh.geometry = mergeRoads([...this.housePaths.values(), ...streets]);
    for (const geometry of streets) geometry.dispose();
    this.cityDetailMesh.geometry.dispose();
    this.cityDetailMesh.geometry = cityDetails(this.world, this.settlements);
    // This is visual clearing only: terrain, resources and pathfinding stay intact.
    const grassMask = new Uint8Array(this.world.n);
    const surfaces = [this.pathMesh.geometry, ...[...this.tradeRoutes.values()].flatMap(route => (route.meshes || []).map(mesh => mesh.geometry))];
    for (const geometry of surfaces) {
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const [x, z] = this.world.worldToGrid(positions.getX(i), positions.getZ(i));
        if (this.world.inBounds(x, z)) grassMask[this.world.idx(x, z)] = 1;
      }
    }
    this.world._roadGrassMask = grassMask;
    // Clear trunks and lower crowns; release these areas when roads are removed.
    const treeMask = new Uint8Array(this.world.n);
    const mark = (wx, wz, radius) => {
      const [cx, cz] = this.world.worldToGrid(wx, wz);
      const reach = Math.ceil(radius + 0.5);
      for (let z = cz - reach; z <= cz + reach; z++) for (let x = cx - reach; x <= cx + reach; x++) {
        if (!this.world.inBounds(x, z)) continue;
        const [px, pz] = this.world.gridToWorld(x, z);
        if (Math.hypot(px - wx, pz - wz) <= radius) treeMask[this.world.idx(x, z)] = 1;
      }
    };
    for (let i = 0; i < grassMask.length; i++) if (grassMask[i]) {
      const [wx, wz] = this.world.gridToWorld(i % this.world.verts, Math.floor(i / this.world.verts));
      mark(wx, wz, 1.5);
    }
    for (const s of this.settlements) for (const house of s.houses) {
      const geometry = this._houseMesh(house).geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const footprint = Math.hypot(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)), Math.max(Math.abs(box.min.z), Math.abs(box.max.z)));
      mark(house.x, house.z, footprint * (house.scaleMul || 1) * (house.tier ? 1.22 : 1) + 0.9);
    }
    this.world._constructionTreeMask = treeMask;
    for (let i = 0; i < treeMask.length; i++) if (treeMask[i] && this.world.treeState[i]) {
      this.world.removeTree(i % this.world.verts, Math.floor(i / this.world.verts));
    }
    this.world.scheduleGrassRefresh(0);
    this._pathsDirty = false;
  }

  // Looks up which real-house InstancedMesh (see HOUSE_VARIANTS) owns a given house's slot.
  _houseMesh(house) {
    return this.houseMeshes[house.variant] || this.houseMeshes[0];
  }

  _setHouseColor(house, color) {
    if (house.slot == null) return;
    this._houseMesh(house).setColorAt(house.slot, HOUSE_VARIANTS[house.variant]?.urban ? _colorTmp.copy(color).lerp(_whiteTmp, .88) : color);
  }

  _markHouseColorsDirty() {
    for (const mesh of this.houseMeshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  _syncHouseInstance(s, house, force = false) {
    if (house.slot == null) return false;
    const y = this.world.heightAtWorld(house.x, house.z);
    const transformChanged = force || !Number.isFinite(house.groundY) || Math.abs(house.groundY - y) > 0.001;
    if (transformChanged) {
      const tierBoost = house.tier ? 1.22 : 1;
      const scaleMul = (Number.isFinite(house.scaleMul) ? house.scaleMul : 1) * tierBoost;
      const rotationY = Number.isFinite(house.rotationY) ? house.rotationY : 0;
      const rot = new THREE.Quaternion().setFromAxisAngle(_upAxisTmp, rotationY);
      const scale = new THREE.Vector3(scaleMul, scaleMul, scaleMul);
      // The real house models (fitGeometryToHeight'd in the loader above) already sit with their
      // base at local y=0, so — unlike the old separate body+roof boxes — the whole house is one
      // matrix at ground height, no manual body/roof offset needed.
      const houseMesh = this._houseMesh(house);
      const houseM = new THREE.Matrix4().compose(new THREE.Vector3(house.x, y, house.z), rot, scale);
      houseMesh.setMatrixAt(house.slot, houseM);
      houseMesh.instanceMatrix.needsUpdate = true;
      // allocHouseSlot() grows every variant's InstancedMesh .count together (slots are a single
      // shared index space, not per-variant), but only the winning variant's mesh above ever gets
      // a real transform written at this slot — the other six still default to an identity matrix
      // at the origin, which is now within `count` and so gets drawn: a phantom house of every
      // other variant stacked at world (0,0,0). Explicitly park this slot out of view in every
      // mesh that isn't the one this house actually uses (harmless no-op once already parked, and
      // self-heals a variant change since it re-runs on every sync).
      for (const mesh of this.houseMeshes) {
        if (mesh !== houseMesh) { mesh.setMatrixAt(house.slot, ZERO_MATRIX); mesh.instanceMatrix.needsUpdate = true; }
      }
      // A mushroom cottage has nothing resembling a chimney to attach one to.
      if (house.tier && HOUSE_VARIANTS[house.variant]?.race !== 'elf') {
        const cx = house.x + Math.cos(rotationY + 0.8) * 0.32 * scaleMul;
        const cz = house.z + Math.sin(rotationY + 0.8) * 0.32 * scaleMul;
        const chimM = new THREE.Matrix4().compose(new THREE.Vector3(cx, y + HOUSE_REFERENCE_HEIGHT * 0.82 * scaleMul, cz), rot, scale);
        this.chimneyMesh.setMatrixAt(house.slot, chimM);
      } else {
        this.chimneyMesh.setMatrixAt(house.slot, ZERO_MATRIX);
      }
      this.chimneyMesh.instanceMatrix.needsUpdate = true;
      this._syncPathInstance(s, house);
      house.groundY = y;
    }
    if (force) {
      const empire = this.empires.find(e => e.id === s.empireId);
      this._setHouseColor(house, empire ? empire.color : new THREE.Color(0x8a5a3a));
      this._markHouseColorsDirty();
    }
    return transformChanged;
  }

  addHouse(s, expand = false) {
    const world = this.world;
    const radius = RADIUS_BY_LEVEL[Math.min(3, s.level + (expand ? 1 : 0))];
    for (const plot of cityPlots(s, radius)) {
      const { x, z } = plot;
      const [vx, vz] = world.worldToGrid(x, z);
      if (world.isWater(vx, vz) || !world.isFlatEnough(vx, vz, 1.4)) continue;
      let tooClose = false;
      for (const h of s.houses) { if (dist2(x, z, h.x, h.z) < 1.5 * 1.5) { tooClose = true; break; } }
      if (tooClose || s.farms.some(f => dist2(x, z, f.x, f.z) < 2.8 * 2.8)) continue;
      const slot = this.allocHouseSlot();
      if (slot == null) return false;
      const scaleMul = 0.82 + Math.random() * 0.08;
      // Every race builds from the new timber-and-plaster townhouses now — elf settlements used to
      // keep rolling the old mushroom-cottage GLBs here, which is exactly the "old city generation"
      // look reported live (a mushroom cottage mixed into an otherwise new-style grid). The mushroom
      // variants stay in HOUSE_VARIANTS/houseVariantIndicesFor only so an old save's already-placed
      // elf houses keep rendering correctly, not for any new placement.
      const raceVariants = houseVariantIndicesFor('default').filter(i => HOUSE_VARIANTS[i].urban);
      const variant = raceVariants[Math.floor(Math.random() * raceVariants.length)];
      const house = { x, z, slot, variant, scaleMul, rotationY: plot.rotationY, gridPlot: true, tier: 0, pathCurveSign: Math.random() < 0.5 ? -1 : 1 };
      s.houses.push(house);
      this.slotOwner.set(slot, { settlement: s, house });
      this._syncHouseInstance(s, house, true);
      this._markNavigationObstaclesDirty();
      return true;
    }
    // Old saves can have farms occupying every remaining starter plot. Open the
    // next ring rather than requiring a third house to unlock its own build space.
    if (!expand && s.level < 3) {
      this._prepareSettlementGround(s, s.level + 1);
      return this.addHouse(s, true);
    }
    return false;
  }

  upgradeHouse(s, house) {
    if (!house || house.tier) return false;
    house.tier = 1;
    this._syncHouseInstance(s, house, true);
    return true;
  }

  removeHouse(h) {
    if (!h || h.slot == null) return;
    this._houseMesh(h).setMatrixAt(h.slot, ZERO_MATRIX);
    this._houseMesh(h).instanceMatrix.needsUpdate = true;
    this.chimneyMesh.setMatrixAt(h.slot, ZERO_MATRIX);
    this.housePaths.get(h.slot)?.dispose();
    this.housePaths.delete(h.slot);
    this._pathsDirty = true;
    this.chimneyMesh.instanceMatrix.needsUpdate = true;
    this.freeHouseSlots.push(h.slot);
    this.slotOwner.delete(h.slot);
    h.slot = null;
    this._markNavigationObstaclesDirty();
  }

  allocFarmSlot() {
    if (this.freeFarmSlots.length) return this.freeFarmSlots.pop();
    if (this.nextFarmSlot >= FARM_CAP) return null;
    const slot = this.nextFarmSlot++;
    this.farmMesh.count = this.nextFarmSlot;
    return slot;
  }

  _syncFarmInstance(farm, force = false) {
    if (farm.slot == null) return false;
    const y = this.world.heightAtWorld(farm.x, farm.z) + 0.03;
    if (!force && Number.isFinite(farm.groundY) && Math.abs(farm.groundY - y) <= 0.001) return false;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(farm.x, y, farm.z),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 1, 1),
    );
    this.farmMesh.setMatrixAt(farm.slot, m);
    this.farmMesh.instanceMatrix.needsUpdate = true;
    farm.groundY = y;
    return true;
  }

  addFarm(s) {
    const world = this.world;
    const radius = RADIUS_BY_LEVEL[s.level];
    for (const plot of cityPlots(s, radius).reverse()) {
      const { x, z } = plot;
      // The four founding plots are reserved for homes, including vacant ones.
      if (Math.abs(x - s.x) < CITY_BLOCK && Math.abs(z - s.z) < CITY_BLOCK) continue;
      const [vx, vz] = world.worldToGrid(x, z);
      if (world.isWater(vx, vz) || !world.isFlatEnough(vx, vz, 1.2)) continue;
      let tooClose = false;
      for (const h of s.houses) { if (dist2(x, z, h.x, h.z) < 1.3 * 1.3) { tooClose = true; break; } }
      for (const f of s.farms) { if (dist2(x, z, f.x, f.z) < 1.6 * 1.6) { tooClose = true; break; } }
      if (tooClose) continue;
      const slot = this.allocFarmSlot();
      if (slot == null) return false;
      const farm = { x, z, slot, gridPlot: true };
      s.farms.push(farm);
      this._syncFarmInstance(farm, true);
      this._pathsDirty = true;
      return true;
    }
    return false;
  }

  removeFarm(f) {
    if (!f || f.slot == null) return;
    const zero = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
    this.farmMesh.setMatrixAt(f.slot, zero);
    this.farmMesh.instanceMatrix.needsUpdate = true;
    this.freeFarmSlots.push(f.slot);
    f.slot = null;
    this._pathsDirty = true;
  }

  addFlag(s) {
    const empire = this.empires.find(e => e.id === s.empireId);
    const color = empire ? empire.color : 0xffffff;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.4, 5), new THREE.MeshStandardMaterial({ color: 0x4a3524 }));
    pole.position.y = 0.7;
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    banner.position.set(0.27, 1.15, 0);
    g.add(pole, banner);
    const y = this.world.heightAtWorld(s.x, s.z);
    g.position.set(s.x, y, s.z);
    this.group.add(g);
    s.flagGroup = g;
    s.flagBanner = banner;
    this.updateFlag(s);
  }

  updateFlag(s) {
    if (!s.flagGroup) return;
    const scale = 1 + s.level * 0.35;
    s.flagGroup.scale.setScalar(scale);
    s.flagGroup.position.set(s.x, this.world.heightAtWorld(s.x, s.z), s.z);
    const empire = this.empires.find(e => e.id === s.empireId);
    if (empire) s.flagBanner.material.color.copy(empire.color);
    this._positionLabel(s);
  }

  _removeFlag(s) {
    if (!s.flagGroup) return;
    this.group.remove(s.flagGroup);
    s.flagGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (Array.isArray(obj.material)) {
        for (const material of obj.material) material.dispose();
      } else if (obj.material) {
        obj.material.dispose();
      }
    });
    s.flagGroup = null;
    s.flagBanner = null;
  }

  // ---------- Docks (coastal only, purely visual berths for the ShipManager) ----------
  // A fixed search radius only ever caught water within 5 units of a settlement's *center* — fine
  // for a brand-new level-0 village, but a settlement's own plaza reaches out to
  // RADIUS_BY_LEVEL[level]+2 (see _prepareSettlementGround), so a level-3 city whose outer wall
  // sits right on a beach could still have its center more than 5 units from any water and never
  // pass the check. Worse, this was only ever called once (at founding), so a village founded a
  // little inland that later grew right up to the coast never got a second chance (reported live:
  // a coastal-looking city with real population that never got a dock or expanded by ship).
  // Scaling the radius with the settlement's current footprint, and re-checking on every level-up
  // in onLevelUp() below, fixes both.
  _maybeAddDock(s) {
    if (this.docks.has(s.id)) return;
    const [vx, vz] = this.world.worldToGrid(s.x, s.z);
    const radius = (RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0]) + 3;
    if (this.world.isCoastal(vx, vz, radius)) this.addDock(s);
  }

  addDock(s) {
    const world = this.world;
    // Both searches below need to reach as far as _maybeAddDock()'s own isCoastal() check does —
    // a fixed 5 (the old radius) found a direction and a shoreline only within 5 units of a
    // settlement's *center*, which a level-3 city's own footprint (RADIUS_BY_LEVEL[3]+2 = 15) can
    // already exceed on its own, let alone the water beyond it.
    const reach = (RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0]) + 3;
    let dir = null;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const [gx, gz] = world.worldToGrid(s.x + Math.cos(ang) * reach, s.z + Math.sin(ang) * reach);
      if (world.inBounds(gx, gz) && world.isWater(gx, gz)) { dir = ang; break; }
    }
    if (dir == null) return;
    let shoreX = s.x, shoreZ = s.z;
    for (let d = 1; d <= reach; d += 0.5) {
      const tx = s.x + Math.cos(dir) * d, tz = s.z + Math.sin(dir) * d;
      const [gx, gz] = world.worldToGrid(tx, tz);
      if (!world.inBounds(gx, gz) || world.isWater(gx, gz)) break;
      shoreX = tx; shoreZ = tz;
    }
    const group = new THREE.Group();
    const length = 5.4;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, length), PLANK_MAT);
    plank.position.set(Math.cos(dir) * length / 2, 0.03, Math.sin(dir) * length / 2);
    // The deck length is local Z; align it with the shore-to-water direction.
    plank.rotation.y = Math.PI / 2 - dir;
    plank.castShadow = true; plank.receiveShadow = true;
    group.add(plank);
    for (const t of [0.22, 0.55, 0.9]) {
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.75, 5), POST_MAT);
        const px = Math.cos(dir) * length * t + Math.cos(dir + Math.PI / 2) * side * 0.58;
        const pz = Math.sin(dir) * length * t + Math.sin(dir + Math.PI / 2) * side * 0.58;
        post.position.set(px, -0.32, pz);
        group.add(post);
      }
    }
    // a couple of crates/barrels near the shore end for a "working pier" look
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), CRATE_MAT);
    crate.position.set(Math.cos(dir + 0.7) * 0.85, 0.2, Math.sin(dir + 0.7) * 0.85);
    crate.rotation.y = 0.5;
    crate.castShadow = true;
    group.add(crate);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.36, 8), BARREL_MAT);
    barrel.position.set(Math.cos(dir - 0.8) * 0.9, 0.21, Math.sin(dir - 0.8) * 0.9);
    barrel.castShadow = true;
    group.add(barrel);

    const shoreY = world.heightAtWorld(shoreX, shoreZ);
    const baseY = Math.min(shoreY, CONFIG.WATER_LEVEL + 0.04);
    group.position.set(shoreX, baseY, shoreZ);
    this.group.add(group);
    this.docks.set(s.id, group);
    // Remember the water-end tip in world space so ships can launch from the actual pier.
    s.dockPoint = { x: shoreX + Math.cos(dir) * length, z: shoreZ + Math.sin(dir) * length };
  }

  removeDock(s) {
    const group = this.docks.get(s.id);
    if (!group) return;
    this.group.remove(group);
    // Only dispose geometry (built fresh per dock) — materials are shared module-level
    // constants (PLANK_MAT/POST_MAT) reused by every dock, so they must never be disposed.
    group.traverse(obj => { obj.geometry?.dispose?.(); });
    this.docks.delete(s.id);
    s.dockPoint = null;
  }

  // ---------- Towers (level 2+) and walls (level 3, "Gran ciudad") ----------
  addTower(s) {
    let tx = s.x, tz = s.z, found = false;
    for (const [cx, cz] of cityBoundary(s).polygon) {
      const [vx, vz] = this.world.worldToGrid(cx, cz);
      if (this.world.inBounds(vx, vz) && !this.world.isWater(vx, vz)) { tx = cx; tz = cz; found = true; break; }
    }
    if (!found) return;
    const y = this.world.heightAtWorld(tx, tz);
    const existing = this.towers.get(s.id);
    if (existing) {
      existing.position.set(tx, y, tz);
      for (const c of this.creatures.creatures) if (c.garrisonSettlementId === s.id) c.garrisonPos = { x: tx, z: tz };
      this._markNavigationObstaclesDirty();
      return;
    }
    const group = new THREE.Group();
    const towerPiece = WALL_PIECES.tower;
    const tower = new THREE.Mesh(towerPiece.geometry || TOWER_PLACEHOLDER_GEO, towerPiece.material || TOWER_PLACEHOLDER_MAT);
    tower.castShadow = true;
    tower.receiveShadow = true;
    const sentry = new THREE.Mesh(TOWER_SENTRY_GEO, TOWER_SENTRY_MAT);
    sentry.position.y = TOWER_REFERENCE_HEIGHT * 0.75; sentry.castShadow = false;
    group.add(tower, sentry);
    group.position.set(tx, y, tz);
    this.group.add(group);
    this.towers.set(s.id, group);
    this._markNavigationObstaclesDirty();
    ensureWallPieceRequested(towerPiece, (geometry, material) => {
      if (this.towers.get(s.id) !== group) return;
      tower.geometry = geometry;
      tower.material = material;
    });
  }

  removeTower(s) {
    const group = this.towers.get(s.id);
    if (!group) return;
    this.group.remove(group);
    this.towers.delete(s.id);
    this._markNavigationObstaclesDirty();
    const garrison = this.creatures.creatures.find(c => c.alive && c.garrison && c.garrisonSettlementId === s.id);
    if (garrison) {
      garrison.garrison = false;
      garrison.garrisonPos = null;
      garrison.garrisonSettlementId = null;
      garrison.archer = false;
      garrison.combatTarget = null;
      garrison.profession = 'Aldeano';
      garrison.economicRoleSet = false;
      if (garrison.model3d) detachWeapon(garrison.model3d);
    }
  }

  // Keeps exactly one live archer stationed at the settlement's tower, reassigning a
  // civilian resident whenever the post is empty (first build, or the previous guard died).
  _ensureGarrison(s) {
    const towerGroup = this.towers.get(s.id);
    if (!towerGroup) return;
    const current = this.creatures.creatures.find(c => c.alive && c.garrison && c.garrisonSettlementId === s.id);
    if (current) return;
    const candidates = this.creatures.creatures.filter(c =>
      c.alive && CIVILIZED_TYPES.includes(c.type) && c.settlementId === s.id &&
      c.role !== 'soldado' && !c.garrison && c.profession !== 'Rey' && c.age > 7);
    if (!candidates.length) return;
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    c.garrison = true;
    c.garrisonSettlementId = s.id;
    c.garrisonPos = { x: towerGroup.position.x, z: towerGroup.position.z };
    c.archer = true;
    c.weaponKind = 'bow';
    c.profession = 'Guardia';
    c.economicRoleSet = true;
    if (c.model3d) attachWeapon(c.model3d, 'bow');
  }

  addWall(s) {
    if (s.wallsBreached) return;
    const signature = JSON.stringify([s.x, s.z, s.level, [...s.houses, ...(s.farms || [])].map(h => [h.x, h.z]), this.world.navigationRevision]);
    if (this.walls.get(s.id)?.signature === signature) return;
    this.removeWall(s);
    const children = [];
    for (const piece of cityWallPieces(s)) {
      const { x, z, isGate, rotationY, width } = piece;
      const [vx, vz] = this.world.worldToGrid(x, z);
      if (!this.world.inBounds(vx, vz) || this.world.isWater(vx, vz)) continue;
      // Never drop a segment on top of a neighboring settlement's own houses.
      let blockedByNeighbor = false;
      for (const other of this.settlements) {
        if (other === s) continue;
        if (dist2(x, z, other.x, other.z) < 8 * 8) { blockedByNeighbor = true; break; }
      }
      if (blockedByNeighbor) continue;
      const y = this.world.heightAtWorld(x, z);
      const slot = isGate ? this.allocWallGateSlot() : this.allocWallSegmentSlot();
      if (slot == null) continue; // exhausted the (generous) global instance pool — skip, don't throw
      const quaternion = new THREE.Quaternion().setFromAxisAngle(_upAxisTmp, rotationY);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion, _unitScaleTmp);
      const mesh = isGate ? this.wallGateMesh : this.wallSegmentMesh;
      mesh.setMatrixAt(slot, matrix);
      mesh.instanceMatrix.needsUpdate = true;
      // A gate has an opening to walk through, unlike a solid run — _ensureNavigationObstacles()
      // skips flagged children so caravans/creatures can still pass where the old code simply
      // left this slot empty.
      children.push({ position: new THREE.Vector3(x, y, z), rotation: { y: rotationY }, quaternion, scale: _unitScaleTmp.clone(), slot, isGate, userData: { isGate, width } });
    }
    this.walls.set(s.id, { children, signature });
    this._syncWallModelTransforms();
    if (this.towers.has(s.id)) this.addTower(s);
    this._markNavigationObstaclesDirty();
  }

  _syncWallModelTransforms() {
    for (const wall of this.walls.values()) for (const piece of wall.children) {
      const mesh = piece.isGate ? this.wallGateMesh : this.wallSegmentMesh;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      piece.scale.x = piece.userData.width / Math.max(.001, bounds.max.x - bounds.min.x);
      mesh.setMatrixAt(piece.slot, new THREE.Matrix4().compose(piece.position, piece.quaternion, piece.scale));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  removeWall(s) {
    const wall = this.walls.get(s.id);
    if (!wall) return;
    for (const segment of wall.children) {
      const mesh = segment.isGate ? this.wallGateMesh : this.wallSegmentMesh;
      mesh.setMatrixAt(segment.slot, ZERO_MATRIX);
      mesh.instanceMatrix.needsUpdate = true;
      (segment.isGate ? this.freeWallGateSlots : this.freeWallSegmentSlots).push(segment.slot);
    }
    this.walls.delete(s.id);
    this._markNavigationObstaclesDirty();
  }

  _syncDefenses(s) {
    if (s.level >= TOWER_MIN_LEVEL) this.addTower(s); else this.removeTower(s);
    // The boundary follows occupied plots, even when construction doesn't change the level.
    if (s.level >= WALL_MIN_LEVEL) this.addWall(s); else this.removeWall(s);
  }

  breachWall(s) {
    if (!this.walls.has(s.id)) return false;
    s.wallsBreached = true;
    s.wallRepairRemaining = WALL_REPAIR.seconds;
    this.removeWall(s);
    return true;
  }

  _wallRepairBlock(s) {
    if (s.abandoned || s.pop <= 0) return 'sin habitantes';
    if (s.level < WALL_MIN_LEVEL) return 'requiere una gran ciudad';
    const empire = this.empires.find(e => e.id === s.empireId);
    if (!empire || [...empire.relations.values()].some(r => r.status === 'war')) return 'esperando la paz';
    if (!(s.resources?.wood >= WALL_REPAIR.wood && s.resources?.stone >= WALL_REPAIR.stone)) return 'requiere 15 de madera y 30 de piedra';
    return null;
  }

  describeWallRepair(s) {
    if (!s.wallsBreached) return null;
    return `Muralla derribada · ${this._wallRepairBlock(s) || `reconstrucción: ${Math.ceil(s.wallRepairRemaining ?? WALL_REPAIR.seconds)} s (15 madera, 30 piedra)`}`;
  }

  _updateWallRepair(s, dt) {
    if (!s.wallsBreached || !Number.isFinite(dt) || dt <= 0 || this._wallRepairBlock(s)) return;
    s.wallRepairRemaining = Math.max(0, (s.wallRepairRemaining ?? WALL_REPAIR.seconds) - dt);
    if (s.wallRepairRemaining > 0) return;
    s.resources.wood -= WALL_REPAIR.wood;
    s.resources.stone -= WALL_REPAIR.stone;
    s.wallsBreached = false;
    this.addWall(s);
    this.toast(`🏰 ${s.name} ha reconstruido sus murallas`);
  }

  // ---------- Trade routes and merchant caravans between allied empires ----------
  // A route's X/Z is fixed forever once two capitals ally (they never move), but everything
  // vertical — height, slope, whether a given stretch now falls in water — has to be able to
  // change any time the player reshapes the terrain underneath it. So route layout is split
  // in two: the node X/Z sequence is computed once, and _layoutRoute() (re)applies terrain to
  // it, callable either at creation or later from _refreshTradeRouteHeights() to keep a long
  // commerce road from ending up floating or buried after the ground changes.
  _pathNodesXZ(ax, az, bx, bz, dist, segCount, curveStrength) {
    const dx = bx - ax, dz = bz - az;
    const perpX = -dz / dist, perpZ = dx / dist;
    const nodes = [[ax, az]];
    for (let k = 1; k <= segCount; k++) {
      const t = k / segCount;
      const bend = Math.sin(t * Math.PI) * curveStrength;
      const wobble = Math.sin(t * Math.PI * 3.2) * Math.sin(t * Math.PI) * curveStrength * 0.3;
      nodes.push([ax + dx * t + perpX * (bend + wobble), az + dz * t + perpZ * (bend + wobble)]);
    }
    return nodes;
  }

  _layoutRoute(route, force = false) {
    this._sharedRoads ??= new Map();
    const revision = this.world.terrainMesh?.geometry.attributes.position.version || 0;
    if (!force && route.meshes && route.heightRevision === revision) return;
    route.heightRevision = revision;
    const fresh = !route.meshes;
    if (fresh) route.meshes = [];
    const bridges = planRiverBridges(this.world, route.nodes, .9);
    for (let k = 1; k < route.nodes.length; k++) {
      const key = roadEdgeKey(route.nodes[k - 1], route.nodes[k]);
      let mesh = this._sharedRoads.get(key);
      if (!mesh) {
        mesh = new THREE.Mesh(undefined, this.pathMesh.material);
        mesh.userData.owners = new Map();
        mesh.userData.roadKey = key;
        mesh.receiveShadow = true; mesh.renderOrder = 1;
        this.group.add(mesh); this._sharedRoads.set(key, mesh);
      }
      if (force || mesh.userData.heightRevision !== revision) {
        mesh.geometry.dispose();
        mesh.geometry = buildTerrainRoad(this.world, route.nodes.slice(k - 1, k + 1), 0.9, null, bridges);
        mesh.userData.heightRevision = revision;
        mesh.userData.overWater = mesh.geometry.attributes.position.count === 0;
      }
      route.meshes[k - 1] = mesh;
      if (!mesh.userData.owners.has(route)) mesh.userData.owners.set(route, false);
    }
    this._applyRouteVisibility(route);
    this._pathsDirty = true;
  }

  _disposeRoute(route) {
    for (const mesh of route.meshes || []) {
      mesh.userData.owners?.delete(route);
      if (!mesh.userData.owners?.size) {
        mesh.geometry.dispose(); this.group.remove(mesh);
        this._sharedRoads?.delete(mesh.userData.roadKey);
      } else mesh.visible = !mesh.userData.overWater && (mesh.userData.worn || [...mesh.userData.owners.values()].some(Boolean));
    }
    this.group.remove(route.group);
    this._pathsDirty = true;
  }

  // A river tile gets lifted to a small bridge-deck height above its own water surface instead
  // of following the carved riverbed — that's what makes the road read as crossing a bridge
  // instead of dipping underwater. True ocean is reported separately so _layoutRoute can still
  // break the road there (see _nodesCrossOcean's comment for why sea can't be bridged the
  // same way).
  _roadElevation(x, z) {
    const groundY = this.world.heightAtWorld(x, z);
    const bridgeY = this.world.bridgeHeightAtWorld?.(x, z);
    if (bridgeY != null) return { y: bridgeY, ocean: false };
    if (groundY <= CONFIG.WATER_LEVEL) return { y: groundY + 0.015, ocean: true };
    const [vx, vz] = this.world.worldToGrid(x, z);
    if (this.world.inBounds(vx, vz) && this.world.riverMask[this.world.idx(vx, vz)] === 1) {
      const waterY = this.world.riverHeight[this.world.idx(vx, vz)] || CONFIG.WATER_LEVEL;
      return { y: waterY + 0.3, ocean: false };
    }
    return { y: groundY + 0.015, ocean: false };
  }

  // Final per-segment visibility = not over water AND already "worn in" by the gradual
  // reveal below. Kept separate from _layoutRoute so a terrain-triggered height refresh
  // can't accidentally re-show a segment that hasn't finished revealing yet.
  _applyRouteVisibility(route) {
    const total = route.meshes.length;
    const revealCount = route.revealed ? total : Math.min(total, Math.floor((route.revealElapsed / route.revealDuration) * total));
    for (let i = 0; i < total; i++) {
      const show = i < revealCount && !route.meshes[i].userData.overWater;
      const mesh = route.meshes[i];
      const previousVisible = mesh.visible;
      mesh.userData.worn ||= show;
      mesh.userData.owners.set(route, show);
      mesh.visible = !mesh.userData.overWater && (mesh.userData.worn || [...mesh.userData.owners.values()].some(Boolean));
      if (mesh.visible !== previousVisible) this._pathsDirty = true;
    }
  }

  // A land road can't reach across open sea no matter how it's routed — two capitals separated
  // by ocean trade by ship instead (see ships.js's _launchTradeShip/_tryServiceLaunch, which
  // already runs independently of this system). A river is different: narrow enough to bridge,
  // so _layoutRoute() below keeps those segments visible instead of breaking the road there.
  _nodesCrossOcean(nodes) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[Math.max(0, i - 1)], b = nodes[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        if (this.world.heightAtWorld(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) <= CONFIG.WATER_LEVEL) return true;
      }
    }
    return false;
  }

  // A physical road network, independent of politics: every city gets exactly one entrance
  // (cityRoadAccess() in js/city-roads.js — three earlier attempts at picking a *better* gate per
  // trade destination all still produced several roads fanning out of one city, reported live with
  // screenshots each time) and connects, once and forever, to whichever already-connected city is
  // nearest to it — a classic nearest-neighbour minimum spanning tree. A city never gets a second
  // connection and an edge is never rebuilt just because a later city would make a shorter one
  // possible (explicitly requested live: a "more efficient" duplicate road to an already-connected
  // city is exactly the spaghetti the player doesn't want). The result is one shared backbone with
  // short branches, visible on the map regardless of who's at war with whom — real infrastructure,
  // not a per-trade-relationship line. Empire trade (below, _syncTradeRoutes) just finds the path
  // through this backbone between two capitals instead of building its own road.
  _syncRoadNetwork() {
    this._cityRoadDirections ??= new Map();
    this.roadNetwork ??= new Map();
    const cities = this.settlements;
    const cityIds = new Set(cities.map(c => c.id));
    for (const [key, route] of Array.from(this.roadNetwork)) {
      const [aId, bId] = key.split('|').map(Number);
      if (!cityIds.has(aId) || !cityIds.has(bId)) { this._disposeRoute(route); this.roadNetwork.delete(key); }
    }
    for (const id of this._cityRoadDirections.keys()) if (!cityIds.has(id)) this._cityRoadDirections.delete(id);
    const bounds = cities.map(cityRoadBounds);
    const connected = new Set();
    for (const key of this.roadNetwork.keys()) { const [a, b] = key.split('|').map(Number); connected.add(a); connected.add(b); }
    const eligible = cities.filter(c => !c.abandoned);
    let progress = true;
    while (progress) {
      progress = false;
      if (!connected.size) {
        let best = null;
        for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
          const d = Math.hypot(eligible[i].x - eligible[j].x, eligible[i].z - eligible[j].z);
          if (d < 4 || d > TRADE_ROUTE_MAX_DIST) continue;
          if (!best || d < best.d) best = { a: eligible[i], b: eligible[j], d };
        }
        if (!best) break;
        if (this._buildNetworkEdge(best.a, best.b, bounds)) { connected.add(best.a.id); connected.add(best.b.id); progress = true; }
        else break;
        continue;
      }
      for (const city of eligible.filter(c => !connected.has(c.id))) {
        const targets = eligible.filter(c => connected.has(c.id))
          .map(c => ({ c, d: Math.hypot(c.x - city.x, c.z - city.z) }))
          .filter(t => t.d >= 4 && t.d <= TRADE_ROUTE_MAX_DIST)
          .sort((p, q) => p.d - q.d);
        for (const { c: target } of targets) {
          if (this._buildNetworkEdge(city, target, bounds)) { connected.add(city.id); progress = true; break; }
        }
      }
    }
    this._syncAlternateRoads(bounds);
  }

  // A nearest-neighbour tree connecting cities scattered around a coastline naturally comes out
  // as one loop road wrapping the island, with no interior cross-links (reported live: "que no sea
  // solo un camino principal dandole la vuelta a la isla"). Once every city has its one required
  // connection, keep looking for a pair whose only route through that backbone is a real detour —
  // not just a slightly longer way, but one clearly worse than a direct road would be — and give
  // that pair a direct alternate. Existing edges are still never touched or rebuilt; this only ever
  // adds a new road alongside them, so the network keeps gaining useful cross-links over time
  // ("permite que los caminos se actualicen") instead of freezing solid the moment it's connected.
  _syncAlternateRoads(bounds) {
    const cities = this.settlements.filter(c => !c.abandoned);
    // A handful of genuine shortcuts reads as "a real road network"; letting every pair whose
    // detour clears some ratio grow its own chord converges toward a near-complete graph on
    // anything ring-shaped (a coastline is exactly that) — the same tangle of roads this whole
    // design exists to avoid, just spread across more pairs instead of one city. Capping the
    // total keeps it to a few deliberate cross-links.
    const cap = Math.max(1, Math.ceil(cities.length / 5));
    const alternates = this.roadNetwork.size - Math.max(0, cities.length - 1);
    if (alternates >= cap) return;
    let best = null;
    for (let i = 0; i < cities.length; i++) for (let j = i + 1; j < cities.length; j++) {
      const a = cities[i], b = cities[j];
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (this.roadNetwork.has(key)) continue;
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist < 4 || dist > TRADE_ROUTE_MAX_DIST) continue;
      const current = this._networkPath(a.id, b.id);
      if (!current) continue; // not part of the same component yet — the growth loop above handles that
      const ratio = nodesLength(current) / dist;
      // A real detour, not just a slightly longer way around — otherwise every close pair would
      // grow its own shortcut and the network would fill in as densely as the tangle of roads
      // this whole design replaced.
      if (ratio < 2.2) continue;
      if (!best || ratio > best.ratio) best = { a, b, ratio };
    }
    // One new alternate per sync at most, so the network visibly grows a cross-link at a time
    // instead of instantly filling in every shortcut the moment it becomes possible.
    if (best) this._buildNetworkEdge(best.a, best.b, bounds);
  }

  _buildNetworkEdge(cityA, cityB, bounds) {
    const accessFor = (city, target) => {
      const entry = cityRoadAccess(city, target, this.world, this._cityRoadDirections.get(city.id));
      this._cityRoadDirections.set(city.id, entry.direction);
      return entry;
    };
    const entryA = accessFor(cityA, cityB), entryB = accessFor(cityB, cityA);
    if (!entryA || !entryB) return false;
    const dist = Math.hypot(cityA.x - cityB.x, cityA.z - cityB.z);
    // Denser than a naive "one segment per few units" would suggest: each straight segment is a
    // flat chord between two ground-sampled nodes, so a hill or dip *between* two nodes that
    // neither node happens to land on doesn't get followed — the chord floats above a dip or cuts
    // through a bump, reading as the road hovering or sinking into the ground. Shorter chords
    // track the actual terrain more closely (reported after real play on rolling hills).
    const segCount = Math.max(10, Math.min(50, Math.round(dist / 3)));
    const curve = Math.min(dist * 0.12, 7);
    const allowed = path => outsideCities(path, bounds) && !this._nodesCrossOcean(path);
    const existingEdges = this.roadNetwork.values();
    const shared = existingRoadPath(entryA.entrance, entryB.entrance, existingEdges, path => !this._nodesCrossOcean(path));
    const curved = this._pathNodesXZ(...entryA.junction, ...entryB.junction, Math.hypot(entryB.junction[0] - entryA.junction[0], entryB.junction[1] - entryA.junction[1]), segCount, curve);
    const direct = allowed(curved) ? curved : exteriorRoad(entryA.junction, entryB.junction, bounds, path => !this._nodesCrossOcean(path));
    if (!direct && !shared) return false;
    const trunk = shared ? null : reuseRoadNetwork(direct, this.roadNetwork.values(), allowed);
    if (!trunk && !shared) return false;
    const nodes = shared || softenRoad([entryA.entrance, ...trunk, entryB.entrance], path => !this._nodesCrossOcean(path) && outsideCities(path.slice(1, -1), bounds), this.roadNetwork.values());
    const key = cityA.id < cityB.id ? `${cityA.id}|${cityB.id}` : `${cityB.id}|${cityA.id}`;
    const group = new THREE.Group();
    this.group.add(group);
    // The road doesn't snap into existence — it wears in gradually, one stretch at a time from
    // one city toward the other, then stays put for good (never rebuilt, see _syncRoadNetwork).
    const route = { group, cityA: cityA.id, cityB: cityB.id, nodes, revealElapsed: 0, revealDuration: Math.max(2, segCount * 0.35), revealed: false };
    this._layoutRoute(route);
    this.roadNetwork.set(key, route);
    return true;
  }

  // The shortest path between two cities through the backbone (or null if they're not part of the
  // same connected component yet — separated by ocean, or too far apart to have linked up). Plain
  // BFS found *a* path when the backbone was strictly a tree (only ever one to find); now that
  // _syncAlternateRoads can add cross-links, more than one path can exist, so this needs actual
  // shortest-path-by-road-distance to make use of an alternate instead of ignoring it.
  _networkPath(startId, endId) {
    if (startId === endId) return null;
    const adjacency = new Map();
    for (const route of this.roadNetwork.values()) {
      const len = nodesLength(route.nodes);
      if (!adjacency.has(route.cityA)) adjacency.set(route.cityA, []);
      if (!adjacency.has(route.cityB)) adjacency.set(route.cityB, []);
      adjacency.get(route.cityA).push({ to: route.cityB, route, reversed: false, len });
      adjacency.get(route.cityB).push({ to: route.cityA, route, reversed: true, len });
    }
    const dist = new Map([[startId, 0]]), previous = new Map([[startId, null]]), visited = new Set();
    for (;;) {
      let current = null, currentDist = Infinity;
      for (const [id, d] of dist) if (!visited.has(id) && d < currentDist) { current = id; currentDist = d; }
      if (current == null || current === endId) break;
      visited.add(current);
      for (const edge of adjacency.get(current) || []) {
        const next = currentDist + edge.len;
        if (next < (dist.get(edge.to) ?? Infinity)) { dist.set(edge.to, next); previous.set(edge.to, { from: current, edge }); }
      }
    }
    if (!previous.get(endId)) return null;
    const chain = [];
    for (let id = endId; id !== startId;) { const step = previous.get(id); chain.push(step.edge); id = step.from; }
    chain.reverse();
    const nodes = [];
    for (const { route, reversed } of chain) {
      const segment = reversed ? [...route.nodes].reverse() : route.nodes;
      if (nodes.length && nodes.at(-1)[0] === segment[0][0] && nodes.at(-1)[1] === segment[0][1]) nodes.push(...segment.slice(1));
      else nodes.push(...segment);
    }
    return nodes.length ? nodes : null;
  }

  _syncTradeRoutes() {
    this._syncRoadNetwork();
    const activeEmpires = this.empires.filter(e => this.settlements.some(x => x.empireId === e.id));
    const previousRoutes = new Map(this.tradeRoutes);
    // Keep established routes across diplomacy changes and unrelated city growth — the physical
    // road (built above, independent of politics) never changes, so the route between two capitals
    // shouldn't either, war or no war.
    const seen = new Set();
    for (let i = 0; i < activeEmpires.length; i++) {
      for (let j = i + 1; j < activeEmpires.length; j++) {
        const a = activeEmpires[i], b = activeEmpires[j];
        const capA = this.settlements.find(x => x.id === a.capitalId);
        const capB = this.settlements.find(x => x.id === b.capitalId);
        if (!capA || !capB || capA.abandoned || capB.abandoned) continue;
        const dist = Math.hypot(capA.x - capB.x, capA.z - capB.z);
        if (dist > TRADE_ROUTE_MAX_DIST || dist < 4) continue;
        const nodes = this._networkPath(capA.id, capB.id);
        if (!nodes) continue;
        const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
        const existing = this.tradeRoutes.get(key);
        if (existing) {
          const same = existing.capA === capA.id && existing.capB === capB.id &&
            existing.nodes.length === nodes.length && existing.nodes.every((p, k) => p[0] === nodes[k][0] && p[1] === nodes[k][1]);
          if (same) { seen.add(key); continue; }
          this._disposeRoute(existing);
          this.tradeRoutes.delete(key);
        }
        seen.add(key);
        const group = new THREE.Group();
        this.group.add(group);
        const route = {
          group, capA: capA.id, capB: capB.id, nodes,
          revealElapsed: previousRoutes.get(key)?.revealElapsed || 0,
          revealDuration: previousRoutes.get(key)?.revealDuration || Math.max(2, Math.round(nodes.length / 3) * 0.35),
          revealed: previousRoutes.get(key)?.revealed || false,
        };
        this._layoutRoute(route);
        this.tradeRoutes.set(key, route);
      }
    }
    for (const [key, route] of Array.from(this.tradeRoutes)) {
      if (!seen.has(key)) { this._disposeRoute(route); this.tradeRoutes.delete(key); }
    }
    for(const merchant of this.merchants || []) {
      const ids=[merchant.empireAId,merchant.empireBId].sort((a,b)=>a-b),route=this.tradeRoutes.get(ids.join('-'));
      if(!route)continue;
      const origin=this.empires.find(e=>e.id===merchant.empireAId)?.capitalId;
      const progress=merchant.t/merchant.duration;
      merchant.nodes=route.capA===origin?route.nodes:[...route.nodes].reverse();
      merchant.duration=Math.max(8,nodesLength(merchant.nodes)/4);
      merchant.t=progress*merchant.duration;
    }
  }

  _refreshTradeRouteHeights() {
    for (const route of this.tradeRoutes.values()) this._layoutRoute(route);
    for (const route of this.roadNetwork?.values() ?? []) this._layoutRoute(route);
  }

  // Fired straight off world:terrainChanged (see game-session.js) so a road resyncs to new
  // terrain the instant it's edited, instead of waiting up to UPDATE_INTERVAL for the periodic
  // sweep above — that lag is what made a freshly raised or flooded area look like it still had
  // the old (floating/buried) road sitting on it for a second or two after the edit.
  onTerrainChanged(bounds) {
    if (!bounds) return;
    // Edits may intersect the middle of a path even if neither endpoint is nearby.
    for (const route of this.tradeRoutes.values()) this._layoutRoute(route, true);
    for (const route of this.roadNetwork?.values() ?? []) this._layoutRoute(route, true);
    for (const s of this.settlements) for (const house of s.houses) this._syncPathInstance(s, house, true);
    this._flushHousePaths();
  }

  _tickRouteReveal(route, dt) {
    if (route.revealed) return;
    route.revealElapsed += dt;
    const total = route.meshes.length;
    if (Math.floor((route.revealElapsed / route.revealDuration) * total) >= total) route.revealed = true;
    this._applyRouteVisibility(route);
  }

  _updateTradeRouteReveal(dt) {
    for (const route of this.tradeRoutes.values()) this._tickRouteReveal(route, dt);
    for (const route of this.roadNetwork?.values() ?? []) this._tickRouteReveal(route, dt);
  }

  _buildMerchantMesh() {
    const g = new THREE.Group();
    const add = (geometry, material, x, y, z, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      if (rz) mesh.rotation.z = rz;
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    // Bed + side rails.
    add(MERCHANT_CART_GEO, MERCHANT_CART_MAT, 0, 0.23, 0);
    add(MERCHANT_RAIL_GEO, MERCHANT_RAIL_MAT, 0, 0.32, 0);
    // Two large spoked wheels, one each side.
    for (const side of [-1, 1]) {
      add(MERCHANT_WHEEL_GEO, MERCHANT_WHEEL_MAT, side * 0.21, 0.15, 0, Math.PI / 2);
      add(MERCHANT_HUB_GEO, MERCHANT_HUB_MAT, side * 0.21, 0.15, 0, Math.PI / 2);
    }
    // Draw shafts reaching out the front, like a hand- or animal-pulled market cart.
    for (const side of [-1, 1]) add(MERCHANT_SHAFT_GEO, MERCHANT_POLE_MAT, side * 0.12, 0.2, -0.53, Math.PI / 2 - side * 0.06);
    // Corner poles holding up a peaked, striped awning.
    for (const x of [-0.17, 0.17]) for (const z of [-0.24, 0.24]) add(MERCHANT_POLE_GEO, MERCHANT_POLE_MAT, x, 0.48, z);
    add(MERCHANT_CANOPY_LEFT_GEO, MERCHANT_CANOPY_MAT, 0, 0.63, 0);
    add(MERCHANT_CANOPY_RIGHT_GEO, MERCHANT_CANOPY_STRIPE_MAT, 0, 0.63, 0);
    // A couple of goods crates riding in the bed.
    add(MERCHANT_CRATE_GEO, MERCHANT_CRATE_MAT, -0.08, 0.35, 0.1);
    add(MERCHANT_CRATE_GEO, MERCHANT_CRATE_MAT, 0.09, 0.35, -0.08);
    return g;
  }

  _trySendMerchant() {
    if (this.merchants.length >= 6) return;
    const activeEmpires = this.empires.filter(e => this.settlements.some(x => x.empireId === e.id));
    if (activeEmpires.length < 2) return;
    const a = activeEmpires[Math.floor(Math.random() * activeEmpires.length)];
    const candidates = activeEmpires.filter(b => b.id !== a.id && a.relations.get(b.id)?.status !== 'war');
    if (!candidates.length) return;
    const b = candidates[Math.floor(Math.random() * candidates.length)];
    const capA = this.settlements.find(x => x.id === a.capitalId);
    const capB = this.settlements.find(x => x.id === b.capitalId);
    if (!capA || !capB) return;
    const dist = Math.hypot(capA.x - capB.x, capA.z - capB.z);
    if (dist < 4 || dist > TRADE_ROUTE_MAX_DIST || Math.random() > 0.35) return;
    // A land cart can only follow an actual road — capitals with open sea between them (no entry
    // in tradeRoutes; see _syncTradeRoutes's _nodesCrossOcean check) trade by ship instead, via
    // ships.js's own independent _launchTradeShip/_tryServiceLaunch. Skip spawning a cart here
    // rather than let it drive a straight line across the water.
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    const route = this.tradeRoutes.get(key);
    if (!route) return;
    const nodes = route.capA === capA.id ? route.nodes : [...route.nodes].reverse();
    const mesh = this._buildMerchantMesh();
    mesh.position.set(nodes[0][0], this.world.heightAtWorld(...nodes[0]) + 0.02, nodes[0][1]);
    this.group.add(mesh);
    this.merchants.push({
      mesh, nodes, empireAId: a.id, empireBId: b.id, t: 0, duration: Math.max(8, nodesLength(nodes) / 4),
    });
  }

  _updateMerchants(dt) {
    if (!this.merchants.length) return;
    for (const m of this.merchants.slice()) {
      m.t += dt;
      const p = Math.min(1, m.t / m.duration);
      const { x, z, heading } = sampleNodes(m.nodes, p);
      m.mesh.position.set(x, (this.world.bridgeHeightAtWorld?.(x, z) ?? this.world.heightAtWorld(x, z)) + 0.02, z);
      m.mesh.rotation.y = heading;
      if (p >= 1) {
        const bonus = 6 + Math.random() * 6;
        const empireA = this.empires.find(e => e.id === m.empireAId);
        const empireB = this.empires.find(e => e.id === m.empireBId);
        const capA = empireA && this.settlements.find(x => x.id === empireA.capitalId);
        const capB = empireB && this.settlements.find(x => x.id === empireB.capitalId);
        const applyBonus = cap => { if (cap?.resources) cap.resources.gold = Math.min(RESOURCE_CAP_BASE + cap.level * 80, (cap.resources.gold || 0) + bonus); };
        applyBonus(capA);
        applyBonus(capB);
        if (empireA && empireB) this.toast(`🛒 Una caravana comercial conecta ${empireA.name} y ${empireB.name}`, { history: false });
        this.group.remove(m.mesh);
        this.merchants = this.merchants.filter(x => x !== m);
      }
    }
  }

  removeSettlement(s) {
    for (const h of s.houses) this.removeHouse(h);
    for (const f of s.farms) this.removeFarm(f);
    this._removeFlag(s);
    this.removeDock(s);
    this.removeLabel(s);
    this.removeTower(s);
    this.removeWall(s);
    if (!this._preserveCreatureState) {
      for (const c of this.creatures.creatures) if (c.settlementId === s.id) this.creatures.clearHome(c);
    }
    this.settlements = this.settlements.filter(x => x !== s);
    const empire = this.empires.find(e => e.id === s.empireId);
    if (empire && empire.capitalId === s.id) {
      const remaining = this.settlements.filter(x => x.empireId === s.empireId);
      empire.capitalId = remaining.length ? remaining[0].id : null;
    }
    if (!this._preserveCreatureState) this._cleanupExtinctEmpires();
  }

  // A settlement that has sat empty too long is no longer torn down — its houses, walls and
  // tower stay standing as a gray, uninhabited ruin (see reclaimSettlement) instead of the
  // whole city vanishing the moment its last resident dies, which used to erase settlements
  // that had never even had a chance to reach the wall threshold.
  abandonSettlement(s) {
    if (s.abandoned) return;
    s.abandoned = true;
    s.pop = 0;
    s.emptyTimer = 0;
    s.loyalty = 0;
    const oldEmpireId = s.empireId;
    s.empireId = null;
    s.race = null;
    this.removeTower(s);
    this.removeWall(s);
    for (const h of s.houses) {
      if (h.slot == null) continue;
      this._setHouseColor(h, ABANDONED_HOUSE_COLOR);
    }
    this._markHouseColorsDirty();
    if (s.flagGroup) s.flagGroup.visible = false;
    this._syncLabel(s);
    if (this.territoryMesh.visible) this.scheduleTerritoryUpdate();
    this.toast(`🏚️ ${s.name} queda abandonada — sus casas esperan nuevos colonos`);
    const empire = oldEmpireId != null ? this.empires.find(e => e.id === oldEmpireId) : null;
    if (empire && empire.capitalId === s.id) {
      const remaining = this.settlements.filter(x => x.empireId === empire.id && x.id !== s.id);
      empire.capitalId = remaining.length ? remaining[0].id : null;
    }
    this._cleanupExtinctEmpires();
    this._markNavigationObstaclesDirty();
  }

  // A wandering cluster that settles near an abandoned settlement's ruins moves back into
  // its standing houses and restarts it (new empire ownership, restored colors, defenses
  // rebuilt if the surviving house count still qualifies) instead of always founding a
  // fresh settlement from a single hut nearby.
  reclaimSettlement(s, members, race = 'human') {
    s.abandoned = false;
    s.race = race;
    s.emptyTimer = 0;
    s.loyalty = 100;
    s.growTimer = 2 + Math.random() * 2;
    let empireId = this.nearestEmpireId(s.x, s.z, EMPIRE_JOIN_DIST);
    let isNewEmpire = false;
    if (empireId == null) { empireId = this.createEmpire().id; isNewEmpire = true; }
    s.empireId = empireId;
    if (!s.houses.length) this.addHouse(s);
    for (const h of s.houses) this._syncHouseInstance(s, h, true);
    if (!s.flagGroup) this.addFlag(s);
    else { s.flagGroup.visible = true; this.updateFlag(s); }
    if (members.length >= 2 && CIVILIZED_TYPES.includes(race)) {
      const hasMale = members.some(member => member.sex === 'm');
      const hasFemale = members.some(member => member.sex === 'f');
      if (!hasMale) members[0].sex = 'm';
      if (!hasFemale) members[1].sex = 'f';
    }
    for (const m of members) this.creatures.setHome(m, s.id, empireId, s.x, s.z, RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0]);
    const empire = this.empires.find(e => e.id === empireId);
    if (isNewEmpire) {
      empire.capitalId = s.id;
      members[0].profession = 'Rey';
      empire.kingId = members[0].id;
      this.toast(`👑 Colonos reconstruyen las ruinas de ${s.name} y fundan ${empire.name}`);
    } else {
      members[0].profession = 'Líder';
      this.toast(`🏚️➡️🏘️ Colonos de ${empire.name} reclaman las ruinas de ${s.name}`);
    }
    this._setSettlementLevel(s, this._levelForHouseCount(s.houses.length), false);
    this._syncDefenses(s);
    this._syncLabel(s);
    this._markNavigationObstaclesDirty();
  }

  foundSettlement(cx, cz, members, race = 'human') {
    const id = this.nextSettlementId++;
    let empireId = this.nearestEmpireId(cx, cz, EMPIRE_JOIN_DIST);
    let isNewEmpire = false;
    if (empireId == null) { empireId = this.createEmpire().id; isNewEmpire = true; }
    const s = {
      id, x: cx, z: cz, level: 0, houses: [], farms: [], empireId, race,
      growTimer: 2 + Math.random() * 2, name: this.genSettlementName(), pop: 0, emptyTimer: 0, loyalty: 100,
      resources: { wood: 20, food: 20, stone: 15, gold: 0, gems: 0 },
    };
    this.settlements.push(s);
    this._prepareSettlementGround(s, 0);
    this.addHouse(s);
    this.addFlag(s);
    this._maybeAddDock(s);
    this.addLabel(s);
    // Procedural groups can randomly contain a single sex, permanently preventing the
    // village from starting a family line. Keep generated founding populations viable.
    if (members.length >= 2 && CIVILIZED_TYPES.includes(race)) {
      const hasMale = members.some(member => member.sex === 'm');
      const hasFemale = members.some(member => member.sex === 'f');
      if (!hasMale) members[0].sex = 'm';
      if (!hasFemale) members[1].sex = 'f';
    }
    // assignEconomicRole() rolls each citizen's job independently (26% Aldeano, 19% Agricultor,
    // the rest produce no food at all) the first time updateEconomy() sees them — for a
    // minimum-size 3-colonist founding, that's roughly a 1-in-6 chance none of them land on a
    // food-producing role, and a brand-new settlement starts with only a 20-food stockpile and
    // no farms yet. That colony then starves out with no warning and no attacker, which is a bug,
    // not "bad luck": every other founding safeguard here (sex balance above) exists for the same
    // reason — a randomly-generated founding population shouldn't be able to roll into a
    // guaranteed dead end. Force the last member into a farmer so day one always has some food
    // income; members[0]/[1] are left alone since they're about to become Rey/Líder below (and
    // members[1] may already be pinned to a sex above).
    if (members.length >= 3 && CIVILIZED_TYPES.includes(race)) {
      const founder = members[members.length - 1];
      founder.profession = 'Agricultor';
      founder.economicRoleSet = true;
    }
    for (const m of members) this.creatures.setHome(m, id, empireId, cx, cz, RADIUS_BY_LEVEL[0]);
    const empire = this.empires.find(e => e.id === empireId);
    if (isNewEmpire) {
      empire.capitalId = s.id;
      members[0].profession = 'Rey';
      empire.kingId = members[0].id;
      this.toast(`👑 Nace ${empire.name}, fundado en ${s.name}`);
    } else {
      members[0].profession = 'Líder';
      this.toast(`🏘️ Nueva aldea: ${s.name} (${empire.name})`);
    }
  }

  tryFoundSettlements() {
    for (const race of CIVILIZED_TYPES) this._tryFoundForRace(race);
  }

  _tryFoundForRace(race) {
    const pool = this.creatures.creatures.filter(c => c.alive && c.type === race && !c.settlementId && c.age > 6);
    const used = new Set();
    for (const c of pool) {
      if (used.has(c.id)) continue;
      const ruin = this._nearestAbandonedSettlement(c.x, c.z, RECLAIM_RADIUS);
      if (ruin) {
        const settlers = pool.filter(o => !used.has(o.id) && dist2(o.x, o.z, ruin.x, ruin.z) <= RECLAIM_RADIUS * RECLAIM_RADIUS);
        if (settlers.length >= FOUND_MIN_MEMBERS) {
          this.reclaimSettlement(ruin, settlers, race);
          for (const o of settlers) used.add(o.id);
        }
        continue;
      }
      if (this.nearestSettlementDist(c.x, c.z) < MIN_SETTLEMENT_DIST) continue;
      const cluster = pool.filter(o => !used.has(o.id) && dist2(o.x, o.z, c.x, c.z) <= FOUND_CLUSTER_RADIUS * FOUND_CLUSTER_RADIUS);
      if (cluster.length < FOUND_MIN_MEMBERS) continue;
      let cx = 0, cz = 0;
      for (const o of cluster) { cx += o.x; cz += o.z; }
      cx /= cluster.length; cz /= cluster.length;
      const [vx, vz] = this.world.worldToGrid(cx, cz);
      if (this.world.isWater(vx, vz) || !this.world.isFlatEnough(vx, vz, 1.6)) continue;
      this.foundSettlement(cx, cz, cluster, race);
      for (const o of cluster) used.add(o.id);
    }
  }

  emigrateOne(s) {
    const candidates = this.creatures.creatures.filter(c => c.alive && c.settlementId === s.id && c.age > 8);
    if (!candidates.length) return;
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    this.creatures.clearHome(c);
    const ang = Math.random() * Math.PI * 2;
    // Far enough to clear MIN_SETTLEMENT_DIST from the home village in most directions, so an
    // emigrant is more likely to actually reach open land (or a reclaimable ruin) instead of
    // just resettling 15 units away and starting yet another cluster of tiny hamlets.
    const dist = 20 + Math.random() * 16;
    c.target = { x: s.x + Math.cos(ang) * dist, z: s.z + Math.sin(ang) * dist };
  }

  _levelForHouseCount(houseCount) {
    let level = 0;
    for (let i = LEVEL_HOUSE_THRESHOLD.length - 1; i >= 0; i--) {
      if (houseCount >= LEVEL_HOUSE_THRESHOLD[i]) { level = i; break; }
    }
    return level;
  }

  _setSettlementLevel(s, newLevel, announce = true) {
    const clampedLevel = Math.max(0, Math.min(LEVEL_NAMES.length - 1, Math.floor(newLevel)));
    const previousLevel = s.level;
    s.level = clampedLevel;
    this.updateFlag(s);
    this._syncResidentHomes(s);
    if (announce && previousLevel !== clampedLevel) this.onLevelUp(s, previousLevel);
  }

  // Levels the ground under a settlement to its own center height and clears trees so houses
  // don't end up tilted, half-buried, or growing through a tree (reported after real play), then
  // marks it as the settlement's dirt plaza (see colorAt() in world.js). Re-run with a larger
  // radius on every level-up, since RADIUS_BY_LEVEL grows with the settlement and new houses
  // would otherwise land on raw, untouched terrain past the original founding radius.
  _prepareSettlementGround(s, level) {
    const [vx, vz] = this.world.worldToGrid(s.x, s.z);
    if (!this.world.inBounds(vx, vz)) return;
    // Matches addHouse()'s own max placement distance (1.2 + RADIUS_BY_LEVEL[level]) plus a
    // little slack for a house's own footprint, so the plaza actually covers every spot a house
    // can land on, not just the bare RADIUS_BY_LEVEL ring.
    const radius = RADIUS_BY_LEVEL[level] + 2;
    const targetHeight = this.world.heightAtWorld(s.x, s.z);
    this.world.flattenArea(vx, vz, radius, targetHeight);
    this.world.markSettlementGround(vx, vz, radius);
  }

  onLevelUp(s, previousLevel = Math.max(0, s.level - 1)) {
    this.updateFlag(s);
    this._syncResidentHomes(s);
    this._syncDefenses(s);
    if (s.level > previousLevel) { this._prepareSettlementGround(s, s.level); this._maybeAddDock(s); }
    const empire = this.empires.find(e => e.id === s.empireId);
    const direction = s.level >= previousLevel ? '⬆️' : '⬇️';
    const verb = s.level >= previousLevel ? 'asciende' : 'desciende';
    this.toast(`${direction} ${s.name} ${verb} a ${LEVEL_NAMES[s.level]} (${empire ? empire.name : ''})`);
  }

  validateTerrain(announceLevelChanges = true) {
    for (const s of this.settlements.slice()) {
      const houses = [];
      for (const house of s.houses) {
        const [vx, vz] = this.world.worldToGrid(house.x, house.z);
        if (this.world.isWater(vx, vz)) this.removeHouse(house);
        else {
          this._syncHouseInstance(s, house);
          // Unconditional (not gated by the house's own groundY changing) — a mid-route
          // elevation edit that leaves the house itself untouched would otherwise never
          // resync the path segments passing over it, leaving them floating or buried.
          this._syncPathInstance(s, house);
          houses.push(house);
        }
      }
      s.houses = houses;

      const farms = [];
      for (const farm of s.farms || []) {
        const [vx, vz] = this.world.worldToGrid(farm.x, farm.z);
        if (this.world.isWater(vx, vz)) this.removeFarm(farm);
        else { this._syncFarmInstance(farm); farms.push(farm); }
      }
      s.farms = farms;

      this.updateFlag(s);
      const newLevel = this._levelForHouseCount(s.houses.length);
      if (newLevel !== s.level) this._setSettlementLevel(s, newLevel, announceLevelChanges && !s.abandoned);
      else this._syncResidentHomes(s);
    }
  }

  assignEconomicRole(c, s) {
    if (c.economicRoleSet) return;
    c.economicRoleSet = true;
    // Lumberjacks are capped per settlement (scaling gently with level) so a growing city
    // doesn't field an ever-larger logging crew that clear-cuts the surrounding forest.
    const lumberjackCap = LUMBERJACK_CAP_BASE + s.level;
    const currentLumberjacks = this.creatures.creatures.filter(o => o.alive && o.settlementId === s.id && o.profession === 'Leñador').length;
    const roll = Math.random();
    let acc = 0;
    for (let i = 0; i < ECONOMIC_ROLES.length; i++) {
      acc += ECONOMIC_ROLE_WEIGHTS[i];
      if (roll < acc) {
        const role = ECONOMIC_ROLES[i];
        c.profession = (role === 'Leñador' && currentLumberjacks >= lumberjackCap) ? 'Aldeano' : role;
        return;
      }
    }
    c.profession = 'Aldeano';
  }

  updateEconomy(s, dt) {
    let wood = 0, food = 0, stone = 0, gold = 0, gems = 0, miners = 0;
    for (const c of this.creatures.creatures) {
      if (!c.alive || !CIVILIZED_TYPES.includes(c.type) || c.settlementId !== s.id || c.role === 'soldado') continue;
      if (c.age > 6 && c.profession === 'Aldeano') this.assignEconomicRole(c, s);
      switch (c.profession) {
        case 'Leñador': wood += 0.2; break; // baseline only — most wood now comes from actually chopping trees (see creatures.js _chopTree)
        case 'Agricultor': food += 1.1; break;
        case 'Constructor': break;
        case 'Minero': miners++; break;
        default: wood += 0.12; food += 0.12;
      }
    }
    if (miners > 0 && !this.civilizationSystem) {
      const mined = this.world.mineNearest?.(s.x, s.z, miners * 0.42 * dt, 24);
      if (mined?.type === 'stone') stone += mined.amount;
      else if (mined?.type === 'gold') gold += mined.amount;
      else if (mined?.type === 'gems') gems += mined.amount;
    }
    food += s.farms.length * 0.8;
    const productivity = this.civilizationSystem?.productivityMultiplier?.(s) || 1;
    wood *= productivity; food *= productivity; stone *= productivity; gold *= productivity; gems *= productivity;
    const cap = RESOURCE_CAP_BASE + s.level * 80 + (this.civilizationSystem?.storageBonus?.(s) || 0);
    s.resources.wood = Math.min(cap, s.resources.wood + wood * dt);
    s.resources.food = Math.min(cap, s.resources.food + food * dt);
    s.resources.stone = Math.min(cap, s.resources.stone + stone * dt);
    s.resources.gold = Math.min(cap, (s.resources.gold || 0) + gold * dt);
    s.resources.gems = Math.min(cap * 0.3, (s.resources.gems || 0) + gems * dt);
    this._updateWallRepair(s, dt);
  }

  growSettlements(dt) {
    for (const s of this.settlements.slice()) {
      if (s.abandoned) continue;
      this._syncResidentHomes(s);
      s.pop = this.creatures.creatures.filter(c => c.alive && c.settlementId === s.id).length;
      if (s.pop <= 0) {
        s.emptyTimer += dt;
        if (s.emptyTimer > 45) this.abandonSettlement(s);
        continue;
      }
      s.emptyTimer = 0;
      this._syncLabel(s);
      this._ensureGarrison(s);
      this.updateEconomy(s, dt);
      s.growTimer -= dt;
      if (s.growTimer > 0) continue;
      const capacity = s.houses.length * 4;
      if (s.pop >= Math.max(3, capacity - 2) && s.houses.length < 36) {
        if (s.resources.wood >= HOUSE_COST.wood && s.resources.stone >= HOUSE_COST.stone) {
          if (this.addHouse(s)) { s.resources.wood -= HOUSE_COST.wood; s.resources.stone -= HOUSE_COST.stone; }
          s.growTimer = 6 + Math.random() * 4;
        } else {
          s.growTimer = 2.5 + Math.random() * 2;
        }
      } else {
        s.growTimer = 5 + Math.random() * 4;
      }
      const agricultores = this.creatures.creatures.filter(c => c.alive && c.settlementId === s.id && c.profession === 'Agricultor').length;
      if (agricultores > 0 && s.farms.length < MAX_FARMS_PER_SETTLEMENT &&
          s.resources.wood >= FARM_COST.wood && s.resources.stone >= FARM_COST.stone && Math.random() < 0.3) {
        if (this.addFarm(s)) { s.resources.wood -= FARM_COST.wood; s.resources.stone -= FARM_COST.stone; }
      }
      if (s.resources.gold >= HOUSE_UPGRADE_COST.gold && s.resources.stone >= HOUSE_UPGRADE_COST.stone && Math.random() < 0.4) {
        const plainHouses = s.houses.filter(h => !h.tier);
        if (plainHouses.length) {
          const house = plainHouses[Math.floor(Math.random() * plainHouses.length)];
          if (this.upgradeHouse(s, house)) {
            s.resources.gold -= HOUSE_UPGRADE_COST.gold;
            s.resources.stone -= HOUSE_UPGRADE_COST.stone;
            this.toast(`🏠 ${s.name} mejora una vivienda con piedra y oro`);
          }
        }
      }
      const newLevel = this._levelForHouseCount(s.houses.length);
      if (newLevel !== s.level) this._setSettlementLevel(s, newLevel);
      // Emigration is a release valve for genuine overcrowding (population well past what the
      // current houses support), not a flat tax on any settlement past 3 houses — the old
      // unconditional 12%-per-cycle chance bled population out of every growing village before
      // it could ever accumulate enough houses to level up, let alone reach the wall threshold,
      // and kept splintering the map into dozens of stalled hamlets instead of a few real towns.
      if (s.houses.length >= LEVEL_HOUSE_THRESHOLD[1] && s.pop > capacity + 4 && Math.random() < 0.05) this.emigrateOne(s);
    }
  }

  reset(options = {}) {
    const preserveCreatureState = options.preserveCreatureState === true;
    this._preserveCreatureState = preserveCreatureState;
    try {
      for (const s of this.settlements.slice()) this.removeSettlement(s);
    } finally {
      this._preserveCreatureState = false;
    }
    this.settlements = [];
    this.empires = [];
    this.slotOwner.clear();
    this.freeHouseSlots = [];
    this.nextHouseSlot = 0;
    this.freeFarmSlots = [];
    this.nextFarmSlot = 0;
    this.nextEmpireId = 1;
    this.nextSettlementId = 1;
    this._tick = 0;
    this._diploTick = 0;
    for (const route of this.tradeRoutes.values()) this._disposeRoute(route);
    this.tradeRoutes.clear();
    for (const route of this.roadNetwork.values()) this._disposeRoute(route);
    this.roadNetwork.clear();
    this._cityRoadDirections?.clear();
    for (const geometry of this.housePaths.values()) geometry.dispose();
    this.housePaths.clear(); this._pathsDirty = true; this._flushHousePaths();
    for (const m of this.merchants) { this.group.remove(m.mesh); m.mesh.traverse(o => { o.geometry?.dispose?.(); }); }
    this.merchants = [];
    this._navigationObstacles = [];
    this._obstacleSpatialIndex.clear();
    this._navigationObstaclesDirty = true;
    if (this.territoryMesh.visible) this.scheduleTerritoryUpdate();
  }

  serialize() {
    this._cleanupExtinctEmpires();
    return {
      version: SAVE_VERSION,
      nextSettlementId: this.nextSettlementId,
      nextEmpireId: this.nextEmpireId,
      tick: this._tick,
      diploTick: this._diploTick,
      settlements: this.settlements.map(s => ({
        id: s.id,
        x: s.x,
        z: s.z,
        level: s.level,
        empireId: s.empireId,
        race: s.race,
        abandoned: !!s.abandoned,
        wallsBreached: !!s.wallsBreached,
        wallRepairRemaining: s.wallsBreached ? (s.wallRepairRemaining ?? WALL_REPAIR.seconds) : 0,
        growTimer: s.growTimer,
        name: s.name,
        pop: s.pop,
        emptyTimer: s.emptyTimer,
        loyalty: s.loyalty,
        resources: {
          wood: s.resources?.wood || 0,
          food: s.resources?.food || 0,
          stone: s.resources?.stone || 0,
          gold: s.resources?.gold || 0,
          gems: s.resources?.gems || 0,
          ore: s.resources?.ore || 0,
          fish: s.resources?.fish || 0,
          tools: s.resources?.tools || 0,
          weapons: s.resources?.weapons || 0,
          armor: s.resources?.armor || 0,
          goods: s.resources?.goods || 0,
        },
        houses: (s.houses || []).map(h => ({
          x: h.x,
          z: h.z,
          scaleMul: Number.isFinite(h.scaleMul) ? h.scaleMul : 1,
          rotationY: Number.isFinite(h.rotationY) ? h.rotationY : 0,
          tier: h.tier ? 1 : 0,
          gridPlot: !!h.gridPlot,
          variant: Number.isInteger(h.variant) ? h.variant : 0,
        })),
        farms: (s.farms || []).map(f => ({ x: f.x, z: f.z, gridPlot: !!f.gridPlot })),
      })),
      empires: this.empires.map(e => ({
        id: e.id,
        name: e.name,
        color: e.color.getHex(),
        capitalId: e.capitalId,
        kingId: e.kingId,
        relations: Array.from(e.relations.entries()).map(([empireId, rel]) => ({
          empireId,
          status: rel.status === 'war' ? 'war' : 'peace',
          tension: rel.tension || 0,
          warTime: rel.warTime || 0,
          opinion: Number(rel.opinion ?? 45),
          treatyTime: rel.treatyTime || 0,
          warGoal: rel.warGoal ?? null,
        })),
      })),
    };
  }

  restore(data = {}) {
    const numberOr = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const integerOr = (value, fallback) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.floor(n) : fallback;
    };

    this.reset({ preserveCreatureState: true });

    const empireRows = Array.isArray(data.empires) ? data.empires : [];
    for (const row of empireRows) {
      const id = integerOr(row?.id, this.nextEmpireId);
      let color = new THREE.Color(0x8a5a3a);
      try {
        if (row?.color && typeof row.color === 'object' && Number.isFinite(row.color.r)) {
          color = new THREE.Color(row.color.r, row.color.g, row.color.b);
        } else if (row?.color !== undefined) {
          color.set(row.color);
        }
      } catch (_) {
        color.set(0x8a5a3a);
      }
      const empire = {
        id,
        name: typeof row?.name === 'string' ? row.name : `Imperio ${id}`,
        color,
        capitalId: row?.capitalId == null ? null : integerOr(row.capitalId, null),
        kingId: row?.kingId == null ? null : integerOr(row.kingId, null),
        relations: new Map(),
      };
      const relationRows = Array.isArray(row?.relations) ? row.relations : [];
      for (const relationRow of relationRows) {
        const otherId = Array.isArray(relationRow)
          ? integerOr(relationRow[0], null)
          : integerOr(relationRow?.empireId ?? relationRow?.id, null);
        const rel = Array.isArray(relationRow) ? relationRow[1] : relationRow;
        if (otherId == null || otherId === id || !rel) continue;
        empire.relations.set(otherId, {
          status: rel.status === 'war' ? 'war' : (rel.status === 'alliance' ? 'alliance' : 'peace'),
          tension: Math.max(0, Math.min(100, numberOr(rel.tension, 0))),
          warTime: Math.max(0, numberOr(rel.warTime, 0)),
          opinion: Math.max(-100, Math.min(100, numberOr(rel.opinion, 45))),
          treatyTime: Math.max(0, numberOr(rel.treatyTime, 0)),
          warGoal: rel.warGoal == null ? null : integerOr(rel.warGoal, null),
        });
      }
      this.empires.push(empire);
    }

    const settlementRows = Array.isArray(data.settlements) ? data.settlements : [];
    for (const row of settlementRows) {
      const id = integerOr(row?.id, this.nextSettlementId);
      const abandoned = !!row?.abandoned;
      let empireId = null;
      if (!abandoned) {
        empireId = integerOr(row?.empireId, 0);
        let empire = this.empires.find(e => e.id === empireId);
        if (!empire) {
          if (empireId <= 0) empireId = Math.max(1, ...this.empires.map(e => e.id + 1));
          empire = {
            id: empireId,
            name: `Imperio ${empireId}`,
            color: new THREE.Color(0x8a5a3a),
            capitalId: id,
            kingId: null,
            relations: new Map(),
          };
          this.empires.push(empire);
        }
      }
      const resources = row?.resources || {};
      const s = {
        id,
        x: numberOr(row?.x, 0),
        z: numberOr(row?.z, 0),
        level: Math.max(0, Math.min(LEVEL_NAMES.length - 1, integerOr(row?.level, 0))),
        houses: [],
        farms: [],
        empireId,
        race: abandoned ? null : (typeof row?.race === 'string' ? row.race : 'human'),
        abandoned,
        wallsBreached: row?.wallsBreached === true,
        wallRepairRemaining: Math.max(0, Math.min(WALL_REPAIR.seconds, numberOr(row?.wallRepairRemaining, WALL_REPAIR.seconds))),
        growTimer: Math.max(0, numberOr(row?.growTimer, 2)),
        name: typeof row?.name === 'string' ? row.name : this.genSettlementName(),
        pop: abandoned ? 0 : Math.max(0, integerOr(row?.pop, 0)),
        emptyTimer: Math.max(0, numberOr(row?.emptyTimer, 0)),
        loyalty: abandoned ? 0 : Math.max(0, Math.min(100, numberOr(row?.loyalty, 100))),
        resources: {
          wood: Math.max(0, numberOr(resources.wood, 0)),
          food: Math.max(0, numberOr(resources.food, 0)),
          stone: Math.max(0, numberOr(resources.stone, 0)),
          gold: Math.max(0, numberOr(resources.gold, 0)),
          gems: Math.max(0, numberOr(resources.gems, 0)),
          ore: Math.max(0, numberOr(resources.ore, 0)),
          fish: Math.max(0, numberOr(resources.fish, 0)),
          tools: Math.max(0, numberOr(resources.tools, 0)),
          weapons: Math.max(0, numberOr(resources.weapons, 0)),
          armor: Math.max(0, numberOr(resources.armor, 0)),
          goods: Math.max(0, numberOr(resources.goods, 0)),
        },
      };
      this.settlements.push(s);

      for (const houseRow of Array.isArray(row?.houses) ? row.houses : []) {
        const slot = this.allocHouseSlot();
        if (slot == null) break;
        // Self-heals a variant that doesn't match this settlement's race (a save from before the
        // elf/mushroom split, or one hand-edited) by falling back to that race's first variant,
        // rather than risk a human village with a mushroom cottage or an out-of-range index.
        const raceVariants = houseVariantIndicesFor(s.race);
        const savedVariant = houseRow?.variant;
        const variant = Number.isInteger(savedVariant) && raceVariants.includes(savedVariant) ? savedVariant : raceVariants[0];
        const house = {
          x: numberOr(houseRow?.x, s.x),
          z: numberOr(houseRow?.z, s.z),
          variant,
          scaleMul: Math.max(0.2, numberOr(houseRow?.scaleMul, 1)),
          rotationY: numberOr(houseRow?.rotationY, 0),
          tier: houseRow?.tier ? 1 : 0,
          gridPlot: !!houseRow?.gridPlot,
          pathCurveSign: Math.random() < 0.5 ? -1 : 1,
          slot,
        };
        s.houses.push(house);
        this.slotOwner.set(slot, { settlement: s, house });
        this._syncHouseInstance(s, house, true);
      }
      if (abandoned) {
        for (const h of s.houses) {
          if (h.slot == null) continue;
          this._setHouseColor(h, ABANDONED_HOUSE_COLOR);
        }
        this._markHouseColorsDirty();
      }
      for (const farmRow of Array.isArray(row?.farms) ? row.farms : []) {
        const slot = this.allocFarmSlot();
        if (slot == null) break;
        const farm = { x: numberOr(farmRow?.x, s.x), z: numberOr(farmRow?.z, s.z), slot, gridPlot: !!farmRow?.gridPlot };
        s.farms.push(farm);
        this._syncFarmInstance(farm, true);
      }
      this.addFlag(s);
      if (abandoned && s.flagGroup) s.flagGroup.visible = false;
      this._maybeAddDock(s);
      this.addLabel(s);
      if (!abandoned) this._syncDefenses(s);
    }

    this._cleanupExtinctEmpires();
    const maxSettlementId = this.settlements.reduce((max, s) => Math.max(max, s.id), 0);
    const maxEmpireId = this.empires.reduce((max, e) => Math.max(max, e.id), 0);
    this.nextSettlementId = Math.max(maxSettlementId + 1, integerOr(data.nextSettlementId, 1));
    this.nextEmpireId = Math.max(maxEmpireId + 1, integerOr(data.nextEmpireId, 1));
    this._tick = Math.max(0, numberOr(data.tick, 0));
    this._diploTick = Math.max(0, numberOr(data.diploTick, 0));

    const settlementById = new Map(this.settlements.map(s => [s.id, s]));
    for (const c of this.creatures.creatures) {
      if (c.settlementId == null) continue;
      const s = settlementById.get(c.settlementId);
      if (!s) {
        this.creatures.clearHome(c);
        if (!this.empires.some(e => e.id === c.empireId)) c.empireId = null;
        continue;
      }
      c.empireId = s.empireId;
      c.homeX = s.x;
      c.homeZ = s.z;
      c.homeRadius = RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0];
    }

    this.validateTerrain(false);
    this._navigationObstaclesDirty = true;
    if (this.territoryMesh.visible) this.scheduleTerritoryUpdate();
    return this;
  }

  dispose() {
    if (this._disposed) return;
    this.reset();
    // Houses aren't included below: their geometry/material are the module-level cached (or
    // still-placeholder) resources shared across every settlement manager this page session —
    // see ensureHouseModelsRequested() — disposing them here would break the *next* new game.
    for (const mesh of this.houseMeshes) this.group.remove(mesh);
    const meshes = [this.chimneyMesh, this.pathMesh, this.cityDetailMesh, this.bridgeMesh, this.farmMesh, this.territoryMesh];
    for (const mesh of meshes) {
      this.group.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        for (const material of mesh.material) material.dispose();
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    }
    this.scene.remove(this.group);
    this._disposed = true;
  }

  empireCount() {
    return new Set(this.settlements.map(s => s.empireId)).size;
  }

  // ---------- Kings ----------
  ensureKing(empire) {
    let previousKingId = empire.kingId;
    if (empire.kingId != null) {
      const king = this.creatures.creatures.find(c => c.id === empire.kingId);
      if (king && king.alive && king.empireId === empire.id) return;
      this.toast(king && king.alive ? `👋 ${king.name} ya no reina en ${empire.name}` : `☠️ El rey de ${empire.name} ha muerto`);
      empire.kingId = null;
    }
    const heir = this.civilizationSystem?.chooseHeir?.(empire, previousKingId) ||
      this.creatures.creatures.filter(c => c.alive && CIVILIZED_TYPES.includes(c.type) && c.empireId === empire.id && c.role !== 'soldado').sort((a, b) => b.age - a.age)[0];
    if (!heir) return;
    heir.profession = 'Rey';
    empire.kingId = heir.id;
    this.toast(`👑 ${heir.name} es coronado nuevo rey de ${empire.name}`);
  }

  // ---------- Diplomacy ----------
  empireProximity(a, b) {
    const as = this.settlements.filter(s => s.empireId === a.id);
    const bs = this.settlements.filter(s => s.empireId === b.id);
    if (!as.length || !bs.length) return 0;
    let best = Infinity;
    for (const s1 of as) for (const s2 of bs) best = Math.min(best, dist2(s1.x, s1.z, s2.x, s2.z));
    return Math.max(0, 1 - Math.sqrt(best) / 60);
  }

  declareWar(a, b) {
    if (!this._lawEnabled('diplomacy') || !a || !b || !this._hasActiveEmpire(a.id) || !this._hasActiveEmpire(b.id)) return false;
    this._ensureActiveRelations();
    const ab = a.relations.get(b.id), ba = b.relations.get(a.id);
    if (!ab || !ba) return false;
    const targets = this.settlements.filter(s => s.empireId === b.id).sort((x, y) => y.level - x.level);
    const warGoal = targets[0]?.id || null;
    ab.status = 'war'; ab.warTime = 0; ab.tension = 100; ab.opinion = -100; ab.treatyTime = 0; ab.warGoal = warGoal;
    ba.status = 'war'; ba.warTime = 0; ba.tension = 100; ba.opinion = -100; ba.treatyTime = 0; ba.warGoal = this.settlements.find(s => s.empireId === a.id)?.id || null;
    this.toast(`⚔️ ¡${a.name} declara la guerra a ${b.name}!`);
    this.events?.emit?.('diplomacy:war', { a, b });
    return true;
  }

  makePeace(a, b) {
    if (!a || !b) return false;
    const ab = a.relations.get(b.id), ba = b.relations.get(a.id);
    if (!ab || !ba) return false;
    const wasAtWar = ab.status === 'war' || ba.status === 'war';
    ab.status = 'peace'; ab.tension = 15; ab.warTime = 0; ab.opinion = Math.max(5, ab.opinion || 0); ab.treatyTime = 28; ab.warGoal = null;
    ba.status = 'peace'; ba.tension = 15; ba.warTime = 0; ba.opinion = Math.max(5, ba.opinion || 0); ba.treatyTime = 28; ba.warGoal = null;
    for (const c of this.creatures.creatures) {
      if (!c.alive || c.role !== 'soldado') continue;
      if ((c.empireId === a.id && c.warTargetEmpire === b.id) || (c.empireId === b.id && c.warTargetEmpire === a.id)) {
        this._demobilize(c);
      }
    }
    if (wasAtWar) this.toast(`🕊️ ${a.name} y ${b.name} firman la paz`);
    if (wasAtWar) this.events?.emit?.('diplomacy:peace', { a, b });
    return true;
  }

  makeAlliance(a, b) {
    if (!a || !b || a.id === b.id) return false;
    this._ensureActiveRelations();
    const ab = a.relations.get(b.id), ba = b.relations.get(a.id);
    if (!ab || !ba || ab.status === 'war') return false;
    ab.status = ba.status = 'alliance';
    ab.opinion = ba.opinion = Math.max(70, (ab.opinion + ba.opinion) / 2);
    ab.tension = ba.tension = 0;
    ab.treatyTime = ba.treatyTime = 90;
    this.toast(`🤝 ${a.name} y ${b.name} forman una alianza`);
    this.events?.emit?.('diplomacy:alliance', { a, b });
    return true;
  }

  raiseSoldiers(attacker, defender) {
    if (!this._lawEnabled('diplomacy') || !this._hasActiveEmpire(attacker.id) || !this._hasActiveEmpire(defender.id)) return;
    const attackerSettlements = this.settlements.filter(s => s.empireId === attacker.id);
    const defenderSettlements = this.settlements.filter(s => s.empireId === defender.id);
    if (!attackerSettlements.length || !defenderSettlements.length) return;
    const origin = attackerSettlements[Math.floor(Math.random() * attackerSettlements.length)];
    let target = null, bestD = Infinity;
    for (const s of defenderSettlements) { const d = dist2(origin.x, origin.z, s.x, s.z); if (d < bestD) { bestD = d; target = s; } }
    if (!target) return;
    const candidates = this.creatures.creatures.filter(c => c.alive && CIVILIZED_TYPES.includes(c.type) && c.settlementId === origin.id && c.role !== 'soldado' && !c.garrison && c.profession !== 'Rey' && c.age > 7);
    const n = Math.min(candidates.length, 2 + Math.floor(Math.random() * 3));
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      c.role = 'soldado'; c.profession = 'Soldado';
      c.warTargetEmpire = defender.id;
      c.commander = i === 0;
      const kind = c.commander ? 'sword' : (Math.random() < 0.3 ? 'bow' : (Math.random() < 0.5 ? 'spear' : 'sword'));
      c.archer = kind === 'bow';
      c.weaponKind = kind;
      if (c.model3d) {
        const weapon = attachWeapon(c.model3d, kind);
        // Gem-funded masterwork gear: a gold-trimmed weapon and a small combat edge.
        if (weapon && origin.resources.gems >= MASTERWORK_GEM_COST) {
          origin.resources.gems -= MASTERWORK_GEM_COST;
          c.masterwork = true;
          c.damageMul *= 1.18;
          weapon.traverse(o => { if (o.isMesh) o.material.color.set(0xe8c65a); });
        }
      }
      const spread = c.commander ? 0 : (Math.random() - 0.5) * 3;
      const spreadZ = c.commander ? 0 : (Math.random() - 0.5) * 3;
      c.warDestination = { x: target.x + spread, z: target.z + spreadZ };
      c.target = null; c.combatTarget = null;
    }
    this.toast(`🛡️ ${attacker.name} moviliza tropas desde ${origin.name} hacia ${target.name}`);
  }

  captureSettlement(s, attackerEmpire) {
    if (!s || !attackerEmpire || s.empireId === attackerEmpire.id) return false;
    const oldEmpireId = s.empireId;
    const oldEmpire = this.empires.find(e => e.id === oldEmpireId);
    s.empireId = attackerEmpire.id;
    s.loyalty = 100;
    for (const h of s.houses) if (h.slot != null) this._setHouseColor(h, attackerEmpire.color);
    this._markHouseColorsDirty();
    this.updateFlag(s);
    for (const c of this.creatures.creatures) {
      if (c.settlementId !== s.id) continue;
      if (oldEmpire && oldEmpire.kingId === c.id) oldEmpire.kingId = null;
      if (c.role === 'soldado') this._demobilize(c);
      else if (c.profession === 'Rey') { c.profession = 'Aldeano'; c.economicRoleSet = false; }
      c.empireId = attackerEmpire.id;
      c.homeX = s.x;
      c.homeZ = s.z;
      c.homeRadius = RADIUS_BY_LEVEL[s.level] ?? RADIUS_BY_LEVEL[0];
    }
    this.civilizationSystem?.onSettlementEmpireChanged?.(s, attackerEmpire.id);
    for (const c of this.creatures.creatures) {
      if (c.alive && c.role === 'soldado' && c.empireId === attackerEmpire.id && c.warTargetEmpire != null &&
          dist2(c.x, c.z, s.x, s.z) < CAPTURE_RANGE * CAPTURE_RANGE) {
        this._demobilize(c);
        this.creatures.setHome(c, s.id, attackerEmpire.id, s.x, s.z, RADIUS_BY_LEVEL[s.level]);
      }
    }
    this.toast(`🏴 ¡${s.name} ha sido conquistada por ${attackerEmpire.name}!`);
    this.events?.emit?.('settlement:captured', { settlement: s, attackerEmpire, oldEmpire });
    if (oldEmpire && oldEmpire.capitalId === s.id) {
      const remaining = this.settlements.filter(x => x.empireId === oldEmpireId);
      oldEmpire.capitalId = remaining.length ? remaining[0].id : null;
      if (!remaining.length) this.toast(`💀 ${oldEmpire.name} ha caído`);
    }
    this._cleanupExtinctEmpires();
    return true;
  }

  _checkCaptureDir(attacker, defender) {
    if (!this._lawEnabled('diplomacy') || !this._hasActiveEmpire(attacker.id) || !this._hasActiveEmpire(defender.id)) return;
    // Fallback capture check for a bare SettlementManager with no CivilizationSystem attached
    // (doesn't happen in real play — see CivilizationSystem.controlsSiegeFor()). When one is
    // attached, its own _updateSieges() is the real siege implementation and this simpler,
    // wall/health-agnostic check must stay out of its way.
    if (this.civilizationSystem?.controlsSiegeFor?.()) return;
    const defenderSettlements = this.settlements.filter(s => s.empireId === defender.id);
    for (const s of defenderSettlements) {
      const attackersNear = this.creatures.creatures.some(c =>
        c.alive && c.role === 'soldado' && c.empireId === attacker.id && c.warTargetEmpire === defender.id &&
        dist2(c.x, c.z, s.x, s.z) < CAPTURE_RANGE * CAPTURE_RANGE);
      if (!attackersNear) continue;
      const defendersNear = this.creatures.creatures.some(c =>
        c.alive && CIVILIZED_TYPES.includes(c.type) && c.empireId === defender.id &&
        dist2(c.x, c.z, s.x, s.z) < CAPTURE_RANGE * CAPTURE_RANGE);
      if (defendersNear) continue;
      this.captureSettlement(s, attacker);
    }
  }

  updateDiplomacy() {
    this._cleanupExtinctEmpires();
    for (const empire of this.empires) this.ensureKing(empire);
    const activeEmpires = [...this.empires];
    if (!this._lawEnabled('diplomacy')) {
      for (let i = 0; i < activeEmpires.length; i++) {
        for (let j = i + 1; j < activeEmpires.length; j++) {
          const a = activeEmpires[i], b = activeEmpires[j];
          if (a.relations.get(b.id)?.status === 'war') this.makePeace(a, b);
        }
      }
      this.updateLoyalty();
      return;
    }
    for (let i = 0; i < activeEmpires.length; i++) {
      for (let j = i + 1; j < activeEmpires.length; j++) {
        const a = activeEmpires[i], b = activeEmpires[j];
        if (!this._hasActiveEmpire(a.id) || !this._hasActiveEmpire(b.id)) continue;
        const rel = a.relations.get(b.id);
        if (!rel) continue;
        if (rel.status === 'peace') {
          const proximity = this.empireProximity(a, b);
          const affinity = this.civilizationSystem?.diplomacyAffinity?.(a, b) || 0;
          rel.treatyTime = Math.max(0, (rel.treatyTime || 0) - DIPLO_INTERVAL);
          rel.opinion = Math.max(-100, Math.min(100, (rel.opinion ?? 45) + (0.25 - proximity * 0.12 + affinity) * DIPLO_INTERVAL));
          rel.tension = Math.min(100, rel.tension + (1 + proximity * 3) * DIPLO_INTERVAL * (rel.treatyTime > 0 ? 0.05 : 0.25));
          b.relations.get(a.id).tension = rel.tension;
          b.relations.get(a.id).opinion = rel.opinion;
          b.relations.get(a.id).treatyTime = rel.treatyTime;
          if (rel.opinion >= 72 && rel.treatyTime <= 0 && Math.random() < 0.08) {
            this.makeAlliance(a, b);
          } else if (rel.tension > WAR_TENSION_THRESHOLD && rel.treatyTime <= 0) {
            const kingA = this.creatures.creatures.find(c => c.id === a.kingId && c.alive);
            const kingB = this.creatures.creatures.find(c => c.id === b.kingId && c.alive);
            const aggro = (kingA && kingA.greedy ? 1.6 : 1) * (kingB && kingB.greedy ? 1.3 : 1);
            if (Math.random() < WAR_DECLARE_CHANCE * aggro) this.declareWar(a, b);
          }
        } else if (rel.status === 'alliance') {
          rel.treatyTime = Math.max(0, (rel.treatyTime || 0) - DIPLO_INTERVAL);
          rel.opinion = Math.min(100, (rel.opinion ?? 70) + 0.18 * DIPLO_INTERVAL);
          rel.tension = 0;
          Object.assign(b.relations.get(a.id), { status: 'alliance', treatyTime: rel.treatyTime, opinion: rel.opinion, tension: 0 });
          if (rel.treatyTime <= 0 && rel.opinion < 35) { rel.status = 'peace'; b.relations.get(a.id).status = 'peace'; }
        } else if (rel.status === 'war') {
          rel.warTime += DIPLO_INTERVAL;
          if (Math.random() < SOLDIER_RAISE_CHANCE) this.raiseSoldiers(a, b);
          if (Math.random() < SOLDIER_RAISE_CHANCE) this.raiseSoldiers(b, a);
          this._checkCaptureDir(a, b);
          this._checkCaptureDir(b, a);
          if (!this._hasActiveEmpire(a.id) || !this._hasActiveEmpire(b.id)) continue;
          const peaceChance = PEACE_CHANCE_BASE + rel.warTime * 0.0015;
          if (Math.random() < peaceChance) this.makePeace(a, b);
        }
      }
    }
    this.updateLoyalty();
    this._cleanupExtinctEmpires();
  }

  // ---------- Rebellions ----------
  updateLoyalty() {
    for (const s of this.settlements) {
      const empire = this.empires.find(e => e.id === s.empireId);
      if (!empire || empire.capitalId === s.id) { s.loyalty = 100; continue; }
      const capital = this.settlements.find(x => x.id === empire.capitalId);
      if (!capital) { s.loyalty = 100; continue; }
      const dist = Math.sqrt(dist2(s.x, s.z, capital.x, capital.z));
      const empireSize = this.settlements.filter(x => x.empireId === empire.id).length;
      const decay = LOYALTY_DECAY_BASE * (dist / 40) * (1 + empireSize * 0.08);
      s.loyalty = Math.max(0, Math.min(100, (s.loyalty ?? 100) - decay * DIPLO_INTERVAL + 0.3 * DIPLO_INTERVAL));
      const support = this.civilizationSystem?.rebellionSupport?.(s) ?? (100 - s.loyalty);
      s.rebellionSupport = support;
      if (this._lawEnabled('rebellions') && s.loyalty <= 8 && support >= 65 && Math.random() < 0.12) this.rebel(s);
    }
  }

  rebel(s) {
    if (!this._lawEnabled('rebellions') || !s || !this.settlements.includes(s)) return false;
    const oldEmpire = this.empires.find(e => e.id === s.empireId);
    const newEmpire = this.createEmpire();
    newEmpire.capitalId = s.id;
    const residents = this.creatures.creatures.filter(c => c.alive && c.settlementId === s.id);
    const leader = this.civilizationSystem?.chooseRebelLeader?.(s) || residents.filter(c => CIVILIZED_TYPES.includes(c.type)).sort((a, b) => b.age - a.age)[0];
    s.empireId = newEmpire.id;
    s.loyalty = 100;
    for (const h of s.houses) this._setHouseColor(h, newEmpire.color);
    this._markHouseColorsDirty();
    this.updateFlag(s);
    for (const c of residents) c.empireId = newEmpire.id;
    this.civilizationSystem?.onSettlementEmpireChanged?.(s, newEmpire.id);
    if (leader) { leader.profession = 'Rey'; newEmpire.kingId = leader.id; }
    this.toast(`🚩 ¡${s.name} se rebela contra ${oldEmpire ? oldEmpire.name : '?'} y funda ${newEmpire.name}!`);
    return true;
  }

  update(dt) {
    this._tick += dt;
    this._diploTick += dt;
    if (this._tick >= UPDATE_INTERVAL) {
      this._tick = 0;
      this.validateTerrain();
      this.tryFoundSettlements();
      this.growSettlements(UPDATE_INTERVAL);
      this._refreshTradeRouteHeights();
    }
    if (this._diploTick >= DIPLO_INTERVAL) {
      this._diploTick = 0;
      if (this._lawEnabled('diplomacy')) {
        this.updateDiplomacy();
      } else {
        this._cleanupExtinctEmpires();
        for (const empire of this.empires) this.ensureKing(empire);
        this.updateLoyalty();
      }
      if (this.territoryMesh.visible) this.scheduleTerritoryUpdate();
      this._syncTradeRoutes();
      this._trySendMerchant();
    }
    this._updateMerchants(dt);
    this._updateTradeRouteReveal(dt);
  }
}
