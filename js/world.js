import { groundGrassMaterial, lowestSupport } from './ground-support.js';
import { SimplexNoise } from './noise.js';
import { GroundDetails } from './ground-details.js';
import { createTreeGeometry, createGrassGeometry } from './botanical-geometry.js';
import * as THREE from 'three';
import { ConvexGeometry } from '../node_modules/three/examples/jsm/geometries/ConvexGeometry.js';
import { resolveGraphics } from './graphics-config.js';
import { createOceanMaterial, updateSeabed } from './ocean-material.js';
import { loadEnvironmentMesh, addVegetationWind } from './environment-assets.js';
import { TreeRenderer } from './tree-renderer.js';
import { generateBaseTerrain, regionalClimate, regionalClimateSample } from './world-generation.js';
import { traceRiver, RIVER_DEPTH, MAX_RIVER_CUT } from './river-routing.js';
import { riverVertex, riverSurfaceAt } from './river-surface.js';
import { bridgeHeightAt } from './river-bridges.js';
import { SimplifyModifier } from '../node_modules/three/examples/jsm/modifiers/SimplifyModifier.js';
// Relative path, not the bare "three-mesh-bvh" specifier: this project's import map (index.html)
// only maps "three" itself, matching how every other non-"three" package (SimplifyModifier above,
// EffectComposer, etc.) is already imported here — a bare specifier resolves fine under Vite's
// dev/build server, but a plain static server (Live Server, README's documented alternative) has
// no bundler to rewrite it and the browser's native module loader rejects it outright.
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from '../node_modules/three-mesh-bvh/src/index.js';

// Fase 11: the cursor raycasts against the terrain on every pointer move, and without an
// acceleration structure Three.js tests every triangle of it — ~115k on the large map. This
// patches the prototypes globally (the library's intended usage): any geometry that calls
// .computeBoundsTree() gets O(log n) raycasts instead, everything else is unaffected.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const CONFIG = {
  SIZE: 180,         // quads per side (default/medium)
  MAX_H: 17,
  WATER_LEVEL: 5,
  MAX_TREES: 7500,
  MAX_GRASS: 36000,
};

// World is now ~3x its original playable area (linear x1.8) across every preset.
export const SIZE_PRESETS = { pequeno: 132, mediano: 180, grande: 240, gigante: 720 };

export const BIOME_IDS = Object.freeze([
  'ocean', 'beach', 'grassland', 'forest', 'desert', 'swamp',
  'jungle', 'savanna', 'tundra', 'alpine', 'volcanic', 'autumn', 'meadow',
]);
export const MINERAL_IDS = Object.freeze(['none', 'stone', 'gold', 'gems']);
const BIOME_INDEX = Object.freeze(Object.fromEntries(BIOME_IDS.map((id, index) => [id, index])));
const BIOME_TINTS = Object.freeze({
  autumn: 0x8b904c, meadow: 0x719b4e, ocean: 0x346477, beach: 0xb9aa80, grassland: 0x597a3e, forest: 0x3f6336,
  desert: 0xc8a85c, swamp: 0x53653f, jungle: 0x3f8b3f, savanna: 0x879548,
  tundra: 0xb7c4b5, alpine: 0x92999e, volcanic: 0x3b302e,
});

const TREE_KINDS = ['round', 'pine', 'dry', 'autumn', 'birch'];
const TREE_KIND_CAP = 2600;
const TREE_DENSITY_BY_BIOME = { autumn: 0.35, meadow: 0.09, jungle: 0.52, forest: 0.42, swamp: 0.24, grassland: 0.17, savanna: 0.08, tundra: 0.07, desert: 0.015 };
const GRASS_BIOMES = new Set(['grassland', 'forest', 'jungle', 'savanna', 'autumn', 'meadow']);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const HUMIDITY_BIAS = { arido: -0.26, normal: 0, exuberante: 0.26 };
const CLIMATE_MOISTURE_BIAS = { mixto: 0, templado: 0, arido: -0.2, artico: 0.05, tropical: 0.25 };
// artico used to be 3.2 — enough that even a modest arctic hill (real height ~10, nowhere near
// MAX_H=17) sampled the color ramp as if it were near a mountain's rocky/snow line, turning an
// ordinary low tundra region into a solid pale patch (reported live, with a screenshot). A
// colder look for arctic regions should come from their own tundra biome tint, not from lying
// about how high the ground actually is by 4x arido's own bias.
const CLIMATE_HEIGHT_BIAS = { templado: 0, arido: 0.8, artico: 1.0, tropical: -2.6 };
const WATER_BIAS_HEIGHT = { bajo: 1.6, normal: 0, alto: -1.8 };

function smoothstep(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }

function normalizedSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return CONFIG.SIZE;
  return Math.max(16, Math.min(720, Math.round(n)));
}

function seedState(seed) {
  const text = String(seed);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 0x9e3779b9;
}

// Deterministic per-cell hash, independent of RNG draw order — used for anything
// (grass placement, tree-kind wobble) that must reproduce identically after a save/restore
// without re-running the sequential seeded RNG from world generation.
function cellHash(vx, vz, salt) {
  let h = (vx * 374761393 + vz * 668265263 + salt * 2246822519) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const WL = CONFIG.WATER_LEVEL, MH = CONFIG.MAX_H;
// Breakpoints must stay in ascending h order — sampleRamp() walks the array once, assuming
// each successive h is larger, and silently produces the wrong segment (or a discontinuous
// jump when a later lookup skips two entries at once) if that's violated. With WATER_LEVEL=5
// and MAX_H=17, a former "WL + 9.0" (14) breakpoint landed *after* "MH - 4.0" (13) here, so any
// height crossing 14 jumped straight past the intended green highlands into the rock/snow
// colors meant for genuinely near-peak terrain — most visible as a stark pale-blue patch
// wherever CLIMATE_HEIGHT_BIAS pushes an otherwise ordinary hill over that line (reported live,
// with a screenshot, as an ugly light-blue area covering part of the arctic biome). Removed
// rather than reordered: reordering would still leave a color that dips back to green for one
// unit right before the rock transition, which reads as an equally unnatural glitch.
const WET_RAMP = [
  { h: 0,          c: 0x18425a },
  { h: WL - 1.2,   c: 0x2f6f82 },
  { h: WL,         c: 0xd8c68e },
  { h: WL + 0.7,   c: 0xe6d6a3 },
  { h: WL + 2.0,   c: 0x629b4c },
  { h: MH - 4.0,   c: 0x87816f },
  { h: MH - 1.4,   c: 0x898a80 },
  { h: MH,         c: 0x999b91 },
];
const DRY_RAMP = [
  { h: 0,          c: 0x18425a },
  { h: WL - 1.2,   c: 0x2f6f82 },
  { h: WL,         c: 0xd8c68e },
  { h: WL + 0.7,   c: 0xe6d6a3 },
  { h: WL + 2.0,   c: 0x8fa34f },
  { h: MH - 4.0,   c: 0x8f8877 },
  { h: MH - 1.4,   c: 0x898a80 },
  { h: MH,         c: 0x999b91 },
];
const SWAMP_TINT = new THREE.Color(0x54633f);
const _biomeTint = new THREE.Color();

function sampleRamp(ramp, h, out) {
  let i = 0;
  while (i < ramp.length - 2 && ramp[i + 1].h < h) i++;
  const a = ramp[i], b = ramp[i + 1];
  const span = Math.max(0.0001, b.h - a.h);
  const t = Math.min(1, Math.max(0, (h - a.h) / span));
  const ca = _tmpA.set(a.c), cb = _tmpB.set(b.c);
  out.copy(ca).lerp(cb, t);
  return out;
}
const _tmpA = new THREE.Color(), _tmpB = new THREE.Color(), _wetC = new THREE.Color(), _dryC = new THREE.Color();
const _terrainColorOut = new THREE.Color();

// Breaks up the terrain's flat vertex-colored look with a cheap two-octave value-noise
// multiply, computed per-fragment in GLSL rather than baked into a tiled texture — a tiled
// texture would need seamless noise to avoid visible repeats at this scale, while an analytic
// hash has none. Same onBeforeCompile technique the water/river shaders already use here.
function applyTerrainDetailShader(material) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailWorldPos;\nvarying vec3 vDetailNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vDetailWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vDetailNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vDetailWorldPos;
      varying vec3 vDetailNormal;
      float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float terrainNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = terrainHash(i), b = terrainHash(i + vec2(1.0, 0.0));
        float c = terrainHash(i + vec2(0.0, 1.0)), d = terrainHash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      float detailN = terrainNoise(vDetailWorldPos.xz * 2.3) * 0.55 + terrainNoise(vDetailWorldPos.xz * 7.5) * 0.45;
      float meadow = terrainNoise(vDetailWorldPos.xz * 0.18);
      diffuseColor.rgb *= 0.82 + detailN * 0.2 + meadow * 0.18;
      // Slope-based exposed bedrock. Vertical projections preserve detail on cliff walls.
      vec3 rockNormal = abs(normalize(vDetailNormal));
      float cliff = smoothstep(0.16, 0.46, 1.0 - rockNormal.y);
      cliff *= smoothstep(5.0, 5.6, vDetailWorldPos.y);
      // Preserve charred ground rather than repainting burns as clean stone.
      cliff *= smoothstep(0.025, 0.085, max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
      float sideMix = rockNormal.x / max(0.001, rockNormal.x + rockNormal.z);
      vec2 rockUV = vec2(mix(vDetailWorldPos.x, vDetailWorldPos.z, sideMix), vDetailWorldPos.y);
      float rockGrain = mix(terrainNoise(vDetailWorldPos.xy * 4.8), terrainNoise(vDetailWorldPos.zy * 4.8), sideMix);
      float strataWarp = terrainNoise(rockUV * 0.7);
      float strata = sin(vDetailWorldPos.y * 8.0 + strataWarp * 3.5);
      float seam = (1.0 - smoothstep(0.035, 0.13, abs(strata))) * smoothstep(0.3, 0.65, terrainNoise(rockUV * 2.2));
      float warmth = smoothstep(0.85, 1.25, diffuseColor.r / max(diffuseColor.g, 0.001));
      vec3 rockColor = mix(vec3(0.24, 0.255, 0.245), vec3(0.39, 0.30, 0.205), warmth);
      rockColor *= 0.60 + rockGrain * 0.48 + terrainNoise(rockUV * 1.7) * 0.32 + strata * 0.055;
      rockColor *= 1.0 - seam * 0.19;
      cliff *= 0.86 + strataWarp * 0.14;
      diffuseColor.rgb = mix(diffuseColor.rgb, rockColor, cliff);`);
  };
}

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.graphics = resolveGraphics();
    this._waterQualityUniform = { value: this.graphics.water };
    this._windStrengthUniform = { value: 1 };
    this.laws = opts.laws || {};
    this.events = opts.events || null;
    this.seed = null;
    this.mapType = 'island';
    this.mountainLevel = 1;
    this.humidity = 'normal';
    this.climate = 'templado';
    this.waterLevelPreset = 'normal';
    this._climateHeightBias = 0;
    this._configureSize(opts.size || CONFIG.SIZE);

    this.activeFires = new Map();
    this.burntRegrow = new Map();
    this.saplings = new Map();
    this.treeSlots = new Map(); // cellIndex -> { kind, slot }
    this.treeCellsByKind = Object.fromEntries(TREE_KINDS.map(kind => [kind, []]));
    this._treeVisualRevision = 0;
    this.nextTreeSlotByKind = Object.fromEntries(TREE_KINDS.map(kind => [kind, 0]));
    this._waterT = 0;
    this._waterTimeUniform = { value: 0 };
    this._naturalRegrowthT = 0;
    this._seedRngState = 1;
    this._terrainColorDirty = false;
    this._terrainGeometryDirty = false;
    this._terrainDirtyBounds = null;
    this._grassVisualDirty = false;
    this._grassRefreshDelay = 0;
    this._riverVisualDirty = false;
    this._riverRefreshDelay = 0;
    this._climateVisualDirty = false;
    this._climateRefreshDelay = 0;
    this._mineralVisualDirty = false;
    this._mineralRefreshDelay = 0;
    this._climateCursor = 0;
    this._climateTick = 0;
    this._weatherTimer = 18;
    this.rainRemaining = 0;
    this.navigationRevision = 0;
    this.activeLava = new Set();
    this._disposed = false;

    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _configureSize(size) {
    this.size = normalizedSize(size);
    const areaScale = Math.max(1, (this.size / 240) ** 2);
    this.treeKindCapacity = Math.ceil(TREE_KIND_CAP * areaScale);
    this.grassCapacity = Math.ceil(CONFIG.MAX_GRASS * areaScale);
    this.maxNaturalTrees = Math.ceil(CONFIG.MAX_TREES * areaScale);
    this.verts = this.size + 1;
    this.n = this.verts * this.verts;
    this.half = this.size / 2;
    this.height = new Float32Array(this.n);
    this.moisture = new Float32Array(this.n);
    this.jitter = new Float32Array(this.n);
    this.treeState = new Uint8Array(this.n);
    this.treeKindArr = new Uint8Array(this.n);
    this.burnt = new Uint8Array(this.n);
    // Marks the flattened dirt plaza under a settlement (see flattenArea()/markSettlementGround()
    // in settlements.js's foundSettlement()/onLevelUp()) — read by colorAt() to paint it the same
    // dirt tone as a house's own path, instead of whatever biome color the terrain would show.
    this.settlementGround = new Uint8Array(this.n);
    this.swampy = new Uint8Array(this.n);
    this.riverMask = new Uint8Array(this.n);
    this.riverHeight = new Float32Array(this.n);
    this.biome = new Uint8Array(this.n);
    this.temperature = new Float32Array(this.n);
    this.lava = new Uint8Array(this.n);
    this.ice = new Uint8Array(this.n);
    this.danger = new Float32Array(this.n);
    this.mineralType = new Uint8Array(this.n);
    this.mineralAmount = new Float32Array(this.n);
  }

  _resetSeededRandom(seed) { this._seedRngState = seedState(seed); }
  _seededRandom() {
    let s = this._seedRngState >>> 0;
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    this._seedRngState = s || 0x9e3779b9;
    return (this._seedRngState >>> 0) / 4294967296;
  }

  idx(vx, vz) { return vz * this.verts + vx; }
  inBounds(vx, vz) { return vx >= 0 && vz >= 0 && vx <= this.size && vz <= this.size; }
  gridToWorld(vx, vz) { return [vx - this.half, vz - this.half]; }
  worldToGrid(x, z) {
    return [Math.round(Math.min(this.size, Math.max(0, x + this.half))), Math.round(Math.min(this.size, Math.max(0, z + this.half)))];
  }

  heightAtWorld(x, z) {
    const gx = Math.min(this.size - 0.0001, Math.max(0, x + this.half));
    const gz = Math.min(this.size - 0.0001, Math.max(0, z + this.half));
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this.height[this.idx(ix, iz)];
    const h10 = this.height[this.idx(ix + 1, iz)];
    const h01 = this.height[this.idx(ix, iz + 1)];
    const h11 = this.height[this.idx(ix + 1, iz + 1)];
    // The rendered quad is split along the b-c diagonal (see buildTerrainMesh),
    // so use the same two planar triangles instead of bilinear interpolation.
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h10 * (1 - fz) + h01 * (1 - fx) + h11 * (fx + fz - 1);
  }

  riverSurfaceAtWorld(x, z) { return riverSurfaceAt(this, x, z); }

  setBridges(bridges) {
    this._bridges = bridges;
    this._bridgeCells = new Map();
    for (const bridge of bridges) for (const p of bridge.points) {
      const radius = bridge.width / 2 + .3;
      for (let z=Math.floor(p.z+this.half-radius);z<=Math.floor(p.z+this.half+radius);z++) for(let x=Math.floor(p.x+this.half-radius);x<=Math.floor(p.x+this.half+radius);x++) {
        if (!this.inBounds(x,z)) continue;
        const key=this.idx(x,z), list=this._bridgeCells.get(key)||[];
        if(!list.includes(bridge))list.push(bridge);
        this._bridgeCells.set(key,list);
      }
    }
    this.navigationRevision++;
  }

  bridgeHeightAtWorld(x, z) {
    if (!this._bridgeCells?.size) return null;
    return bridgeHeightAt(this._bridgeCells.get(this.idx(Math.floor(x+this.half),Math.floor(z+this.half))), x, z);
  }

  // A cell counts as water either below global sea level or inside a carved river/lake
  // (which can sit well above sea level) — otherwise land creatures would happily walk
  // straight across an elevated lake since its terrain height is technically dry.
  isWaterWorld(x, z) {
    if (this.heightAtWorld(x, z) <= CONFIG.WATER_LEVEL) return true;
    const [vx, vz] = this.worldToGrid(x, z);
    return this.inBounds(vx, vz) && this.riverMask[this.idx(vx, vz)] === 1;
  }
  isWater(vx, vz) {
    const i = this.idx(vx, vz);
    return this.height[i] <= CONFIG.WATER_LEVEL || this.riverMask[i] === 1;
  }
  isFlatEnough(vx, vz, tol = 1.1) {
    const h = this.height[this.idx(vx, vz)];
    for (const [nx, nz] of this.neighbors4(vx, vz)) {
      if (Math.abs(this.height[this.idx(nx, nz)] - h) > tol) return false;
    }
    return true;
  }
  hasTree(vx, vz) { return this.treeState[this.idx(vx, vz)] === 2; }
  isBurning(vx, vz) { return this.activeFires.has(this.idx(vx, vz)); }
  groundY(vx, vz) { return this.height[this.idx(vx, vz)]; }

  generate(opts = {}) {
    this._prepareGeneration(opts);
    const generated = generateBaseTerrain(this._generationPayload());
    return this._finishGeneration(generated);
  }

  _prepareGeneration(opts = {}) {
    const requestedSeed = Number(opts.seed ?? Math.random() * 10000);
    const seed = Number.isFinite(requestedSeed) ? requestedSeed : 1;
    const mapType = opts.mapType || 'island';
    const mountainLevel = opts.mountainLevel ?? 1;
    const humidity = HUMIDITY_BIAS[opts.humidity] !== undefined ? opts.humidity : 'normal';
    const climate = CLIMATE_MOISTURE_BIAS[opts.climate] !== undefined ? opts.climate : 'templado';
    const waterLevelPreset = WATER_BIAS_HEIGHT[opts.waterLevel] !== undefined ? opts.waterLevel : 'normal';
    this.seed = seed;
    this.mapType = mapType;
    this.mountainLevel = mountainLevel;
    this.humidity = humidity;
    this.climate = climate;
    this.waterLevelPreset = waterLevelPreset;
    this._climateHeightBias = CLIMATE_HEIGHT_BIAS[climate] || 0;
    if (opts.laws) this.laws = opts.laws;
    this._resetSeededRandom(seed);
    this.height.fill(0);
    this.moisture.fill(0);
    this.jitter.fill(0);
    this.treeState.fill(0);
    this._constructionTreeMask = null;
    this._roadGrassMask = null;
    this.treeKindArr.fill(0);
    this.burnt.fill(0);
    this.settlementGround.fill(0);
    this.swampy.fill(0);
    this.riverMask.fill(0);
    this.riverHeight.fill(0);
    this.biome.fill(0);
    this.temperature.fill(0);
    this.lava.fill(0);
    this.ice.fill(0);
    this.danger.fill(0);
    this.mineralType.fill(0);
    this.mineralAmount.fill(0);
    this.activeFires.clear();
    this.burntRegrow.clear();
    this.saplings.clear();
    this.treeSlots.clear();
    this.activeLava.clear();
    for (const kind of TREE_KINDS) { this.treeCellsByKind[kind].length = 0; this.nextTreeSlotByKind[kind] = 0; }
    this._waterT = 0;
    this._naturalRegrowthT = 0;
    this._terrainColorDirty = false;
    this._terrainGeometryDirty = false;
    this._grassVisualDirty = false;
    this._grassRefreshDelay = 0;
    this._riverVisualDirty = false;
    this._riverRefreshDelay = 0;
    this._climateVisualDirty = false;
    this._climateRefreshDelay = 0;
    this._mineralVisualDirty = false;
    this._mineralRefreshDelay = 0;
    this._climateCursor = 0;
    this._climateTick = 0;
    this._weatherTimer = 14 + this._seededRandom() * 12;
    this.rainRemaining = 0;
    this.navigationRevision++;
    this._terrainDirtyBounds = null;
    return this;
  }

  async generateAsync(opts = {}) {
    if (typeof Worker !== 'function') return this.generate(opts);
    this._prepareGeneration(opts);
    const worker = new Worker(new URL('./world-generation.worker.js', import.meta.url), { type: 'module' });
    try {
      const generated = await new Promise((resolve, reject) => {
        worker.onmessage = event => {
          if (event.data?.error) reject(new Error(event.data.error));
          else resolve(event.data);
        };
        worker.onerror = event => reject(event.error || new Error(event.message || 'Falló el trabajador de generación'));
        worker.postMessage(this._generationPayload());
      });
      return this._finishGeneration(generated);
    } finally {
      worker.terminate();
    }
  }

  _generationPayload() {
    return {
      size: this.size, seed: this.seed, mapType: this.mapType, mountainLevel: this.mountainLevel,
      humidity: this.humidity, climate: this.climate, waterLevelPreset: this.waterLevelPreset,
      maxHeight: CONFIG.MAX_H, waterLevel: CONFIG.WATER_LEVEL,
    };
  }

  _finishGeneration(generated) {
    if (!generated?.height || generated.height.length !== this.n) throw new Error('La generación del terreno devolvió datos incompletos');
    this.height = generated.height instanceof Float32Array ? generated.height : new Float32Array(generated.height);
    this.moisture = generated.moisture instanceof Float32Array ? generated.moisture : new Float32Array(generated.moisture);
    this.jitter = generated.jitter instanceof Float32Array ? generated.jitter : new Float32Array(generated.jitter);
    this._seedRngState = Number(generated.rngState) >>> 0 || seedState(this.seed);
    if (this.mapType !== 'ring') this.carveRivers(Math.max(2, Math.round(this.size / 75)));
    this.rebuildEcology();
    this.generateMinerals();
    this.buildTerrainMesh();
    this.buildWaterMesh();
    this.buildRiverMesh();
    this.buildClimateOverlays();
    this.buildMineralMesh();
    this.buildRainMesh();
    this.buildTreeMeshes();
    this.buildGrassMesh();
    this.scatterInitialTrees();
    this.scatterGrass();
    return this;
  }

  climateAt(vx, vz) {
    return this.climate === 'mixto' ? regionalClimate(vx, vz, this.size, this.seed) : this.climate;
  }

  baselineTemperature(vx, vz) {
    const base = this.climate === 'mixto' ? regionalClimateSample(vx, vz, this.size, this.seed).temperature : (({ templado: 21, arido: 31, artico: -7, tropical: 29 })[this.climate] ?? 21);
    const latitude = Math.abs((vz - this.half) / Math.max(1, this.half));
    const elevation = Math.max(0, this.height[this.idx(vx, vz)] - CONFIG.WATER_LEVEL);
    return base - latitude * (this.climate === 'mixto' ? 3 : 17) - elevation * (this.climate === 'mixto' ? 0.45 : 1.05);
  }

  _classifyBiome(vx, vz) {
    const i = this.idx(vx, vz);
    const height = this.height[i], moisture = this.moisture[i], temperature = this.temperature[i];
    let id;
    if (this.lava[i]) id = 'volcanic';
    else if (this.isWater(vx, vz)) id = 'ocean';
    else if (height <= CONFIG.WATER_LEVEL + 0.75) id = 'beach';
    else if (height >= CONFIG.MAX_H - 2.2) id = 'alpine';
    else if (temperature <= 2) id = 'tundra';
    else if (this.swampy[i]) id = 'swamp';
    else if (moisture <= 0.16) id = 'desert';
    else if (temperature >= 22 && moisture >= 0.7) id = 'jungle';
    else if (temperature >= 23 && moisture < 0.43) id = 'savanna';
    else if (moisture >= 0.56 && temperature > 2 && temperature < 12) id = 'autumn';
    else if (moisture >= 0.56) id = 'forest';
    else if (moisture >= 0.38 && temperature > 10 && temperature < 22) id = 'meadow';
    else id = 'grassland';
    this.biome[i] = BIOME_INDEX[id];
    const frozen = this.isWater(vx, vz) && temperature <= -2 && !this.lava[i];
    this.ice[i] = frozen ? 1 : 0;
    this.danger[i] = this.lava[i] ? 100 : (this.activeFires.has(i) ? 60 : (id === 'swamp' ? 8 : 0));
    return id;
  }

  rebuildEcology() {
    for (let vz = 0; vz <= this.size; vz++) {
      for (let vx = 0; vx <= this.size; vx++) {
        this.temperature[this.idx(vx, vz)] = this.baselineTemperature(vx, vz);
        this._classifyBiome(vx, vz);
      }
    }
  }

  biomeIdAt(vx, vz) {
    if (!this.inBounds(vx, vz)) return 'ocean';
    return BIOME_IDS[this.biome[this.idx(vx, vz)]] || 'grassland';
  }

  generateMinerals() {
    this.mineralType.fill(0);
    this.mineralAmount.fill(0);
    for (let vz = 2; vz < this.size - 2; vz++) {
      for (let vx = 2; vx < this.size - 2; vx++) {
        const i = this.idx(vx, vz);
        const height = this.height[i];
        if (this.isWater(vx, vz) || height < CONFIG.WATER_LEVEL + 1.4) continue;
        const richness = Math.max(0, (height - CONFIG.WATER_LEVEL) / (CONFIG.MAX_H - CONFIG.WATER_LEVEL));
        if (this._seededRandom() > 0.012 + richness * 0.032) continue;
        const roll = this._seededRandom();
        const type = roll < 0.7 ? 1 : (roll < 0.94 ? 2 : 3);
        this.mineralType[i] = type;
        this.mineralAmount[i] = 18 + this._seededRandom() * 62 * (0.65 + richness);
      }
    }
  }

  findNearestMineral(x, z, maxRadius = 22) {
    const [vx, vz] = this.worldToGrid(x, z);
    let best = null, bestDistance = maxRadius * maxRadius;
    const radius = Math.ceil(maxRadius);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = vx + dx, gz = vz + dz;
        if (!this.inBounds(gx, gz)) continue;
        const i = this.idx(gx, gz);
        if (!this.mineralType[i] || this.mineralAmount[i] <= 0) continue;
        const distance = dx * dx + dz * dz;
        if (distance < bestDistance) best = { vx: gx, vz: gz, index: i, distance: Math.sqrt(distance) }, bestDistance = distance;
      }
    }
    return best;
  }

  mineNearest(x, z, amount = 1, maxRadius = 22) {
    const deposit = this.findNearestMineral(x, z, maxRadius);
    if (!deposit) return null;
    const extracted = Math.min(Math.max(0, amount), this.mineralAmount[deposit.index]);
    this.mineralAmount[deposit.index] -= extracted;
    const type = MINERAL_IDS[this.mineralType[deposit.index]] || 'stone';
    if (this.mineralAmount[deposit.index] <= 0.001) {
      this.mineralAmount[deposit.index] = 0;
      this.mineralType[deposit.index] = 0;
    }
    this.scheduleMineralRefresh();
    return { type, amount: extracted, vx: deposit.vx, vz: deposit.vz };
  }

  _traceDownhillTrail(startVx, startVz, salt, surfaceHeight = this.height[this.idx(startVx, startVz)] - 0.35, lakeRadius = 0) {
    return traceRiver(this, startVx, startVz, surfaceHeight, CONFIG.WATER_LEVEL, lakeRadius);
  }

  _lakeSurface(vx, vz, radius) {
    // Use the lowest part of the pool, so water cannot float off a hillside.
    let surface = this.height[this.idx(vx, vz)] - 0.35;
    this.forEachInRadius(vx, vz, radius * 0.45, (x, z) => {
      surface = Math.min(surface, this.height[this.idx(x, z)] - 0.15);
    });
    return Math.max(CONFIG.WATER_LEVEL, surface);
  }

  _carveLake(vx, vz, radius, surface, changed) {
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z), original = this.height[i];
      const floor = surface - RIVER_DEPTH;
      if (original - floor > MAX_RIVER_CUT) return;
      const core = t <= 0.45;
      const blend = core ? 1 : smoothstep((1 - t) / 0.55);
      this.height[i] = Math.max(original - MAX_RIVER_CUT, lerp(original, Math.min(original, floor), blend));
      this.moisture[i] = Math.min(1, this.moisture[i] + blend * 0.4);
      if (core && this.height[i] < surface) {
        this.riverMask[i] = surface > CONFIG.WATER_LEVEL ? 1 : 0;
        this.riverHeight[i] = this.riverMask[i] ? surface : 0;
      }
      changed.add(i);
    });
  }

  _carveRiverBed(trail, sourceHeight, changed = new Set()) {
    // Choose the nearest sample once per vertex, so overlapping brushes cannot
    // repeatedly erode upstream banks to the level of downstream water.
    const samples = new Map();
    let surface = sourceHeight;
    for (let k = 0; k < trail.length; k++) {
      const [vx, vz, plannedSurface] = trail[k];
      surface = Math.max(CONFIG.WATER_LEVEL, Math.min(surface,
        plannedSurface ?? this.height[this.idx(vx, vz)] - 0.08));
      const width = 1.35 + (k / Math.max(1, trail.length - 1)) * 0.65;
      this.forEachInRadius(vx, vz, width, (x, z, t) => {
        const i = this.idx(x, z);
        if (!samples.has(i) || t < samples.get(i).t) samples.set(i, { t, surface });
      });
    }
    for (const [i, sample] of samples) {
      const original = this.height[i], water = sample.surface;
      const floor = water - RIVER_DEPTH;
      if (this.riverMask[i]) continue;
      const core = sample.t <= 0.55;
      const blend = core ? 1 : smoothstep((1 - sample.t) / 0.45);
      this.height[i] = Math.max(original - MAX_RIVER_CUT, lerp(original, Math.min(original, floor), blend));
      this.moisture[i] = Math.min(1, this.moisture[i] + blend * 0.55);
      if (core && this.height[i] < water && original >= water - 0.8) {
        this.riverMask[i] = water > CONFIG.WATER_LEVEL ? 1 : 0;
        this.riverHeight[i] = this.riverMask[i] ? water : 0;
      }
      changed.add(i);
    }
    return changed;
  }

  carveRivers(count) {
    for (let r = 0; r < count; r++) {
      let best = null, bestH = -1;
      for (let t = 0; t < 26; t++) {
        const vx = 4 + Math.floor(this._seededRandom() * Math.max(1, this.size - 8));
        const vz = 4 + Math.floor(this._seededRandom() * Math.max(1, this.size - 8));
        const h = this.height[this.idx(vx, vz)];
        if (!this.isWater(vx, vz) && h > bestH) { bestH = h; best = [vx, vz]; }
      }
      if (!best || bestH < CONFIG.WATER_LEVEL + 5) continue;
      const radius = 2.5 + this._seededRandom() * (this.size > 160 ? 3 : 2);
      const surface = this._lakeSurface(best[0], best[1], radius);
      const trail = this._traceDownhillTrail(best[0], best[1], r, surface, radius * 0.45);
      const changed = new Set();
      this._carveLake(best[0], best[1], radius, surface, changed);
      this._carveRiverBed(trail, surface, changed);
    }
  }

  // Extend a consistent surface to neighboring dry vertices, then clip each
  // triangle against the actual ground. Shores meet terrain without vertical
  // water walls, floating skirts, or cracks between independently built quads.
  buildRiverMesh() {
    if (this.riverMesh) {
      this.group.remove(this.riverMesh);
      this.riverMesh.geometry.dispose();
    }
    const positions = [];
    const colors = [];
    const indices = [];
    const vertices = new Map();
    const vertex = (x, z) => {
      const i = this.idx(x, z);
      if (vertices.has(i)) return vertices.get(i);
      const v = riverVertex(this, x, z);
      vertices.set(i, v);
      return v;
    };
    const triangle = (points) => {
      const clipped = [];
      for (let k = 0; k < 3; k++) {
        const a = points[k], b = points[(k + 1) % 3];
        if (a[3] >= 0) clipped.push(a);
        if ((a[3] >= 0) !== (b[3] >= 0)) {
          const t = a[3] / (a[3] - b[3]);
          clipped.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), 0]);
        }
      }
      if (clipped.length < 3) return;
      const base = positions.length / 3;
      for (const v of clipped) {
        positions.push(v[0], v[1], v[2]);
        // Same hue range as the ocean material (ocean-material.js: deep 0x247b9d, shallow
        // 0.09/0.39/0.36) so a river reads as a continuation of the sea instead of a paler,
        // unrelated blue where it reaches the coastline.
        const depthT = Math.min(1, v[3] / RIVER_DEPTH);
        colors.push(lerp(0.09, 0.14, depthT), lerp(0.37, 0.48, depthT), lerp(0.38, 0.62, depthT),
          lerp(0.55, 0.88, depthT));
      }
      for (let k = 1; k < clipped.length - 1; k++) indices.push(base, base + k, base + k + 1);
    };
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const a = this.idx(x, z), b = this.idx(x + 1, z), c = this.idx(x, z + 1), d = this.idx(x + 1, z + 1);
        if (this.riverMask[a] || this.riverMask[c] || this.riverMask[b]) {
          triangle([vertex(x, z), vertex(x, z + 1), vertex(x + 1, z)]);
        }
        if (this.riverMask[b] || this.riverMask[c] || this.riverMask[d]) {
          triangle([vertex(x + 1, z), vertex(x, z + 1), vertex(x + 1, z + 1)]);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    // Lit (MeshLambertMaterial, not the old unlit MeshBasicMaterial) so rivers pick up the same
    // sun/sky lighting as the ocean surface (ocean-material.js) instead of reading as a flat,
    // disconnected color right where a river meets the lit sea. Lambert rather than Standard/
    // Physical: the full PBR fragment shader (BRDF + envMap sampling) measurably raised frame
    // time whenever a lot of river surface was on screen (e.g. zooming/panning out over a big
    // lake), which pushed DynamicResolution (dynamic-resolution.js) into rescaling the renderer
    // more often — and that rescale resizes the composer's render targets (bloom, SSAO, SMAA) on
    // the main thread, which is what actually showed up as a black flash. Lambert's much cheaper
    // per-fragment lighting avoids feeding that loop while still shading with the scene's lights.
    // The material itself is built once and reused across rebuilds: this method reruns on every
    // terraform stroke and disaster (scheduleRiverRefresh), and recreating a lit material each
    // time forced a fresh WebGLProgram compile per rebuild — cheap for the old unlit
    // MeshBasicMaterial, but a multi-frame main-thread stall for a lit shader, especially once
    // compiled several times in a row while sculpting terrain.
    if (!this._riverMaterial) {
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const uTime = this._waterTimeUniform;
      mat.onBeforeCompile = shader => {
        shader.uniforms.uTime = uTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vRiverPosition;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          vRiverPosition = position;`);
        // Animate the shading, not the shoreline vertices: the banks remain attached.
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vRiverPosition;')
          .replace('#include <color_fragment>', `#include <color_fragment>
            float ripple = sin(vRiverPosition.x * 12.0 + vRiverPosition.z * 8.0 - uTime * 2.2);
            float fineRipple = sin(vRiverPosition.z * 25.0 - vRiverPosition.x * 5.0 + uTime * 1.3);
            diffuseColor.rgb *= 0.96 + ripple * 0.045 + fineRipple * 0.02;
            float shore = 1.0 - smoothstep(0.55, 0.7, diffuseColor.a);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.53, 0.68, 0.60), shore * (0.12 + 0.06 * ripple));`);
      };
      this._riverMaterial = mat;
    }
    const mesh = new THREE.Mesh(geo, this._riverMaterial);
    mesh.frustumCulled = false;
    mesh.visible = indices.length > 0;
    mesh.renderOrder = 1;
    this.riverMesh = mesh;
    this.group.add(mesh);
    this._riverVisualDirty = false;
  }

  // Ice sits at a
  // frozen-water height (from riverHeight/sea level) that can differ from a dry neighboring
  // corner's full terrain height by a lot on a cold mountainside, which used to render as the
  // same kind of cliff wall. Lava doesn't have that mismatch (its "active" height is just the
  // ground +0.1), so this is a no-op behavior change there, but sharing one code path keeps
  // both consistent instead of drifting.
  _buildClimateOverlay(existing, field, { color, opacity, emissive = 0x000000 } = {}) {
    if (existing) {
      this.group.remove(existing);
      existing.geometry.dispose();
      existing.material.dispose();
    }
    const isIce = field === this.ice;
    const activeHeight = i => isIce ? Math.max(CONFIG.WATER_LEVEL, this.riverHeight[i] || CONFIG.WATER_LEVEL) + 0.1 : this.height[i] + 0.1;
    const positions = [];
    const colors = [];
    const indices = [];
    const tint = new THREE.Color(color);
    let any = false;
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const ia = this.idx(x, z), ib = this.idx(x + 1, z), ic = this.idx(x, z + 1), id = this.idx(x + 1, z + 1);
        const aa = field[ia] === 1, ab = field[ib] === 1, ac = field[ic] === 1, ad = field[id] === 1;
        if (!aa && !ab && !ac && !ad) continue;
        let rim = CONFIG.WATER_LEVEL;
        if (isIce) {
          let sum = 0, count = 0;
          if (aa) { sum += activeHeight(ia); count++; }
          if (ab) { sum += activeHeight(ib); count++; }
          if (ac) { sum += activeHeight(ic); count++; }
          if (ad) { sum += activeHeight(id); count++; }
          if (count) rim = sum / count;
        }
        const cornerHeight = (i, active) => active ? activeHeight(i) : (isIce ? Math.min(this.height[i], rim + 0.15) : this.height[i]);
        const [ax, az] = this.gridToWorld(x, z);
        const [bx, bz] = this.gridToWorld(x + 1, z);
        const [cx, cz] = this.gridToWorld(x, z + 1);
        const [dx, dz] = this.gridToWorld(x + 1, z + 1);
        const base = positions.length / 3;
        positions.push(
          ax, cornerHeight(ia, aa), az, bx, cornerHeight(ib, ab), bz,
          cx, cornerHeight(ic, ac), cz, dx, cornerHeight(id, ad), dz,
        );
        const pushColor = active => colors.push(tint.r, tint.g, tint.b, active ? opacity : 0);
        pushColor(aa); pushColor(ab); pushColor(ac); pushColor(ad);
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        any = true;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 4));
    geometry.setIndex(indices);
    // MeshStandardMaterial is lit and needs a normal attribute — without one, WebGL falls back to
    // the attribute's zero default, and normalize(vec3(0,0,0)) in the lighting shader is NaN. That
    // NaN pixel color then spreads: UnrealBloomPass's Gaussian blur passes average each pixel with
    // its neighbors, so a single frame with NaN ice pixels (present whenever climate:'mixto' rolls
    // an arctic region large enough to matter, never for a uniform climate) corrupts progressively
    // more of the bloom buffer at each of its 5 mip levels — reproduced live as a black screen on
    // NVIDIA/ANGLE (WebGL logged "Framebuffer is incomplete: Attachment has zero size" once the
    // corruption hit a render target) and as a severe, escalating frame-time collapse on Intel
    // integrated graphics (no such warning, just DynamicResolution driving the resolution to its
    // floor trying to compensate). Confirmed by toggling ice-mesh visibility and material
    // roughness/metalness live: only removing the mesh (or, here, giving it real normals) fixes it
    // — the material's reflectivity settings were not the cause.
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, opacity: 1, depthWrite: false,
      roughness: field === this.ice ? 0.18 : 0.7, metalness: field === this.ice ? 0.18 : 0,
      emissive, emissiveIntensity: field === this.lava ? 0.75 : 0, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.visible = any;
    mesh.renderOrder = 2;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  buildClimateOverlays() {
    this.iceMesh = this._buildClimateOverlay(this.iceMesh, this.ice, { color: 0xb9e4ef, opacity: 0.72 });
    this.lavaMesh = this._buildClimateOverlay(this.lavaMesh, this.lava, { color: 0xff5a19, opacity: 0.92, emissive: 0xff2b00 });
    this._climateVisualDirty = false;
  }

  buildMineralMesh() {
    if (this.mineralMesh) {
      this.group.remove(this.mineralMesh);
      this.mineralMesh.geometry.dispose();
      this.mineralMesh.material.dispose();
    }
    const geometry = new THREE.DodecahedronGeometry(0.22, 1);
    geometry.translate(0, 0.18, 0);
    // polygonOffset pushes the rock slightly toward the camera in the depth test only (same
    // technique terrain-roads.js's road material uses) — without it, a rock's lower faces sit
    // almost exactly at the terrain's own surface (see the -0.09*scale embed below), and two
    // coincident surfaces z-fight: which one wins the depth test flips pixel-by-pixel as the
    // camera moves, reading as the rock's shading flickering/"moving" on its own.
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.88, metalness: 0.04,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const capacity = Math.max(1, Math.min(this.n, 3200));
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    let count = 0;
    for (let z = 1; z < this.size && count < capacity; z++) {
      for (let x = 1; x < this.size && count < capacity; x++) {
        const i = this.idx(x, z), type = this.mineralType[i];
        if (!type || this.mineralAmount[i] <= 0) continue;
        const [wx, wz] = this.gridToWorld(x, z);
        const scale = 0.75 + Math.min(1, this.mineralAmount[i] / 70) * 0.65;
        matrix.compose(
          new THREE.Vector3(wx, lowestSupport(this, wx, wz, .23 * scale) - 0.09 * scale, wz),
          new THREE.Quaternion().setFromAxisAngle(_upAxis, cellHash(x, z, 941) * Math.PI * 2),
          new THREE.Vector3(scale, scale, scale),
        );
        mesh.setMatrixAt(count, matrix);
        color.set(type === 1 ? 0x85847d : (type === 2 ? 0xa58a53 : 0x807488));
        mesh.setColorAt(count, color);
        count++;
      }
    }
    mesh.count = count;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.mineralMesh = mesh;
    loadEnvironmentMesh('./assets/packs/ImageToStl.com_free_pack_rocks_stylized/mesh-3.glb', 0.44).then(model => {
      if (!model || this._disposed || this.mineralMesh !== mesh) return;
      mesh.geometry.dispose();
      // Rebuild a closed shell from the asset silhouette; no overlapping interior
      // surfaces or unreliable imported normals can flicker as the camera moves.
      const points = [], position = model.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(position, i));
      mesh.geometry = new ConvexGeometry(points);
      mesh.geometry.computeBoundingSphere();
    });
    this.group.add(mesh);
    this._mineralVisualDirty = false;
  }

  buildRainMesh() {
    if (this.rainMesh) {
      this.group.remove(this.rainMesh);
      this.rainMesh.geometry.dispose();
      this.rainMesh.material.dispose();
    }
    const count = Math.min(900, Math.max(300, Math.round(this.size * 3.2)));
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (cellHash(i, 17, 3) - 0.5) * this.size;
      positions[i * 3 + 1] = 8 + cellHash(i, 29, 7) * 28;
      positions[i * 3 + 2] = (cellHash(i, 43, 11) - 0.5) * this.size;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xa9d8f2, size: 0.1, transparent: true, opacity: 0.72, depthWrite: false });
    this.rainMesh = new THREE.Points(geometry, material);
    this.rainMesh.visible = false;
    this.rainMesh.frustumCulled = false;
    this.group.add(this.rainMesh);
  }

  colorAt(i, out = _terrainColorOut) {
    const h = this.height[i];
    if (this.burnt[i]) return out.set(0x2c2724).multiplyScalar(this.jitter[i]);
    // Short village turf separates garden plots from the packed-earth street network.
    if (this.settlementGround[i]) return out.set(0x81905c).multiplyScalar(0.94 + this.jitter[i] * 0.08);
    const hEff = h;
    sampleRamp(WET_RAMP, hEff, _wetC);
    sampleRamp(DRY_RAMP, hEff, _dryC);
    const m = h <= CONFIG.WATER_LEVEL + 0.5 ? 0.5 : this.moisture[i];
    const c = out.copy(_dryC).lerp(_wetC, m);
    if (this.swampy[i] && h > CONFIG.WATER_LEVEL && h < CONFIG.WATER_LEVEL + 3.5) c.lerp(SWAMP_TINT, 0.55);
    const biomeId = BIOME_IDS[this.biome[i]] || 'grassland';
    // Blend continuous environmental fields rather than jumping between biome IDs.
    const temp = this.temperature[i];
    _biomeTint.set(BIOME_TINTS.desert).lerp(_wetC.set(BIOME_TINTS.grassland), smoothstep((m-.10)/.32));
    _biomeTint.lerp(_wetC.set(BIOME_TINTS.forest), smoothstep((m-.44)/.32));
    _biomeTint.lerp(_wetC.set(BIOME_TINTS.jungle), smoothstep((temp-21)/9)*smoothstep((m-.62)/.25));
    _biomeTint.lerp(_wetC.set(BIOME_TINTS.autumn), smoothstep((16-temp)/7)*smoothstep((m-.48)/.2)*smoothstep((temp-1)/7));
    _biomeTint.lerp(_wetC.set(0x929e87), smoothstep((6-temp)/12));
    _biomeTint.lerp(_wetC.set(0x888a7e), smoothstep((h-(CONFIG.MAX_H-3))/3)*.8);
    if (this.swampy[i]) _biomeTint.lerp(_wetC.set(BIOME_TINTS.swamp),.55);
    if (this.lava[i]) _biomeTint.set(BIOME_TINTS.volcanic);
    c.lerp(_biomeTint, .9*smoothstep((h-CONFIG.WATER_LEVEL-.5)/1.8));
    const snow = smoothstep((-temp-1)/9);
    const summitSnow = smoothstep((h-(CONFIG.MAX_H-.6))/.6)*smoothstep((8-temp)/10)*.6;
    if (biomeId !== 'ocean' && !this.lava[i]) c.lerp(_wetC.set(0xe4e9e7), Math.max(snow,summitSnow));
    c.multiplyScalar(this.jitter[i]);
    return c;
  }

  buildTerrainMesh() {
    if (this.terrainMesh) {
      this.group.remove(this.terrainMesh);
      this.terrainMesh.geometry.disposeBoundsTree?.();
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.material.dispose();
    }
    const V = this.verts;
    const positions = new Float32Array(this.n * 3);
    const colors = new Float32Array(this.n * 3);
    for (let vz = 0; vz < V; vz++) {
      for (let vx = 0; vx < V; vx++) {
        const i = this.idx(vx, vz);
        const [wx, wz] = this.gridToWorld(vx, vz);
        positions[i * 3] = wx;
        positions[i * 3 + 1] = this.height[i];
        positions[i * 3 + 2] = wz;
        const c = this.colorAt(i);
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
      }
    }
    const indices = [];
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        const a = this.idx(x, z), b = this.idx(x + 1, z), c = this.idx(x, z + 1), d = this.idx(x + 1, z + 1);
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, CONFIG.MAX_H * 0.5, 0),
      Math.sqrt(this.half * this.half * 2 + CONFIG.MAX_H * CONFIG.MAX_H * 0.25),
    );
    // Built once here; refreshTerrainRegion() below keeps it in sync with edits via refit()
    // instead of rebuilding it from scratch on every brush stroke.
    geo.computeBoundsTree();
    // FrontSide, not DoubleSide: the camera rig never dips below the terrain's own surface
    // (see CameraRig's polar clamp), so the back face was shaded and shadow-mapped on every
    // one of this mesh's ~115k triangles (large map) for a face nothing ever sees.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, side: THREE.FrontSide });
    applyTerrainDetailShader(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.terrainMesh = mesh;
    this.group.add(mesh);
    this._terrainColorDirty = false;
    this._terrainGeometryDirty = false;
    this._terrainDirtyBounds = null;
  }

  _markTerrainDirty(vx, vz) {
    if (!this._terrainDirtyBounds) {
      this._terrainDirtyBounds = { minX: vx, minZ: vz, maxX: vx, maxZ: vz };
      return;
    }
    const bounds = this._terrainDirtyBounds;
    bounds.minX = Math.min(bounds.minX, vx);
    bounds.minZ = Math.min(bounds.minZ, vz);
    bounds.maxX = Math.max(bounds.maxX, vx);
    bounds.maxZ = Math.max(bounds.maxZ, vz);
  }

  _markAttributeRows(attribute, bounds, itemSize) {
    attribute.clearUpdateRanges?.();
    if (attribute.addUpdateRange) {
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        const start = this.idx(bounds.minX, z) * itemSize;
        attribute.addUpdateRange(start, (bounds.maxX - bounds.minX + 1) * itemSize);
      }
    } else {
      attribute.updateRange.offset = this.idx(bounds.minX, bounds.minZ) * itemSize;
      attribute.updateRange.count = (this.idx(bounds.maxX, bounds.maxZ) - this.idx(bounds.minX, bounds.minZ) + 1) * itemSize;
    }
    attribute.needsUpdate = true;
  }

  refreshTerrainRegion() {
    if (!this.terrainMesh || (!this._terrainColorDirty && !this._terrainGeometryDirty)) return;
    const geo = this.terrainMesh.geometry;
    const dirty = this._terrainDirtyBounds || { minX: 0, minZ: 0, maxX: this.size, maxZ: this.size };
    const bounds = {
      minX: Math.max(0, dirty.minX), minZ: Math.max(0, dirty.minZ),
      maxX: Math.min(this.size, dirty.maxX), maxZ: Math.min(this.size, dirty.maxZ),
    };
    if (this._terrainColorDirty) this._markAttributeRows(geo.attributes.color, bounds, 3);
    if (this._terrainGeometryDirty) {
      if (this._seabedTexture) updateSeabed(this);
      this._markAttributeRows(geo.attributes.position, bounds, 3);
      const normal = geo.attributes.normal;
      const normalBounds = {
        minX: Math.max(0, bounds.minX - 1), minZ: Math.max(0, bounds.minZ - 1),
        maxX: Math.min(this.size, bounds.maxX + 1), maxZ: Math.min(this.size, bounds.maxZ + 1),
      };
      for (let z = normalBounds.minZ; z <= normalBounds.maxZ; z++) {
        for (let x = normalBounds.minX; x <= normalBounds.maxX; x++) {
          const left = this.height[this.idx(Math.max(0, x - 1), z)];
          const right = this.height[this.idx(Math.min(this.size, x + 1), z)];
          const down = this.height[this.idx(x, Math.max(0, z - 1))];
          const up = this.height[this.idx(x, Math.min(this.size, z + 1))];
          const nx = left - right, ny = 2, nz = down - up;
          const length = Math.hypot(nx, ny, nz) || 1;
          normal.setXYZ(this.idx(x, z), nx / length, ny / length, nz / length);
        }
      }
      this._markAttributeRows(normal, normalBounds, 3);
      // Positions moved — the bounds tree built in buildTerrainMesh() is now stale for this
      // region. refit() updates node bounds from the current positions in place; much cheaper
      // than computeBoundsTree()'s full rebuild, which would otherwise re-run on every brush
      // stroke while terraforming.
      geo.boundsTree?.refit();
    }
    this._terrainColorDirty = false;
    this._terrainGeometryDirty = false;
    this._terrainDirtyBounds = null;
  }

  writeVertex(vx, vz, updatePosition = true) {
    const i = this.idx(vx, vz);
    const pos = this.terrainMesh.geometry.attributes.position;
    const col = this.terrainMesh.geometry.attributes.color;
    this._markTerrainDirty(vx, vz);
    if (updatePosition) {
      pos.setY(i, this.height[i]);
      if (this._grassGroundTexture) this._grassGroundTexture.needsUpdate = true;
      this._terrainGeometryDirty = true;
    }
    const c = this.colorAt(i);
    col.setXYZ(i, c.r, c.g, c.b);
    this._terrainColorDirty = true;
  }

  buildWaterMesh() {
    if (this.waterMesh) {
      this.group.remove(this.waterMesh);
      this.waterMesh.geometry.dispose();
      this.waterMesh.material.dispose();
    }
    updateSeabed(this);
    const span = this.size + 64;
    const seg = this.graphics.water === 0 ? 32 : Math.min(320, Math.round(span * (this.graphics.water >= 3 ? 1 : 0.6)));
    const geo = new THREE.PlaneGeometry(span, span, seg, seg);
    geo.rotateX(-Math.PI / 2);
    // Keep the coastal grid resolution; stretch only its outermost ring beyond
    // the camera's far plane. This adds no vertices or draw calls.
    const horizon = Math.max(10000, span);
    const positions = geo.attributes.position;
    for (let z = 0; z <= seg; z++) {
      for (let x = 0; x <= seg; x++) {
        const i = z * (seg + 1) + x;
        if (x === 0 || x === seg) positions.setX(i, x === 0 ? -horizon : horizon);
        if (z === 0 || z === seg) positions.setZ(i, z === 0 ? -horizon : horizon);
      }
    }
    const mat = createOceanMaterial(this);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = CONFIG.WATER_LEVEL;
    mesh.receiveShadow = false;
    this.waterMesh = mesh;
    this.group.add(mesh);
  }

  // ---------- Trees (round / pine / dry archetypes, each independently instanced) ----------
  setGraphics(settings = {}) {
    const next = resolveGraphics(settings), previous = this.graphics;
    this.graphics = next;
    this._grassCamera = null;
    this._waterQualityUniform.value = next.water;
    this._windStrengthUniform.value = next.wind ? 1 : 0;
    if (this.waterMesh && next.water !== previous.water) this.buildWaterMesh();
    if (this.grassMesh && next.vegetation !== previous.vegetation) this.scatterGrass();
  }

  _treeArchetype(kind) {
    if (kind === 'pine') {
      return {
        trunkGeo: new THREE.CylinderGeometry(0.045, 0.09, 1, 5),
        trunkMat: new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 1 }),
        aGeo: new THREE.ConeGeometry(0.42, 0.62, 7),
        aMat: new THREE.MeshStandardMaterial({ color: 0x347443, roughness: 0.9, flatShading: true }),
        bGeo: new THREE.ConeGeometry(0.3, 0.46, 7),
        bMat: new THREE.MeshStandardMaterial({ color: 0x4c9650, roughness: 0.9, flatShading: true }),
      };
    }
    if (kind === 'dry') {
      return {
        trunkGeo: new THREE.CylinderGeometry(0.04, 0.075, 1, 5),
        trunkMat: new THREE.MeshStandardMaterial({ color: 0x6b5a3f, roughness: 1 }),
        aGeo: new THREE.IcosahedronGeometry(0.22, 0),
        aMat: new THREE.MeshStandardMaterial({ color: 0x8a7a4a, roughness: 1, flatShading: true }),
        bGeo: new THREE.IcosahedronGeometry(0.15, 0),
        bMat: new THREE.MeshStandardMaterial({ color: 0x746540, roughness: 1, flatShading: true }),
      };
    }
    return {
      trunkGeo: new THREE.CylinderGeometry(0.055, 0.1, 1, 5),
      trunkMat: new THREE.MeshStandardMaterial({ color: 0x5b3d24, roughness: 1 }),
      aGeo: new THREE.IcosahedronGeometry(0.46, 0),
      aMat: new THREE.MeshStandardMaterial({ color: 0x3d8b3f, roughness: 0.9, flatShading: true }),
      bGeo: new THREE.IcosahedronGeometry(0.32, 0),
      bMat: new THREE.MeshStandardMaterial({ color: 0x62a84e, roughness: 0.9, flatShading: true }),
    };
  }

  buildTreeMeshes() {
    this.treeRenderer?.dispose();
    this.treeRenderer = null;
    this._treeVisualRevision++;
    if (this.treeMeshes) {
      for (const kind of TREE_KINDS) {
        const set = this.treeMeshes[kind];
        for (const geometry of set.lods || []) geometry.dispose();
        this.group.remove(set.trunk, set.foliageA, set.foliageB);
        set.trunk.dispose(); set.foliageA.dispose(); set.foliageB.dispose();
        set.trunk.geometry.dispose(); set.trunk.material.dispose();
        set.trunk.customDepthMaterial?.dispose();
        set.foliageA.geometry.dispose(); set.foliageA.material.dispose();
        set.foliageB.geometry.dispose(); set.foliageB.material.dispose();
      }
    }
    this.treeMeshes = {};
    this.treeJitterByKind = {};
    for (const kind of TREE_KINDS) {
      const arch = this._treeArchetype(kind);
      const trunk = new THREE.InstancedMesh(arch.trunkGeo, arch.trunkMat, this.treeKindCapacity);
      const foliageA = new THREE.InstancedMesh(arch.aGeo, arch.aMat, this.treeKindCapacity);
      const foliageB = new THREE.InstancedMesh(arch.bGeo, arch.bMat, this.treeKindCapacity);
      trunk.castShadow = foliageA.castShadow = foliageB.castShadow = true;
      trunk.receiveShadow = foliageA.receiveShadow = foliageB.receiveShadow = true;
      trunk.frustumCulled = foliageA.frustumCulled = foliageB.frustumCulled = false;
      for (const mesh of [trunk, foliageA, foliageB]) {
        mesh.count = 0;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }
      this.group.add(trunk, foliageA, foliageB);
      this.treeMeshes[kind] = { trunk, foliageA, foliageB };
      const jitterArr = new Float32Array(this.treeKindCapacity);
      for (let s = 0; s < this.treeKindCapacity; s++) jitterArr[s] = this._seededRandom();
      this.treeJitterByKind[kind] = jitterArr;
      const set = this.treeMeshes[kind];
      trunk.geometry.dispose(); trunk.material.dispose();
      trunk.geometry = createTreeGeometry(kind);
      trunk.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 });
      addVegetationWind(trunk.material, this._waterTimeUniform, this._windStrengthUniform, 4.2);
      trunk.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      addVegetationWind(trunk.customDepthMaterial, this._waterTimeUniform, this._windStrengthUniform, 4.2);
      foliageA.visible = foliageB.visible = false;
      set.asset = true;
      set.lods = [createTreeGeometry(kind, 1), createTreeGeometry(kind, 2)];
    }
  }

  _decideTreeKind(i) {
    const biome = BIOME_IDS[this.biome[i]] || 'grassland';
    if (this.swampy[i] || biome === 'swamp' || biome === 'desert' || biome === 'savanna') return 2;
    if (biome === 'tundra' || biome === 'alpine') return 1;
    if (biome === 'forest' && this.temperature[i] < 17 && cellHash(i % this.verts, Math.floor(i / this.verts), 31) < .65) return 1;
    if (biome === 'autumn') return 3;
    if (biome === 'meadow' || (biome === 'forest' && cellHash(i % this.verts, Math.floor(i / this.verts), 51) > .7)) return 4;
    const m = this.moisture[i];
    const hEff = this.height[i] + this._climateHeightBias;
    if (m < 0.24) return 2;
    if (hEff > CONFIG.MAX_H - 6.5 || this.climate === 'artico') return 1;
    return 0;
  }

  // On large/lush worlds (e.g. a "grande" continent under tropical climate) the raw biome
  // densities below can demand far more trees of one kind (usually 'round', from jungle/forest)
  // than this.treeKindCapacity allows. Scanning row-by-row and hard-stopping once a kind's slots run out
  // used to leave the rest of the continent completely bald past that point. Instead we first
  // estimate demand per kind, then scale each kind's chance down so the cap is spent evenly
  // across the whole map rather than exhausted in the first rows scanned.
  _hasNaturalTreeSpace(vx, vz) {
    const spacing = this.humidity === 'exuberante' ? 1.5 : this.humidity === 'arido' ? 3.2 : 2.8;
    const radius = Math.ceil(spacing);
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz >= spacing * spacing || !this.inBounds(vx + dx, vz + dz)) continue;
        if (this.treeState[this.idx(vx + dx, vz + dz)]) return false;
      }
    }
    return true;
  }

  scatterInitialTrees() {
    const groveNoise = new SimplexNoise(Number(this.seed) + 317);
    const habitat = (x, z) => {
      const patch = groveNoise.fbm(x * .035, z * .035, 3, 2, .5);
      const slope = Math.hypot(this.height[this.idx(Math.min(this.size,x+1),z)] - this.height[this.idx(Math.max(0,x-1),z)], this.height[this.idx(x,Math.min(this.size,z+1))] - this.height[this.idx(x,Math.max(0,z-1))]);
      return (.12 + smoothstep((patch + .3) / .65) * 1.5) * Math.max(.15, 1 - slope * .45);
    };
    const expectedByKind = Object.fromEntries(TREE_KINDS.map(kind => [kind, 0]));
    for (let vz = 0; vz <= this.size; vz += 1) {
      for (let vx = 0; vx <= this.size; vx += 1) {
        const i = this.idx(vx, vz);
        const h = this.height[i];
        if (h <= CONFIG.WATER_LEVEL + 0.4 || h >= CONFIG.MAX_H - 4 || this.riverMask[i]) continue;
        const forestish = h > CONFIG.WATER_LEVEL + 1.2 && h < CONFIG.MAX_H - 4.5;
        if (!forestish) continue;
        const biome = BIOME_IDS[this.biome[i]] || 'grassland';
        const density = (TREE_DENSITY_BY_BIOME[biome] ?? 0.03) * habitat(vx, vz) * ({ arido: 0.35, normal: 0.72, exuberante: 1.7 }[this.humidity] ?? 1);
        if (density <= 0) continue;
        expectedByKind[TREE_KINDS[this._decideTreeKind(i)]] += density;
      }
    }
    const scaleByKind = {};
    for (const kind of TREE_KINDS) scaleByKind[kind] = expectedByKind[kind] > this.treeKindCapacity ? this.treeKindCapacity / expectedByKind[kind] : 1;

    for (let vz = 0; vz <= this.size; vz += 1) {
      for (let vx = 0; vx <= this.size; vx += 1) {
        const i = this.idx(vx, vz);
        const h = this.height[i];
        if (h <= CONFIG.WATER_LEVEL + 0.4 || h >= CONFIG.MAX_H - 4 || this.riverMask[i]) continue;
        const forestish = h > CONFIG.WATER_LEVEL + 1.2 && h < CONFIG.MAX_H - 4.5;
        const biome = BIOME_IDS[this.biome[i]] || 'grassland';
        const density = (TREE_DENSITY_BY_BIOME[biome] ?? 0.03) * habitat(vx, vz) * ({ arido: 0.35, normal: 0.72, exuberante: 1.7 }[this.humidity] ?? 1);
        const kind = TREE_KINDS[this._decideTreeKind(i)];
        const chance = forestish ? density * scaleByKind[kind] : 0;
        if (this._seededRandom() < chance && this._hasNaturalTreeSpace(vx, vz)) this.plantTree(vx, vz, true);
      }
    }
  }

  buildGrassMesh() {
    this._grassGroundTexture?.dispose();
    if (this.grassMesh) {
      this.group.remove(this.grassMesh);
      this.grassMesh.geometry.dispose();
      this.grassMesh.material.dispose();
    }
    // NOTE: instanceColor combined with vertexColors on this material used to render every
    // blade solid black (a real InstancedMesh/MeshStandardMaterial interaction, verified
    // live) — grass now uses a single flat-shaded material and gets its variety from
    // per-instance scale/rotation instead of per-instance color.
    const geo = createGrassGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, this.grassCapacity);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    const zero = new THREE.Matrix4().compose(new THREE.Vector3(0, -80, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
    for (let s = 0; s < this.grassCapacity; s++) mesh.setMatrixAt(s, zero);
    this.grassMesh = mesh;
    this.grassCount = 0;
    this.group.add(mesh);
    addVegetationWind(mat, this._waterTimeUniform, this._windStrengthUniform, .5);
    this._grassGroundTexture = groundGrassMaterial(mat, this);
  }

  scatterGrass() {
    if (!this.grassMesh) return;
    if (this._grassGroundTexture) this._grassGroundTexture.needsUpdate = true;
    const density = Math.min(1, this.grassCapacity * 1.4 / (this.size * this.size)) * this.graphics.vegetation;
    let count = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let vz = 0; vz <= this.size && count < this.grassCapacity; vz++) {
      for (let vx = 0; vx <= this.size && count < this.grassCapacity; vx++) {
        const i = this.idx(vx, vz);
        const h = this.height[i];
        const slope = Math.hypot(this.height[this.idx(Math.min(this.size,vx+1),vz)]-this.height[this.idx(Math.max(0,vx-1),vz)],this.height[this.idx(vx,Math.min(this.size,vz+1))]-this.height[this.idx(vx,Math.max(0,vz-1))])*.5;
        if(slope > .8) continue;
        if (!GRASS_BIOMES.has(BIOME_IDS[this.biome[i]]) || this.burnt[i] || this.lava[i] || this.isWater(vx, vz)) continue;
        if (h <= CONFIG.WATER_LEVEL + 0.35 || h >= CONFIG.MAX_H - 5) continue;
        if (this.swampy[i] || this.moisture[i] < 0.22 || this.settlementGround[i]) continue;
        if (this._roadGrassMask?.[i]) continue;
        if (cellHash(vx, vz, 777) > density) continue;
        // Keep the complete tuft footprint off adjacent beach/cleared cells.
        if (DIRS8.some(([dx, dz]) => !this.inBounds(vx + dx, vz + dz)
          || !GRASS_BIOMES.has(BIOME_IDS[this.biome[this.idx(vx + dx, vz + dz)]])
          || this.settlementGround[this.idx(vx + dx, vz + dz)])) continue;
        const jx = (cellHash(vx, vz, 3) - 0.5) * 0.4;
        const jz = (cellHash(vx, vz, 4) - 0.5) * 0.4;
        const [wx, wz] = this.gridToWorld(vx, vz);
        // Lusher (taller) tufts where moisture is higher instead of a per-instance tint.
        const moistScale = 0.85 + this.moisture[i] * 0.5;
        const scale = (0.7 + cellHash(vx, vz, 5) * 0.7) * moistScale;
        q.setFromAxisAngle(_upAxis, cellHash(vx, vz, 6) * Math.PI * 2);
        v3.set(wx + jx, this.heightAtWorld(wx + jx, wz + jz) - 0.02, wz + jz);
        sc.set(scale * 1.65, scale * (0.8 + cellHash(vx, vz, 7) * 0.3), scale * 1.65);
        m4.compose(v3, q, sc);
        this.grassMesh.setMatrixAt(count, m4);
        count++;
      }
    }
    this.grassCount = count;
    this.grassMesh.count = count;
    this._grassMatrices = this.grassMesh.instanceMatrix.array.slice(0, count * 16);
    this._grassCamera = null;
    this._grassLodDelay = 0;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    this._grassVisualDirty = false;
    if (!this.groundDetails) this.groundDetails = new GroundDetails(this);
    this.groundDetails.rebuild();
  }

  scheduleGrassRefresh(delay = 0.22) {
    this._grassVisualDirty = true;
    this._grassRefreshDelay = Math.max(0, delay);
  }

  scheduleRiverRefresh(delay = 0.12) {
    this._riverVisualDirty = true;
    this._riverRefreshDelay = Math.max(0, delay);
  }

  scheduleClimateRefresh(delay = 0.1) {
    this._climateVisualDirty = true;
    this._climateRefreshDelay = Math.max(0, delay);
  }

  scheduleMineralRefresh(delay = 0.18) {
    this._mineralVisualDirty = true;
    this._mineralRefreshDelay = Math.max(0, delay);
  }

  startRain(duration = 18) {
    this.rainRemaining = Math.max(this.rainRemaining, Math.max(1, Number(duration) || 18));
    if (this.rainMesh) this.rainMesh.visible = true;
    this.events?.emit?.('weather:rain', { duration: this.rainRemaining });
  }

  applyHeat(vx, vz, radius, amount = 30, createLava = false) {
    let changed = false;
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z), strength = smoothstep(1 - t);
      this.temperature[i] += amount * strength;
      if (createLava && strength > 0.28 && !this.isWater(x, z)) {
        this.lava[i] = 1;
        this.activeLava.add(i);
        this.temperature[i] = Math.max(this.temperature[i], 105);
        if (this.treeState[i]) this.removeTree(x, z);
      }
      if (this.ice[i] && this.temperature[i] > 0) this.ice[i] = 0;
      this._classifyBiome(x, z);
      this.writeVertex(x, z, false);
      changed = true;
    });
    if (changed) {
      this.navigationRevision++;
      this.scheduleClimateRefresh();
      this.scheduleGrassRefresh();
      this.refreshTerrainRegion();
      this._emitTerrainChanged(vx, vz, radius);
    }
  }

  applyCold(vx, vz, radius, amount = 28) {
    let changed = false;
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z), strength = smoothstep(1 - t);
      this.temperature[i] -= amount * strength;
      if (this.lava[i] && this.temperature[i] < 58) {
        this.lava[i] = 0;
        this.activeLava.delete(i);
      }
      this._classifyBiome(x, z);
      this.writeVertex(x, z, false);
      changed = true;
    });
    if (changed) {
      this.navigationRevision++;
      this.scheduleClimateRefresh();
      this.scheduleGrassRefresh();
      this.refreshTerrainRegion();
      this._emitTerrainChanged(vx, vz, radius);
    }
  }

  updateVisuals(dt, camera = null) {
    const elapsed = Math.max(0, Number(dt) || 0);
    // Rebuild before filtering, so a refresh never renders the entire grass reserve
    // for one frame while the camera is far above the ground.
    if (this._grassVisualDirty) {
      this._grassRefreshDelay -= elapsed;
      if (this._grassRefreshDelay <= 0) this.scatterGrass();
    }
    this.groundDetails?.update(camera);
    if (camera && this.treeMeshes && Object.values(this.treeMeshes).every(set => set.asset && set.lods)) {
      if (!this.treeRenderer) {
        this.treeRenderer = new TreeRenderer(this);
        for (const set of Object.values(this.treeMeshes)) set.trunk.visible = false;
      }
      this.treeRenderer.update(camera);
    }
    this._grassLodDelay = (this._grassLodDelay || 0) - elapsed;
    if (camera && this.grassMesh && this._grassMatrices && this._grassLodDelay <= 0) {
      this._grassLodDelay = 0.25;
      if (!this._grassCamera || this._grassCamera.distanceToSquared(camera.position) > 1) {
        this._grassCamera = camera.position.clone();
        const radius = this.graphics.quality === 'ultra' ? 48 : this.graphics.quality === 'high' ? 38 : 26;
        const source = this._grassMatrices, target = this.grassMesh.instanceMatrix.array;
        let visible = 0;
        for (let i = 0; i < this.grassCount; i++) {
          const offset = i * 16;
          const dx = source[offset + 12] - camera.position.x;
          const dy = source[offset + 13] - camera.position.y;
          const dz = source[offset + 14] - camera.position.z;
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          target.set(source.subarray(offset, offset + 16), visible++ * 16);
        }
        this.grassMesh.count = visible;
        this.grassMesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (this._riverVisualDirty) {
      this._riverRefreshDelay -= elapsed;
      if (this._riverRefreshDelay <= 0) {
        this.buildRiverMesh();
        this._riverVisualDirty = false;
      }
    }
    if (this._climateVisualDirty) {
      this._climateRefreshDelay -= elapsed;
      if (this._climateRefreshDelay <= 0) this.buildClimateOverlays();
    }
    if (this._mineralVisualDirty) {
      this._mineralRefreshDelay -= elapsed;
      if (this._mineralRefreshDelay <= 0) this.buildMineralMesh();
    }
  }

  allocTreeSlot(kind, i) {
    // A world that never had buildTreeMeshes() run (e.g. a test fixture that hand-builds terrain
    // without going through generate()) has nowhere to put a tree — decline instead of crashing,
    // the same way running out of capacity already declines rather than throwing.
    if (!this.treeMeshes) return null;
    if (this.nextTreeSlotByKind[kind] >= this.treeKindCapacity) return null;
    const slot = this.nextTreeSlotByKind[kind]++;
    this.treeCellsByKind[kind][slot] = i;
    const set = this.treeMeshes[kind];
    set.trunk.count = set.foliageA.count = set.foliageB.count = slot + 1;
    this.treeSlots.set(i, { kind, slot });
    return slot;
  }

  updateTreeInstance(kind, slot, vx, vz, growth) {
    if (slot == null) return;
    this._treeVisualRevision++;
    const i = this.idx(vx, vz);
    const [wx, wz] = this.gridToWorld(vx, vz);
    const baseY = this.height[i];
    const jitter = this.treeJitterByKind[kind][slot];
    const set = this.treeMeshes[kind];
    const rot = new THREE.Quaternion().setFromAxisAngle(_upAxis, jitter * Math.PI * 2);

    if (set.asset) {
      const scale = (0.85 + jitter * 0.3) * growth;
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(wx, lowestSupport(this, wx, wz, .17 * scale) - .03, wz), rot, new THREE.Vector3(scale * (.85 + jitter * .3), scale * (.9 + jitter * .3), scale));
      set.trunk.setMatrixAt(slot, matrix);
      set.trunk.instanceMatrix.needsUpdate = true;
      return;
    }

    if (kind === 'pine') {
      const scaleMul = (0.8 + jitter * 0.5) * growth;
      const trunkH = (0.85 + jitter * 0.35) * growth;
      const trunkM = new THREE.Matrix4().compose(new THREE.Vector3(wx, baseY + trunkH / 2, wz), rot, new THREE.Vector3(scaleMul, trunkH, scaleMul));
      set.trunk.setMatrixAt(slot, trunkM);
      const base = baseY + trunkH;
      const aScale = scaleMul * (1.05 + jitter * 0.2);
      const aM = new THREE.Matrix4().compose(new THREE.Vector3(wx, base + 0.28 * aScale, wz), rot, new THREE.Vector3(aScale, aScale, aScale));
      set.foliageA.setMatrixAt(slot, aM);
      const bScale = scaleMul * (0.72 + jitter * 0.18);
      const bM = new THREE.Matrix4().compose(new THREE.Vector3(wx, base + 0.62 * aScale, wz), rot, new THREE.Vector3(bScale, bScale, bScale));
      set.foliageB.setMatrixAt(slot, bM);
    } else if (kind === 'dry') {
      const scaleMul = (0.7 + jitter * 0.5) * growth;
      const trunkH = (0.55 + jitter * 0.35) * growth;
      const trunkM = new THREE.Matrix4().compose(new THREE.Vector3(wx, baseY + trunkH / 2, wz), rot, new THREE.Vector3(scaleMul, trunkH, scaleMul));
      set.trunk.setMatrixAt(slot, trunkM);
      const base = baseY + trunkH;
      const aScale = scaleMul * (0.6 + jitter * 0.3);
      const ang = jitter * Math.PI * 2 + 1.4;
      const aM = new THREE.Matrix4().compose(new THREE.Vector3(wx + Math.cos(ang) * 0.12 * scaleMul, base + 0.14 * aScale, wz + Math.sin(ang) * 0.12 * scaleMul), rot, new THREE.Vector3(aScale, aScale, aScale));
      set.foliageA.setMatrixAt(slot, aM);
      const bScale = scaleMul * (0.4 + jitter * 0.22);
      const bM = new THREE.Matrix4().compose(new THREE.Vector3(wx - Math.cos(ang) * 0.14 * scaleMul, base + 0.28 * bScale, wz - Math.sin(ang) * 0.14 * scaleMul), rot, new THREE.Vector3(bScale, bScale, bScale));
      set.foliageB.setMatrixAt(slot, bM);
    } else {
      const scaleMul = (0.75 + jitter * 0.5) * growth;
      const trunkH = (0.5 + jitter * 0.3) * growth;
      const trunkM = new THREE.Matrix4().compose(new THREE.Vector3(wx, baseY + trunkH / 2, wz), rot, new THREE.Vector3(scaleMul, trunkH, scaleMul));
      set.trunk.setMatrixAt(slot, trunkM);
      const foliageBase = baseY + trunkH;
      const aScale = scaleMul * (0.95 + jitter * 0.25);
      const aM = new THREE.Matrix4().compose(new THREE.Vector3(wx, foliageBase + 0.24 * aScale, wz), rot, new THREE.Vector3(aScale, aScale, aScale));
      set.foliageA.setMatrixAt(slot, aM);
      const bScale = scaleMul * (0.6 + jitter * 0.25);
      const off = 0.22 * scaleMul;
      const ang2 = jitter * Math.PI * 2 + 2.1;
      const bM = new THREE.Matrix4().compose(new THREE.Vector3(wx + Math.cos(ang2) * off, foliageBase + 0.42 * aScale, wz + Math.sin(ang2) * off), rot, new THREE.Vector3(bScale, bScale, bScale));
      set.foliageB.setMatrixAt(slot, bM);
    }
    set.trunk.instanceMatrix.needsUpdate = true;
    set.foliageA.instanceMatrix.needsUpdate = true;
    set.foliageB.instanceMatrix.needsUpdate = true;
  }

  treeGrowthAt(i) {
    if (this.treeState[i] !== 1) return 1;
    const sapling = this.saplings.get(i);
    if (!sapling || sapling.total <= 0) return 0.12;
    return 0.12 + 0.88 * (1 - Math.max(0, sapling.rem) / sapling.total);
  }

  updateTreeAt(vx, vz) {
    const i = this.idx(vx, vz);
    const rec = this.treeSlots.get(i);
    if (!rec || this.treeState[i] === 0) return;
    this.updateTreeInstance(rec.kind, rec.slot, vx, vz, this.treeGrowthAt(i));
  }

  refreshTreeKind(vx, vz) {
    const i = this.idx(vx, vz);
    const rec = this.treeSlots.get(i);
    if (!rec || this.treeState[i] === 0) return false;
    const desiredKindIndex = this._decideTreeKind(i);
    const desiredKind = TREE_KINDS[desiredKindIndex];
    if (rec.kind === desiredKind) return false;

    const jitter = this.treeJitterByKind[rec.kind]?.[rec.slot] ?? 0.5;
    const growth = this.treeGrowthAt(i);
    this.hideTreeInstance(rec.kind, rec.slot);
    this.treeSlots.delete(i);

    let slot = this.allocTreeSlot(desiredKind, i);
    if (slot == null) {
      slot = this.allocTreeSlot(rec.kind, i);
      if (slot != null) {
        this.treeJitterByKind[rec.kind][slot] = jitter;
        this.updateTreeInstance(rec.kind, slot, vx, vz, growth);
      }
      return false;
    }

    this.treeKindArr[i] = desiredKindIndex;
    this.treeJitterByKind[desiredKind][slot] = jitter;
    this.updateTreeInstance(desiredKind, slot, vx, vz, growth);
    return true;
  }

  hideTreeInstance(kind, slot) {
    const set = this.treeMeshes[kind];
    const cells = this.treeCellsByKind[kind];
    const last = cells.length - 1;
    if (slot < 0 || slot > last) return;
    this._treeVisualRevision++;
    // Keep live instances contiguous: hiding a matrix still submits its vertices.
    if (slot !== last) {
      const movedCell = cells[last];
      cells[slot] = movedCell;
      this.treeSlots.get(movedCell).slot = slot;
      this.treeJitterByKind[kind][slot] = this.treeJitterByKind[kind][last];
    }
    for (const mesh of [set.trunk, set.foliageA, set.foliageB]) {
      if (slot !== last) {
        mesh.instanceMatrix.array.copyWithin(slot * 16, last * 16, (last + 1) * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
      mesh.count = last;
    }
    cells.pop();
    this.nextTreeSlotByKind[kind] = last;
  }

  plantTree(vx, vz, instant = false) {
    if (!this.inBounds(vx, vz)) return false;
    const i = this.idx(vx, vz);
    if (this._constructionTreeMask?.[i]) return false;
    if (this.treeState[i] !== 0) return false;
    const h = this.height[i];
    // riverMask, not just the sea-level check below: a mountain river's water surface sits well
    // above CONFIG.WATER_LEVEL, so height alone let trees spawn right on top of (or overlapping)
    // a carved river/lake bed instead of just near the ocean shoreline.
    if (h <= CONFIG.WATER_LEVEL + 0.3 || h >= CONFIG.MAX_H - 3.5 || this.riverMask[i]) return false;
    const kindIdx = this._decideTreeKind(i);
    const kind = TREE_KINDS[kindIdx];
    const slot = this.allocTreeSlot(kind, i);
    if (slot == null) return false;
    this.treeKindArr[i] = kindIdx;
    this.treeState[i] = instant ? 2 : 1;
    if (instant) {
      this.updateTreeInstance(kind, slot, vx, vz, 1);
    } else {
      const total = 8 + Math.random() * 6;
      this.saplings.set(i, { rem: total, total });
      this.updateTreeInstance(kind, slot, vx, vz, 0.12);
    }
    return true;
  }

  removeTree(vx, vz) {
    const i = this.idx(vx, vz);
    this.activeFires.delete(i);
    this.danger[i] = this.lava[i] ? 100 : (this.biomeIdAt(vx, vz) === 'swamp' ? 8 : 0);
    if (this.treeState[i] === 0) return;
    this.treeState[i] = 0;
    const rec = this.treeSlots.get(i);
    if (rec) {
      this.hideTreeInstance(rec.kind, rec.slot);
      this.treeSlots.delete(i);
    }
    this.saplings.delete(i);
  }

  igniteTree(vx, vz) {
    const i = this.idx(vx, vz);
    if (this.treeState[i] === 0 || this.activeFires.has(i)) return false;
    this.activeFires.set(i, 3 + Math.random() * 2.5);
    this.danger[i] = 60;
    this.navigationRevision++;
    return true;
  }

  neighbors4(vx, vz) {
    const out = [];
    const cand = [[vx + 1, vz], [vx - 1, vz], [vx, vz + 1], [vx, vz - 1]];
    for (const [x, z] of cand) if (this.inBounds(x, z)) out.push([x, z]);
    return out;
  }

  forEachInRadius(vx, vz, radius, cb) {
    const r = Math.ceil(radius);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = vx + dx, z = vz + dz;
        if (!this.inBounds(x, z)) continue;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > radius) continue;
        cb(x, z, dist / Math.max(radius, 0.0001));
      }
    }
  }

  _emitTerrainChanged(vx, vz, radius) {
    const r = Math.max(0, Math.ceil(radius));
    this.events?.emit?.('world:terrainChanged', {
      minX: Math.max(0, vx - r), minZ: Math.max(0, vz - r),
      maxX: Math.min(this.size, vx + r), maxZ: Math.min(this.size, vz + r),
    });
  }

  terraform(vx, vz, radius, delta) {
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z);
      const ease = smoothstep(1 - t);
      let h = this.height[i] + delta * ease;
      h = Math.max(0, Math.min(CONFIG.MAX_H, h));
      this.height[i] = h;
      if (this.riverMask[i]) {
        if (delta > 0 && h > this.riverHeight[i] + 0.08) {
          this.riverMask[i] = 0;
          this.riverHeight[i] = 0;
        }
      }
      if (h <= CONFIG.WATER_LEVEL && this.treeState[i] !== 0) this.removeTree(x, z);
      if (h <= CONFIG.WATER_LEVEL && this.mineralType[i]) {
        this.mineralType[i] = 0;
        this.mineralAmount[i] = 0;
        this.scheduleMineralRefresh();
      }
      this.temperature[i] = this.baselineTemperature(x, z);
      this._classifyBiome(x, z);
      this.writeVertex(x, z);
      if (this.treeState[i] !== 0) this.updateTreeAt(x, z);
    });
    this.scheduleGrassRefresh();
    this.scheduleRiverRefresh();
    this.navigationRevision++;
    this.scheduleClimateRefresh();
    this.refreshTerrainRegion();
    this._emitTerrainChanged(vx, vz, radius);
  }

  // Same side effects as terraform() (rivers, minerals, biome/climate, tree height sync), but
  // blends height toward a fixed targetHeight instead of adding a delta — used when a settlement
  // is founded or grows, so its houses sit on level ground instead of whatever slope the raw
  // generated terrain happened to have there (reported after real play: houses tilted or
  // half-buried on anything but flat terrain). Unlike terraform()'s whole-radius smoothstep (a
  // soft peak, fine for a mound tool), a plaza needs an actual flat interior: ease stays at 1
  // out to `radius - FLATTEN_EDGE`, then eases down to raw terrain over that margin, so the flat
  // core doesn't shrink to almost nothing on the larger radii later levels use.
  //
  // Water and river tiles are left untouched rather than blended toward targetHeight: raising a
  // shoreline cell up to a coastal city's own (land) height silently destroyed the very shore a
  // dock needs — isCoastal() found no water left nearby, so newly founded coastal cities stopped
  // getting a pier at all — and doing the same to a river tile erased it outright wherever a city
  // happened to sit near or over one. A settlement's flat pad now stops right at the water's edge
  // and steps around a river instead of paving over either (reported live: rivers not interacting
  // with cities, and cities losing their ports).
  flattenArea(vx, vz, radius, targetHeight) {
    // Scaled with radius, not fixed — a fixed margin blends a large hilltop settlement's edge
    // over the same short distance as a tiny one, which is what turned the step between the flat
    // plaza and steeply sloped natural terrain into a near-vertical, unnaturally sharp cliff wall
    // wherever a city landed on anything but flat ground (reported live with a screenshot).
    const FLATTEN_EDGE = Math.max(1.5, radius * 0.3);
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z);
      if (this.height[i] <= CONFIG.WATER_LEVEL || this.riverMask[i]) return;
      const edgeT = FLATTEN_EDGE > 0 ? Math.max(0, Math.min(1, (radius - t * radius) / FLATTEN_EDGE)) : 1;
      const ease = smoothstep(edgeT);
      let h = this.height[i] + (targetHeight - this.height[i]) * ease;
      h = Math.max(0, Math.min(CONFIG.MAX_H, h));
      this.height[i] = h;
      if (h <= CONFIG.WATER_LEVEL && this.treeState[i] !== 0) this.removeTree(x, z);
      if (h <= CONFIG.WATER_LEVEL && this.mineralType[i]) {
        this.mineralType[i] = 0;
        this.mineralAmount[i] = 0;
        this.scheduleMineralRefresh();
      }
      this.temperature[i] = this.baselineTemperature(x, z);
      this._classifyBiome(x, z);
      this.writeVertex(x, z);
      if (this.treeState[i] !== 0) this.updateTreeAt(x, z);
    });
    this.scheduleGrassRefresh();
    this.scheduleRiverRefresh();
    this.navigationRevision++;
    this.scheduleClimateRefresh();
    this.refreshTerrainRegion();
    this._emitTerrainChanged(vx, vz, radius);
  }

  // Marks the ground within `radius` as a settlement's cleared dirt plaza (see colorAt()) and
  // clears every tree still standing in it outright — flattenArea() above only removes a tree if
  // flattening happened to submerge it, which doesn't help on a hilltop settlement where nothing
  // is anywhere near the water line. A flattened plaza with trees still poking through it is
  // exactly the "houses colliding with plants" problem this was written to fix.
  markSettlementGround(vx, vz, radius) {
    this.forEachInRadius(vx, vz, radius, (x, z) => {
      const i = this.idx(x, z);
      // Left as water/river rather than packed-earth plaza — see flattenArea()'s own water/river
      // exemption just above for why (docks need real shoreline left nearby, rivers shouldn't
      // vanish under a city).
      if (this.height[i] <= CONFIG.WATER_LEVEL || this.riverMask[i]) return;
      this.settlementGround[i] = 1;
      if (this.treeState[i] !== 0) this.removeTree(x, z);
      this.writeVertex(x, z, false);
    });
    this.scheduleGrassRefresh();
  }

  // Trace against unmodified terrain. Repainting a pool preserves its level.
  floodWater(vx, vz, radius) {
    if (!this.inBounds(vx, vz)) return;
    const source = this.idx(vx, vz);
    const existing = this.riverMask[source] || this.height[source] <= CONFIG.WATER_LEVEL;
    const surface = this.riverMask[source] ? this.riverHeight[source] : this._lakeSurface(vx, vz, radius);
    const trail = !existing && surface > CONFIG.WATER_LEVEL
      ? this._traceDownhillTrail(vx, vz, 0, surface, radius * 0.45) : [];
    const changed = new Set();
    this._carveLake(vx, vz, radius, surface, changed);
    this._carveRiverBed(trail, surface, changed);
    let minX = vx, maxX = vx, minZ = vz, maxZ = vz;
    for (const i of changed) {
      const x = i % this.verts, z = Math.floor(i / this.verts);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      if (this.isWater(x, z)) {
        if (this.treeState[i]) this.removeTree(x, z);
        if (this.mineralType[i]) {
          this.mineralType[i] = 0; this.mineralAmount[i] = 0;
          this.scheduleMineralRefresh();
        }
      }
      this.temperature[i] = this.baselineTemperature(x, z);
      this._classifyBiome(x, z);
      this.writeVertex(x, z);
      if (this.treeState[i]) this.updateTreeAt(x, z);
    }
    this.scheduleGrassRefresh();
    this.scheduleRiverRefresh();
    this.navigationRevision++;
    this.scheduleClimateRefresh();
    this.refreshTerrainRegion();
    this.events?.emit?.('world:terrainChanged', { minX, minZ, maxX, maxZ });
  }

  paintBiome(vx, vz, radius, moistureTarget, plant = false, swamp = false) {
    const target = Math.max(0, Math.min(1, Number(moistureTarget) || 0));
    this.forEachInRadius(vx, vz, radius, (x, z, t) => {
      const i = this.idx(x, z);
      const strength = smoothstep(1 - t);
      this.moisture[i] = lerp(this.moisture[i], target, strength * 0.78);
      if (swamp) {
        if (strength > 0.1) this.swampy[i] = 1;
        if (strength > 0.2 && this.treeState[i] === 0 && this._seededRandom() < strength * 0.22) this.plantTree(x, z, false);
      } else {
        if (strength > 0.1) this.swampy[i] = 0;
        if (plant && strength > 0.15 && this.treeState[i] === 0 && this._seededRandom() < strength * 0.34) {
          this.plantTree(x, z, false);
        } else if (!plant && this.moisture[i] < 0.12 && this.treeState[i] !== 0 && this._seededRandom() < strength * 0.24) {
          this.removeTree(x, z);
        }
      }
      if (this.treeState[i] !== 0) this.refreshTreeKind(x, z);
      this._classifyBiome(x, z);
      this.writeVertex(x, z, false);
    });
    this.scheduleGrassRefresh();
    this.navigationRevision++;
    this.refreshTerrainRegion();
    this._emitTerrainChanged(vx, vz, radius);
  }

  plantTreesInRadius(vx, vz, radius) {
    this.forEachInRadius(vx, vz, radius, (x, z) => { if (Math.random() < 0.6) this.plantTree(x, z, false); });
  }

  igniteInRadius(vx, vz, radius) {
    this.forEachInRadius(vx, vz, radius, (x, z) => { if (this.treeState[this.idx(x, z)] > 0) this.igniteTree(x, z); });
  }

  setBurntVisual(vx, vz, val) {
    const i = this.idx(vx, vz);
    const next = val ? 1 : 0;
    if (this.burnt[i] === next) return;
    this.burnt[i] = next;
    this.writeVertex(vx, vz, false);
  }

  meteorImpact(vx, vz, radius) {
    this.terraform(vx, vz, radius, -7);
    this.igniteInRadius(vx, vz, radius * 1.4);
  }

  // Nearest fully-grown tree cell to a world point, within maxRadius cells — used by lumberjacks.
  findNearestTree(x, z, maxRadius) {
    const [vx, vz] = this.worldToGrid(x, z);
    const r = Math.ceil(maxRadius);
    let best = null, bestD = maxRadius * maxRadius;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const gx = vx + dx, gz = vz + dz;
        if (!this.inBounds(gx, gz)) continue;
        if (this.treeState[this.idx(gx, gz)] !== 2) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 > bestD) continue;
        bestD = d2;
        best = [gx, gz];
      }
    }
    if (!best) return null;
    const [wx, wz] = this.gridToWorld(best[0], best[1]);
    return { gx: best[0], gz: best[1], wx, wz };
  }

  // Is this coastal cell adjacent to open water within `radius` cells? Used for docks.
  isCoastal(vx, vz, radius = 3) {
    let found = false;
    this.forEachInRadius(vx, vz, radius, (x, z) => { if (this.isWater(x, z)) found = true; });
    return found;
  }

  _updateRainVisual(dt) {
    if (!this.rainMesh) return;
    this.rainMesh.visible = this.rainRemaining > 0;
    if (!this.rainMesh.visible) return;
    const attribute = this.rainMesh.geometry.attributes.position;
    const positions = attribute.array;
    for (let i = 1; i < positions.length; i += 3) {
      positions[i] -= dt * 19;
      if (positions[i] < 0) positions[i] += 34;
    }
    attribute.needsUpdate = true;
  }

  _updateClimate(dt) {
    this._weatherTimer -= dt;
    if (this.laws.weather !== false && this._weatherTimer <= 0) {
      const wetChance = this.humidity === 'exuberante' || this.climate === 'tropical' ? 0.72 : (this.humidity === 'arido' ? 0.12 : 0.38);
      if (this._seededRandom() < wetChance) this.startRain(12 + this._seededRandom() * 16);
      this._weatherTimer = 24 + this._seededRandom() * 30;
    }
    if (this.rainRemaining > 0) this.rainRemaining = Math.max(0, this.rainRemaining - dt);
    this._updateRainVisual(dt);
    this._climateTick += dt;
    if (this._climateTick < 0.5) return;
    const elapsed = this._climateTick;
    this._climateTick = 0;
    let terrainChanged = false;
    let surfaceChanged = false;
    const work = Math.min(this.n, 320);
    for (let step = 0; step < work; step++) {
      const i = this._climateCursor++ % this.n;
      const vx = i % this.verts, vz = Math.floor(i / this.verts);
      const previousBiome = this.biome[i], previousIce = this.ice[i], previousLava = this.lava[i];
      const baseline = this.baselineTemperature(vx, vz);
      const cooling = this.lava[i] ? 0.018 : 0.045;
      this.temperature[i] += (baseline - this.temperature[i]) * Math.min(1, elapsed * cooling);
      if (this.rainRemaining > 0) {
        this.moisture[i] = Math.min(1, this.moisture[i] + elapsed * 0.018);
        this.temperature[i] -= elapsed * 0.06;
      }
      if (this.lava[i] && this.temperature[i] < 48) {
        this.lava[i] = 0;
        this.activeLava.delete(i);
      }
      this._classifyBiome(vx, vz);
      if (previousBiome !== this.biome[i]) {
        this.writeVertex(vx, vz, false);
        terrainChanged = true;
      }
      if (previousIce !== this.ice[i] || previousLava !== this.lava[i]) surfaceChanged = true;
    }
    if (this.rainRemaining > 0 && this.activeFires.size) {
      for (const index of [...this.activeFires.keys()].slice(0, 12)) {
        if (this._seededRandom() < 0.3) {
          this.activeFires.delete(index);
          const vx = index % this.verts, vz = Math.floor(index / this.verts);
          this.danger[index] = this.biomeIdAt(vx, vz) === 'swamp' ? 8 : 0;
        }
      }
    }
    if (terrainChanged || surfaceChanged) {
      this.navigationRevision++;
      if (surfaceChanged) this.scheduleClimateRefresh();
      if (terrainChanged) this.scheduleGrassRefresh(0.4);
    }
  }

  update(dt) {
    this._updateClimate(dt);
    for (const [i, t] of Array.from(this.activeFires.entries())) {
      const rem = t - dt;
      const gx = i % this.verts, gz = Math.floor(i / this.verts);
      if (rem <= 0) {
        this.removeTree(gx, gz);
        this.burntRegrow.set(i, 22 + Math.random() * 15);
        this.setBurntVisual(gx, gz, true);
      } else {
        this.activeFires.set(i, rem);
        if (this.laws.fireSpread !== false && Math.random() < dt * 0.5) {
          for (const [nx, nz] of this.neighbors4(gx, gz)) {
            const ni = this.idx(nx, nz);
            if (this.treeState[ni] > 0 && !this.activeFires.has(ni) && Math.random() < 0.4) {
              this.igniteTree(nx, nz);
            }
          }
        }
      }
    }
    if (this.laws.naturalRegrowth !== false) {
      for (const [i, t] of Array.from(this.burntRegrow.entries())) {
        const rem = t - dt;
        if (rem <= 0) {
          const gx = i % this.verts, gz = Math.floor(i / this.verts);
          this.setBurntVisual(gx, gz, false);
          this.burntRegrow.delete(i);
          if (this.treeState[i] === 0 && this.moisture[i] > 0.26 && Math.random() < 0.62) this.plantTree(gx, gz, false);
        } else this.burntRegrow.set(i, rem);
      }
    }
    for (const [i, s] of Array.from(this.saplings.entries())) {
      const rem = s.rem - dt;
      const gx = i % this.verts, gz = Math.floor(i / this.verts);
      const rec = this.treeSlots.get(i);
      if (rem <= 0) {
        this.treeState[i] = 2;
        this.saplings.delete(i);
        if (rec) this.updateTreeInstance(rec.kind, rec.slot, gx, gz, 1);
      } else {
        s.rem = rem;
        const growth = 0.12 + 0.88 * (1 - rem / s.total);
        if (rec) this.updateTreeInstance(rec.kind, rec.slot, gx, gz, growth);
      }
    }
    if (this.laws.naturalRegrowth !== false) {
      this._naturalRegrowthT += dt;
      const cycles = Math.min(3, Math.floor(this._naturalRegrowthT / 7));
      if (cycles > 0) this._naturalRegrowthT -= cycles * 7;
      for (let cycle = 0; cycle < cycles; cycle++) {
        const attempts = Math.max(1, Math.floor(this.size * this.size / 9000));
        for (let a = 0; a < attempts; a++) {
          if (this.treeSlots.size >= this.maxNaturalTrees) break;
          const gx = 1 + Math.floor(Math.random() * Math.max(1, this.size - 1));
          const gz = 1 + Math.floor(Math.random() * Math.max(1, this.size - 1));
          const i = this.idx(gx, gz);
          if (this.treeState[i] !== 0 || this.burnt[i] || this.moisture[i] < 0.38) continue;
          if (!this._hasNaturalTreeSpace(gx, gz)) continue;
          if (Math.random() < 0.42) this.plantTree(gx, gz, false);
        }
      }
    }
    this.refreshTerrainRegion();
    this._waterT += dt;
    this._waterTimeUniform.value = this._waterT;
    if (this.waterMesh) this.waterMesh.position.y = CONFIG.WATER_LEVEL + Math.sin(this._waterT * 0.35) * 0.015;
  }

  serialize() {
    const treeVisuals = [];
    for (const [i, rec] of this.treeSlots) treeVisuals.push([i, this.treeJitterByKind[rec.kind]?.[rec.slot] ?? 0.5]);
    return {
      version: 3,
      size: this.size,
      seed: this.seed,
      mapType: this.mapType,
      mountainLevel: this.mountainLevel,
      humidity: this.humidity,
      climate: this.climate,
      waterLevelPreset: this.waterLevelPreset,
      laws: { ...this.laws },
      height: Array.from(this.height),
      moisture: Array.from(this.moisture),
      jitter: Array.from(this.jitter),
      treeState: Array.from(this.treeState),
      treeKind: Array.from(this.treeKindArr),
      burnt: Array.from(this.burnt),
      settlementGround: Array.from(this.settlementGround),
      swampy: Array.from(this.swampy),
      riverMask: Array.from(this.riverMask),
      riverHeight: Array.from(this.riverHeight),
      biome: Array.from(this.biome),
      temperature: Array.from(this.temperature),
      lava: Array.from(this.lava),
      ice: Array.from(this.ice),
      mineralType: Array.from(this.mineralType),
      mineralAmount: Array.from(this.mineralAmount),
      treeVisuals,
      activeFires: Array.from(this.activeFires),
      burntRegrow: Array.from(this.burntRegrow),
      saplings: Array.from(this.saplings, ([i, s]) => [i, { rem: s.rem, total: s.total }]),
      waterTime: this._waterT,
      naturalRegrowthTime: this._naturalRegrowthT,
      rngState: this._seedRngState >>> 0,
      rainRemaining: this.rainRemaining,
      weatherTimer: this._weatherTimer,
      climateCursor: this._climateCursor,
    };
  }

  restore(data) {
    const state = data?.world && data.height == null ? data.world : data;
    if (!state || typeof state !== 'object') throw new TypeError('Estado de mundo inválido');

    const size = normalizedSize(state.size);
    const expected = (size + 1) * (size + 1);
    const isArrayLike = value => Array.isArray(value) || ArrayBuffer.isView(value);
    if (!isArrayLike(state.height) || state.height.length !== expected ||
        !isArrayLike(state.moisture) || state.moisture.length !== expected) {
      throw new Error('El guardado del mundo está incompleto o no coincide con su tamaño');
    }
    const readFloat = (source, fallback, clampMin, clampMax) => {
      const out = new Float32Array(expected);
      for (let i = 0; i < expected; i++) {
        const value = Number(source?.[i]);
        const valid = Number.isFinite(value) ? value : fallback;
        out[i] = Math.max(clampMin, Math.min(clampMax, valid));
      }
      return out;
    };
    const readByte = (source, max) => {
      const out = new Uint8Array(expected);
      if (!isArrayLike(source)) return out;
      for (let i = 0; i < expected; i++) out[i] = Math.max(0, Math.min(max, Number(source[i]) || 0));
      return out;
    };

    const height = readFloat(state.height, 0, 0, CONFIG.MAX_H);
    const moisture = readFloat(state.moisture, 0.5, 0, 1);
    const jitter = readFloat(isArrayLike(state.jitter) ? state.jitter : null, 1, 0.5, 1.5);
    const treeState = readByte(state.treeState, 2);
    const treeKindArr = readByte(state.treeKind, TREE_KINDS.length - 1);
    const burnt = readByte(state.burnt, 1);
    const settlementGround = readByte(state.settlementGround, 1);
    const swampy = readByte(state.swampy, 1);
    const riverMask = readByte(state.riverMask, 1);
    const riverHeight = readFloat(state.riverHeight, 0, 0, CONFIG.MAX_H);
    const hasEcology = isArrayLike(state.biome) && state.biome.length === expected &&
      isArrayLike(state.temperature) && state.temperature.length === expected;
    const hasMinerals = isArrayLike(state.mineralType) && state.mineralType.length === expected &&
      isArrayLike(state.mineralAmount) && state.mineralAmount.length === expected;
    const biome = readByte(state.biome, BIOME_IDS.length - 1);
    const temperature = readFloat(state.temperature, 0, -80, 180);
    const lava = readByte(state.lava, 1);
    const ice = readByte(state.ice, 1);
    const mineralType = readByte(state.mineralType, MINERAL_IDS.length - 1);
    const mineralAmount = readFloat(state.mineralAmount, 0, 0, 10000);

    this._configureSize(size);
    this.height = height;
    this.moisture = moisture;
    this.jitter = jitter;
    this.treeState = treeState;
    this._constructionTreeMask = null;
    this._roadGrassMask = null;
    this.treeKindArr = treeKindArr;
    this.burnt = burnt;
    this.settlementGround = settlementGround;
    this.swampy = swampy;
    this.riverMask = riverMask;
    this.riverHeight = riverHeight;
    this.biome = biome;
    this.temperature = temperature;
    this.lava = lava;
    this.ice = ice;
    this.mineralType = mineralType;
    this.mineralAmount = mineralAmount;
    const restoredSeed = Number(state.seed);
    this.seed = Number.isFinite(restoredSeed) ? restoredSeed : 1;
    this.mapType = typeof state.mapType === 'string' ? state.mapType : 'island';
    this.mountainLevel = Number.isFinite(Number(state.mountainLevel)) ? Number(state.mountainLevel) : 1;
    this.humidity = HUMIDITY_BIAS[state.humidity] !== undefined ? state.humidity : 'normal';
    this.climate = CLIMATE_MOISTURE_BIAS[state.climate] !== undefined ? state.climate : 'templado';
    this.waterLevelPreset = WATER_BIAS_HEIGHT[state.waterLevelPreset] !== undefined ? state.waterLevelPreset : 'normal';
    this._climateHeightBias = CLIMATE_HEIGHT_BIAS[this.climate] || 0;
    if (!hasEcology) this.rebuildEcology();
    else {
      this.activeLava.clear();
      for (let i = 0; i < this.n; i++) {
        if (this.lava[i]) this.activeLava.add(i);
        const id = BIOME_IDS[this.biome[i]] || 'grassland';
        this.danger[i] = this.lava[i] ? 100 : (id === 'swamp' ? 8 : 0);
      }
    }
    if (state.laws && typeof state.laws === 'object') Object.assign(this.laws, state.laws);
    this._resetSeededRandom(this.seed);
    if (!hasMinerals) this.generateMinerals();
    this.activeFires.clear();
    this.burntRegrow.clear();
    this.saplings.clear();
    this.treeSlots.clear();
    for (const kind of TREE_KINDS) { this.treeCellsByKind[kind].length = 0; this.nextTreeSlotByKind[kind] = 0; }
    this._waterT = Number.isFinite(Number(state.waterTime)) ? Number(state.waterTime) : 0;
    this._naturalRegrowthT = Number.isFinite(Number(state.naturalRegrowthTime)) ? Math.max(0, Number(state.naturalRegrowthTime)) : 0;

    if (Array.isArray(state.saplings)) {
      for (const entry of state.saplings) {
        const i = Number(entry?.[0]);
        const rem = Number(entry?.[1]?.rem), total = Number(entry?.[1]?.total);
        if (!Number.isInteger(i) || i < 0 || i >= this.n || this.treeState[i] !== 1) continue;
        if (Number.isFinite(rem) && Number.isFinite(total) && total > 0) this.saplings.set(i, { rem: Math.max(0, rem), total });
      }
    }
    for (let i = 0; i < this.n; i++) if (this.treeState[i] === 1 && !this.saplings.has(i)) this.treeState[i] = 2;
    // Older saves can carry trees planted before plantTree() checked riverMask (only sea level
    // was excluded), so a save from that era can still load with trees standing in a carved
    // river/lake — clear those out now instead of recreating the same water-logged tree forever.
    for (let i = 0; i < this.n; i++) {
      if (this.riverMask[i] && this.treeState[i] !== 0) { this.treeState[i] = 0; this.saplings.delete(i); }
    }

    this.buildTerrainMesh();
    this.buildWaterMesh();
    this.buildRiverMesh();
    this.buildClimateOverlays();
    this.buildMineralMesh();
    this.buildRainMesh();
    this.buildTreeMeshes();
    this.buildGrassMesh();
    const savedVisuals = new Map();
    if (Array.isArray(state.treeVisuals)) {
      for (const entry of state.treeVisuals) {
        const i = Number(entry?.[0]), value = Number(entry?.[1]);
        if (Number.isInteger(i) && i >= 0 && i < this.n && Number.isFinite(value)) savedVisuals.set(i, Math.max(0, Math.min(1, value)));
      }
    }
    for (let i = 0; i < this.n; i++) {
      if (this.treeState[i] === 0) continue;
      const kindIdx = Math.max(0, Math.min(TREE_KINDS.length - 1, this.treeKindArr[i]));
      const kind = TREE_KINDS[kindIdx];
      const slot = this.allocTreeSlot(kind, i);
      if (slot == null) { this.treeState[i] = 0; this.saplings.delete(i); continue; }
      if (savedVisuals.has(i)) this.treeJitterByKind[kind][slot] = savedVisuals.get(i);
      const gx = i % this.verts, gz = Math.floor(i / this.verts);
      this.updateTreeInstance(kind, slot, gx, gz, this.treeGrowthAt(i));
    }
    if (Array.isArray(state.activeFires)) {
      for (const entry of state.activeFires) {
        const i = Number(entry?.[0]), time = Number(entry?.[1]);
        if (Number.isInteger(i) && i >= 0 && i < this.n && this.treeState[i] !== 0 && Number.isFinite(time) && time > 0) {
          this.activeFires.set(i, time);
          this.danger[i] = Math.max(this.danger[i], 60);
        }
      }
    }
    if (Array.isArray(state.burntRegrow)) {
      for (const entry of state.burntRegrow) {
        const i = Number(entry?.[0]), time = Number(entry?.[1]);
        if (Number.isInteger(i) && i >= 0 && i < this.n && this.burnt[i] && Number.isFinite(time) && time > 0) this.burntRegrow.set(i, time);
      }
    }
    this.scatterGrass();
    this.rainRemaining = Math.max(0, Number(state.rainRemaining) || 0);
    this._weatherTimer = Math.max(0.1, Number(state.weatherTimer) || 20);
    this._climateCursor = Math.max(0, Math.trunc(Number(state.climateCursor) || 0)) % this.n;
    if (this.rainMesh) this.rainMesh.visible = this.rainRemaining > 0;
    const rngState = Number(state.rngState);
    if (Number.isInteger(rngState) && rngState >= 0) this._seedRngState = rngState >>> 0 || 0x9e3779b9;
    this._disposed = false;
    return this;
  }

  _disposeMesh(mesh) {
    if (!mesh) return;
    this.group?.remove(mesh);
    mesh.dispose?.();
    mesh.geometry?.disposeBoundsTree?.(); // no-op for geometries that never had one
    mesh.geometry?.dispose?.();
    mesh.customDepthMaterial?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material?.dispose?.();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._grassGroundTexture?.dispose();
    this._grassGroundTexture = null;
    this.groundDetails?.dispose();
    this.groundDetails = null;
    this.treeRenderer?.dispose();
    this.treeRenderer = null;
    this._seabedTexture?.dispose();
    this._disposeMesh(this.terrainMesh);
    this._disposeMesh(this.waterMesh);
    this._disposeMesh(this.riverMesh);
    this._disposeMesh(this.grassMesh);
    this._disposeMesh(this.iceMesh);
    this._disposeMesh(this.lavaMesh);
    this._disposeMesh(this.mineralMesh);
    this._disposeMesh(this.rainMesh);
    if (this.treeMeshes) {
      for (const kind of TREE_KINDS) {
        const set = this.treeMeshes[kind];
        for (const geometry of set.lods || []) geometry.dispose();
        this._disposeMesh(set.trunk);
        this._disposeMesh(set.foliageA);
        this._disposeMesh(set.foliageB);
      }
    }
    this.terrainMesh = null;
    this.waterMesh = null;
    this.riverMesh = null;
    this.grassMesh = null;
    this.iceMesh = null;
    this.lavaMesh = null;
    this.mineralMesh = null;
    this.rainMesh = null;
    this.treeMeshes = null;
    this.group?.clear?.();
    this.scene?.remove?.(this.group);
    this.activeFires.clear();
    this.burntRegrow.clear();
    this.saplings.clear();
    this.treeSlots.clear();
    this.activeLava.clear();
  }

  biomeLabel(vx, vz) {
    const labels = {
      autumn: 'Bosque otoñal', meadow: 'Pradera florida', ocean: 'Océano', beach: 'Playa', grassland: 'Pradera', forest: 'Bosque', desert: 'Desierto',
      swamp: 'Pantano', jungle: 'Jungla', savanna: 'Sabana', tundra: 'Tundra', alpine: 'Alta montaña', volcanic: 'Terreno volcánico',
    };
    return labels[this.biomeIdAt(vx, vz)] || 'Pradera';
  }

  mineralLabel(vx, vz) {
    if (!this.inBounds(vx, vz)) return '';
    const index = this.idx(vx, vz);
    if (this.mineralAmount[index] <= 0) return '';
    return ({ stone: 'Piedra', gold: 'Oro', gems: 'Gemas' })[MINERAL_IDS[this.mineralType[index]]] || '';
  }

  raycastPick(raycaster) {
    const hits = raycaster.intersectObject(this.terrainMesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const [gx, gz] = this.worldToGrid(hit.point.x, hit.point.z);
    return { gx, gz, point: hit.point };
  }
}

const _upAxis = new THREE.Vector3(0, 1, 0);
