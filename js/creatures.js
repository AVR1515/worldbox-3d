import * as THREE from 'three';
import { buildCreatureModel, attachWeapon, creatureAssetReady } from './models.js';
import { CONFIG } from './world.js';
import { pickTraits, applyTraits, genName } from './traits.js';
import { SpatialIndex } from './core/spatial-index.js';
import { NavigationGrid } from './navigation.js';

export const CREATURE_DEFINITIONS = Object.freeze({
  // size values scaled down again (~0.7x of the previous pass) so units read shorter
  // than a house's wall line instead of competing with the roofline.
  // Wildlife caps (herbivore/carnivore/fish/boar/bear) are deliberately tighter than
  // civilized-population caps: wild reproduction has no housing/food ceiling like villages
  // do (see _canReproducePair), so it always climbs straight to its cap and sits there. At
  // the old caps that meant 300-400+ animals permanently simulated and rendered, eating a
  // big share of the shared population budget (see setPopulationLimit) that citizens need
  // to grow past a hamlet, and directly costing frame time once fast-forward stacks several
  // simulation steps into one rendered frame.
  herbivore: { size: 0.4,  speed: 1.6, maxAge: 55, hungerRate: 2.1, cap: 200 },
  carnivore: { size: 0.48, speed: 2.1, maxAge: 45, hungerRate: 2.6, cap: 130 },
  human:     { size: 0.44, speed: 1.4, maxAge: 70, hungerRate: 1.7, cap: 320 },
  orc:       { size: 0.5,  speed: 1.5, maxAge: 55, hungerRate: 2.2, cap: 200 },
  elf:       { size: 0.43, speed: 1.7, maxAge: 100, hungerRate: 1.4, cap: 200 },
  dwarf:     { size: 0.39, speed: 1.1, maxAge: 90, hungerRate: 1.6, cap: 180 },
  zombie:    { size: 0.44, speed: 1.2, maxAge: 999999, hungerRate: 0, cap: 160 },
  fish:      { size: 0.21, speed: 1.7, maxAge: 25, hungerRate: 0, cap: 150 },
  boar:      { size: 0.46, speed: 1.75, maxAge: 32, hungerRate: 1.8, cap: 60 },
  // Bear hunts herbivore (see _decideWildPack) but at 1.55 was nominally *slower* than herbivore's
  // own 1.6 — even with the fleeMul fix above, a bear could never close on prey that wasn't
  // already standing still, since fleeing prey wasn't the only way it out-ran a bear. 2.0 keeps
  // it comfortably the faster of the two while staying under carnivore's own 2.1.
  bear:      { size: 0.65, speed: 2.0, maxAge: 42, hungerRate: 2.2, cap: 40 },
  dragon:    { size: 1.1, speed: 2.6, maxAge: 500, hungerRate: 0, cap: 18 },
  demon:     { size: 0.62, speed: 1.8, maxAge: 300, hungerRate: 0, cap: 50 },
  skeleton:  { size: 0.43, speed: 1.35, maxAge: 999999, hungerRate: 0, cap: 90 },
  mage:      { size: 0.46, speed: 1.45, maxAge: 140, hungerRate: 0, cap: 36 },
  fairy:     { size: 0.24, speed: 2.4, maxAge: 180, hungerRate: 0, cap: 80 },
  ghost:     { size: 0.45, speed: 1.7, maxAge: 999999, hungerRate: 0, cap: 80 },
  alien:     { size: 0.5, speed: 2.05, maxAge: 220, hungerRate: 0, cap: 50 },
});
const TYPES = CREATURE_DEFINITIONS;
export const CIVILIZED_TYPES = ['human', 'orc', 'elf', 'dwarf'];
export const FANTASY_TYPES = ['dragon', 'demon', 'skeleton', 'mage', 'fairy', 'ghost', 'alien'];
export const CREATURE_PACKS = Object.freeze({
  wildlife: Object.freeze(['herbivore', 'carnivore', 'fish', 'boar', 'bear']),
  civilizations: Object.freeze([...CIVILIZED_TYPES]),
  undead: Object.freeze(['zombie', 'skeleton', 'ghost']),
  fantasy: Object.freeze([...FANTASY_TYPES]),
});
// Wildlife caps above are flat counts, tuned by eye against the 'mediano' map preset (180 —
// see SIZE_PRESETS in world.js). Left flat, a 'pequeño' map (132, ~54% of that area) ends up just
// as crowded with animals as a 'grande' one (240, ~178% of it) — reported after real play as the
// small map reading as blanketed in wildlife. Scaling by area against that reference keeps
// density roughly constant across map sizes instead of just the raw count.
const WILDLIFE_CAP_REFERENCE_SIZE = 180;
const MIN_WILDLIFE_CAP = 15;

const FLYING_TYPES = new Set(['dragon', 'fairy', 'ghost', 'alien']);
const HOSTILE_FANTASY_TYPES = new Set(['dragon', 'demon', 'skeleton', 'ghost', 'alien']);
const RACE_BASE = {
  human: { hp: 1,    dmg: 1 },
  orc:   { hp: 1.3,  dmg: 1.4 },
  elf:   { hp: 0.85, dmg: 0.9 },
  dwarf: { hp: 1.4,  dmg: 1.1 },
  zombie:{ hp: 1.2,  dmg: 1.0 },
  bear: { hp: 1.55, dmg: 1.35 }, dragon: { hp: 4.5, dmg: 3.2 }, demon: { hp: 2.1, dmg: 1.9 },
  skeleton: { hp: 1.1, dmg: 1.25 }, mage: { hp: 1.2, dmg: 1.6 }, fairy: { hp: 0.55, dmg: 0.4 },
  ghost: { hp: 1.35, dmg: 1.45 }, alien: { hp: 1.7, dmg: 1.8 },
};
const INFECT_COLOR = new THREE.Color(0x8a3fbf);
const NORMAL_COLOR = new THREE.Color(0xffffff);
const SOLDIER_COLOR = new THREE.Color(0xff8a5c);
const ZOMBIE_COLOR = new THREE.Color(0x9fd68c);
const POSSESSED_COLOR = new THREE.Color(0x8fd6ff);
const COMMANDER_COLOR = new THREE.Color(0xffd76b);
const ARROW_GEO = new THREE.CylinderGeometry(0.014, 0.024, 0.32, 4);
ARROW_GEO.rotateX(Math.PI / 2);
const ARROW_MAT = new THREE.MeshBasicMaterial({ color: 0x3a2c1e });

const CIV_FOOD_THRESHOLD = 12;
const CIV_FOOD_RATE = 0.22;
const FOOD_NUTRITION = 12;
const HOMELESS_FORAGE_RATE = 1.8;
const REPRO_FOOD_MIN = 6;
const REPRO_FOOD_COST = 4;
// A settlement's home radius tops out at RADIUS_BY_LEVEL[3] = 13 (settlements.js), so two
// partners on opposite sides of a max-level city are already ~26 apart at worst — this lets a
// ready pair cross that without also dragging a soldier partner clear across a war campaign.
const PARTNER_SEEK_RANGE = 20;
const SWIM_SPEED_MUL = 0.42;
const SWIM_SURFACE_OFFSET = 0.08;
const HUNT_ATTACK_RANGE = 0.72;
const COMBAT_ATTACK_RANGE = 0.78;
const ARCHER_ATTACK_RANGE = 3.4;
const DODGE_BASE = 0.08;
const CHOP_DURATION = 4.5;
const POSSESSED_SPEED_MUL = 1.2;
const POSSESSED_RUN_MUL = 1.9; // on top of POSSESSED_SPEED_MUL, held Shift while walking a possessed creature
const JUMP_SPEED = 3.6; // initial upward velocity, world units/second
const JUMP_GRAVITY = 9.8; // world units/second^2, pulls jumpVelocity/jumpOffset back down
// Worst-case A* node visits this.navigation is allowed to spend per simulation tick (Fase 11) —
// about 3 full-cap searches (default maxVisited: 2600) worth, or many more partial ones. Bounds
// the frame-time spike a sudden wave of repath requests (a wall finishes, a war starts) can cause
// instead of letting every waiting creature resolve its search in the same tick.
//
// C-09 profiling (1.500 criaturas, escena madura) found this queue drain costing ~21 ms p95 of
// wall-clock time by itself — most of the whole simulation frame budget, on this one call. Capping
// it by wall-clock time instead of node count was tried and reverted: at population 240 with
// sustained repath demand (war-journey.spec.js) it throttled real throughput enough that soldiers
// took too long to get a path and arrived late (2/4 runs failed vs. 0/6 without the cap) — see
// HISTORIAL-PROGRESO.md. The actual fix needs to lower the per-node cost itself (findPathGrid's
// Map-based costs/cameFrom, traversalCost's redundant diagonal calls), not throttle throughput.
//
// C-13 found real (non-flat) terrain makes this call the dominant simulation cost even at modest
// population, because traversalCost() has actual obstacles (slopes, water) to route around that
// the flat reference plane never had — and at faster game speeds, GameRuntime's fixed-step clock
// runs this same call multiple times inside one rendered frame to catch up, multiplying that cost
// straight into frame time. update() now divides this budget by how many steps are running this
// frame (GameRuntime.predictSteps) instead of spending it in full on every one of them — same
// total node budget either way, just spread instead of paid per step, so per-frame cost stays
// bounded regardless of game speed. This is orthogonal to the wall-clock-cap idea above (that one
// throttled total throughput under sustained demand; this one only kicks in when multiple steps
// share a frame, and normal single-step frames get the exact budget they always did).
const NAV_QUEUE_NODE_BUDGET = 8000;
// How many consecutive failed pathfinding searches to the same destination a creature tolerates
// before giving up on that target entirely (see _resolveMovementTarget). Without this, a creature
// hunting/chasing something behind a permanent obstacle (a separate island, a walled area with no
// gate) retried A* forever, once per repathTimer (~0.8-1.25s), and simply stood still — never
// abandoning the target to go back to normal behavior.
const NAV_MAX_CONSECUTIVE_FAILS = 4;

let UID = 1;
const _tintColor = new THREE.Color();
const _viewProjection = new THREE.Matrix4();
const _viewFrustum = new THREE.Frustum();
const _viewPoint = new THREE.Vector3();
const _lodDummy = new THREE.Object3D();
const LOD_COLORS = {
  herbivore: 0xeee5d2, carnivore: 0x62514a, human: 0xc96a3f, orc: 0x587447,
  elf: 0x3f8f5f, dwarf: 0xa5622b, zombie: 0x718867, fish: 0x5f9fc4,
  boar: 0x754b32, bear: 0x49382d, dragon: 0xaa2d24, demon: 0x7c1f2b, skeleton: 0xd4cfb9,
  mage: 0x4169b1, fairy: 0xff9fe8, ghost: 0xa9dbe5, alien: 0x73d66d,
};

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function cloneSerializable(value, seen = new WeakSet()) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return undefined;
  if (value.isObject3D || value.isMaterial || value.isTexture || value.isBufferGeometry) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map(item => cloneSerializable(item, seen)).filter(item => item !== undefined);
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const cloned = cloneSerializable(item, seen);
    if (cloned !== undefined) result[key] = cloned;
  }
  seen.delete(value);
  return result;
}

function normalizePoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  return { x: point.x, z: point.z };
}

export class CreatureManager {
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.laws = opts?.laws ?? {};
    this.settlementManager = null;
    this.civilizationSystem = null;
    this.statusSystem = null;
    this.populationLimit = Number.POSITIVE_INFINITY;
    this.creatures = [];
    this.creatureById = new Map();
    this.countsByType = new Map();
    this.settlementById = new Map();
    this.group = new THREE.Group();
    this.disposed = false;
    this._possessedInput = { x: 0, z: 0 };
    this.projectiles = [];
    this.possessedId = null;
    this.events = opts.events || null;
    this.spatialIndex = new SpatialIndex(opts.spatialCellSize || 8);
    this.navigation = new NavigationGrid(world, { maxVisited: opts.navigationMaxVisited || 2600 });
    this._spatialDirty = true;
    this._radiusQuery = [];
    this._visualUpdateTimer = 0;
    this._animationTime = 0;
    // Opt-in fine-grained timing (C-09): off by default, zero performance.now() overhead in
    // normal play. Splits update() into the phases that matter to know where CPU actually goes
    // before optimizing anything, instead of guessing.
    this.profileDetail = false;
    this.lastDetailTimings = null;
    this.visualStats = { detailed: 0, instanced: 0, culled: 0 };
    this.farLodMeshes = new Map();
    for (const [type, definition] of Object.entries(TYPES)) {
      const geometry = new THREE.BoxGeometry(0.42, type === 'fish' ? 0.18 : 0.72, type === 'fish' ? 0.72 : 0.42);
      const material = new THREE.MeshLambertMaterial({ color: LOD_COLORS[type] || 0xffffff });
      const mesh = new THREE.InstancedMesh(geometry, material, this._effectiveCap(type, definition));
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.lodType = type;
      this.group.add(mesh);
      this.farLodMeshes.set(type, mesh);
    }
    scene.add(this.group);
  }

  _ensureSpatialIndex() {
    if (this._spatialDirty) {
      this.spatialIndex.rebuild(this.creatures, creature => creature?.alive);
      this._spatialDirty = false;
    }
    return this.spatialIndex;
  }

  setSettlementManager(manager) {
    this.settlementManager = manager || null;
    this._refreshSettlementIndex();
    return this;
  }

  setCivilizationSystem(system) {
    this.civilizationSystem = system || null;
    return this;
  }

  setStatusSystem(system) {
    this.statusSystem = system || null;
    return this;
  }

  setPopulationLimit(limit) {
    this.populationLimit = Number.isFinite(Number(limit)) ? Math.max(100, Number(limit)) : Number.POSITIVE_INFINITY;
    return this;
  }

  _lawEnabled(name) {
    if (!this.laws) return true;
    const value = this.laws instanceof Map ? this.laws.get(name) : this.laws[name];
    if (value && typeof value === 'object' && 'enabled' in value) return value.enabled !== false;
    return value !== false;
  }

  _refreshSettlementIndex() {
    this.settlementById.clear();
    const list = this.settlementManager?.settlements;
    if (!Array.isArray(list)) return;
    for (const settlement of list) {
      if (settlement && settlement.id != null) this.settlementById.set(settlement.id, settlement);
    }
  }

  _getSettlement(id) {
    if (id == null) return null;
    let settlement = this.settlementById.get(id) || null;
    if (settlement) return settlement;
    const list = this.settlementManager?.settlements;
    if (!Array.isArray(list)) return null;
    settlement = list.find(item => item?.id === id) || null;
    if (settlement) this.settlementById.set(id, settlement);
    return settlement;
  }

  _createModel(type, visualScale, id, sex) {
    const built = buildCreatureModel(type, sex);
    built.root.scale.setScalar(visualScale);
    built.root.userData.creatureId = id;
    this.group.add(built.root);
    return built;
  }

  _isLiquidWaterWorld(x, z, belowBridge = false) {
    if (!belowBridge && this.world.bridgeHeightAtWorld?.(x, z) != null) return false;
    const [vx, vz] = this.world.worldToGrid(x, z);
    return this.world.isWater(vx, vz) && !this.world.ice?.[this.world.idx(vx, vz)];
  }

  _clearNavigation(c) {
    c.navPath = null;
    c.navPathIndex = 0;
    c.navDestination = null;
    c.navRevision = -1;
    c.navPathPending = false;
    c.navFailCount = 0;
  }

  _resolveMovementTarget(c, target) {
    if (!target) return null;
    const mode = c.flying ? 'air' : (c.type === 'fish' ? 'water' : 'land');
    const blocked = mode === 'land' && this.settlementManager
      ? (vx, vz) => this.settlementManager.isNavigationBlockedGrid(vx, vz)
      : null;
    const from = { x: c.x, z: c.z };
    if (this.navigation.isLinePassable(from, target, mode, blocked)) {
      this._clearNavigation(c);
      return { point: target, final: true };
    }
    // A permanently unreachable destination (a separate island, a walled area with no gate) used
    // to retry A* forever without ever giving up, so the creature just stood still hunting/chasing
    // something it could never reach. After enough consecutive failed searches for this same
    // destination, abandon the target entirely instead of retrying indefinitely.
    if ((c.navFailCount || 0) >= NAV_MAX_CONSECUTIVE_FAILS) {
      c.target = null;
      c.hunting = null;
      c.combatTarget = null;
      this._clearNavigation(c);
      return null;
    }
    const destinationChanged = !c.navDestination ||
      Math.hypot(c.navDestination.x - target.x, c.navDestination.z - target.z) > 2.2;
    const revisionChanged = c.navRevision !== (this.world.navigationRevision || 0);
    if (destinationChanged) c.navFailCount = 0;
    if ((destinationChanged || revisionChanged || !c.navPath?.length) && c.repathTimer <= 0 && !c.navPathPending) {
      // Queued instead of resolved inline: a moment where many creatures all need a real A*
      // search at once (a wall finishes, a war starts) used to be able to run dozens of full
      // searches in a single simulation tick. this.navigation.processQueue(), called once per
      // tick from update(), spreads that cost across as many ticks as it takes to stay under a
      // node-visit budget. repathTimer is still set immediately so this creature doesn't queue
      // a second request every tick while the first is still pending.
      c.navPathPending = true;
      // A hunt/combat target keeps moving while this creature is mid-chase — the normal
      // 0.8-1.25s interval below (fine for a wandering creature heading toward a fixed point)
      // let an actively hunted target drift a unit or two past the stale path's endpoint before
      // the next repath, often enough on its own to keep it just outside HUNT_ATTACK_RANGE
      // (0.72) indefinitely: a predator with a real speed advantage could chase the same target
      // for 30+ seconds on real (non-flat) terrain without ever landing a hit, starving before
      // catching anything — reported live, with a screenshot, as a world settling into nothing
      // but herbivores. Flat/open terrain never hit this (isLinePassable's direct-line branch
      // above always tracks the live position), which is why it only showed up once the world
      // had actual hills to route around. Repath much sooner while actively pursuing a moving
      // target; a wandering/idle destination doesn't move, so it doesn't need to.
      const pursuing = c.hunting != null || c.combatTarget != null;
      c.repathTimer = pursuing ? 0.2 + Math.random() * 0.15 : 0.8 + Math.random() * 0.45;
      const requestedDestination = { x: target.x, z: target.z };
      const requestedRevision = this.world.navigationRevision || 0;
      this.navigation.requestPath(from, target, { mode, isBlocked: blocked }, path => {
        c.navPathPending = false;
        if (!c.alive) return;
        c.navPath = path;
        c.navPathIndex = 0;
        c.navDestination = requestedDestination;
        c.navRevision = requestedRevision;
        c.navFailCount = (path && path.length) ? 0 : (c.navFailCount || 0) + 1;
      });
    }
    while (c.navPath && c.navPathIndex < c.navPath.length) {
      const point = c.navPath[c.navPathIndex];
      if (Math.hypot(point.x - c.x, point.z - c.z) > 0.28) {
        return { point, final: c.navPathIndex === c.navPath.length - 1 };
      }
      c.navPathIndex++;
    }
    if (c.navPath?.length && c.navPathIndex >= c.navPath.length) {
      this._clearNavigation(c);
      return { point: target, final: true };
    }
    return null;
  }

  _makeDefaultCreature(type, x, z, id, seed = {}) {
    const def = TYPES[type];
    const civilized = CIVILIZED_TYPES.includes(type);
    const isFish = type === 'fish';
    const sex = civilized ? (seed.sex === 'm' || seed.sex === 'f' ? seed.sex : (Math.random() < 0.5 ? 'm' : 'f')) : null;
    const traits = civilized && Array.isArray(seed.traits) ? [...seed.traits] : (civilized ? pickTraits() : []);
    const inWater = this._isLiquidWaterWorld(x, z, isFish);
    const c = {
      id, type, model3d: null, x, z,
      y: isFish
        ? Math.max(this.world.heightAtWorld(x, z) + 0.15, CONFIG.WATER_LEVEL - 0.35)
        : (this.world.bridgeHeightAtWorld?.(x, z) ?? (inWater && civilized ? (this.world.riverSurfaceAtWorld?.(x,z) ?? CONFIG.WATER_LEVEL) + SWIM_SURFACE_OFFSET : this.world.heightAtWorld(x, z))),
      heading: Math.random() * Math.PI * 2,
      target: null, wanderTimer: 0, aiTimer: Math.random() * 0.5,
      hunger: 20 + Math.random() * 20, age: Math.random() * 5, maxAge: def.maxAge * (0.85 + Math.random() * 0.3),
      reproCooldown: 10 + Math.random() * 10, infected: false, infectTimer: 0,
      alive: true, phase: Math.random() * 10, possessed: false, choppingTree: null,
      jumpOffset: 0, jumpVelocity: 0,
      commander: false, archer: false, chopTimer: null, masterwork: false,
      flying: FLYING_TYPES.has(type),
      garrison: false, garrisonPos: null, garrisonSettlementId: null,
      settlementId: null, homeX: 0, homeZ: 0, homeRadius: 0,
      name: civilized ? (seed.name ?? genName(sex, type)) : null,
      sex, profession: civilized ? (seed.profession ?? 'Aldeano') : null, traits,
      empireId: null, role: null, warTargetEmpire: null, warDestination: null, combatTarget: null,
      stanceOffenseMul: 1, stanceDefenseMul: 1,
      hunting: null, fleeing: false, swimming: civilized && inWater,
      oxygen: 12, maxOxygen: 12,
      navPath: null, navPathIndex: 0, navDestination: null, navRevision: -1, repathTimer: 0, navPathPending: false, navFailCount: 0,
      visualScale: finiteOr(seed.visualScale, def.size * (0.9 + Math.random() * 0.22)),
      _genomeSeed: seed.genome && typeof seed.genome === 'object' ? { ...seed.genome } : null,
    };
    applyTraits(c);
    const rb = RACE_BASE[type];
    if (rb) { c.maxHealth *= rb.hp; c.damageMul *= rb.dmg; }
    if (type === 'dragon' || type === 'demon') c.fireImmune = true;
    if (type === 'ghost') { c.fearless = true; c.diseaseResist = true; }
    if (type === 'fairy') c.diseaseResist = true;
    c.health = c.maxHealth;
    return c;
  }

  count(type) {
    if (type) return this.countsByType.get(type) || 0;
    let total = 0;
    for (const value of this.countsByType.values()) total += value;
    return total;
  }

  // Wildlife's flat cap, scaled by this map's area relative to WILDLIFE_CAP_REFERENCE_SIZE — see
  // the comment on that constant. Every other pack (civilized, undead, fantasy) keeps its cap
  // exactly as authored: civilized growth is already gated by settlement housing long before
  // these caps matter, and fantasy/undead types are player-summoned with their own limits, not
  // organically filling the map the way wildlife reproduction does.
  _effectiveCap(type, def) {
    if (!CREATURE_PACKS.wildlife.includes(type)) return def.cap;
    const areaRatio = (this.world.size / WILDLIFE_CAP_REFERENCE_SIZE) ** 2;
    return Math.max(MIN_WILDLIFE_CAP, Math.round(def.cap * areaRatio));
  }

  spawn(type, x, z, seed = {}) {
    const def = TYPES[type];
    if (this.disposed || !def || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    if (this.count() >= this.populationLimit) return null;
    if (this.count(type) >= this._effectiveCap(type, def)) return null;
    const inWater = this._isLiquidWaterWorld(x, z, type === 'fish');
    if (type === 'fish' ? !inWater : inWater) return null;

    const c = this._makeDefaultCreature(type, x, z, UID++, seed);
    c.model3d = this._createModel(type, c.visualScale, c.id, c.sex);
    this.creatures.push(c);
    this.creatureById.set(c.id, c);
    this.countsByType.set(type, (this.countsByType.get(type) || 0) + 1);
    this._spatialDirty = true;
    this._updateInstance(c);
    this.events?.emit?.('creature:spawned', { creature: c });
    this.civilizationSystem?.ensurePerson(c);
    return c;
  }

  setHome(c, id, empireId, x, z, radius) {
    c.settlementId = id; c.empireId = empireId; c.homeX = x; c.homeZ = z; c.homeRadius = radius; c.target = null;
    this._clearNavigation(c);
  }

  clearHome(c) {
    c.settlementId = null; c.homeRadius = 0;
  }

  // ---------- Direct possession (player-controlled creature) ----------
  setPossessed(c, on) {
    if (!c) return;
    c.possessed = !!on;
    if (c.possessed) {
      this.possessedId = c.id;
      c.target = null; c.hunting = null; c.combatTarget = null; c.fleeing = false;
    } else if (this.possessedId === c.id) {
      this.possessedId = null;
      this._possessedInput.x = 0; this._possessedInput.z = 0;
    }
  }

  releasePossessed() {
    const c = this.possessedId != null ? this.creatureById.get(this.possessedId) : null;
    if (c) this.setPossessed(c, false);
    this.possessedId = null;
    this._possessedInput.x = 0; this._possessedInput.z = 0;
  }

  setPossessedInput(x, z, run = false) {
    this._possessedInput.x = x;
    this._possessedInput.z = z;
    this._possessedInput.run = run;
  }

  // Edge-triggered by main.js on a Space keydown (not held-key polling, so it can't repeat every
  // frame) — only takes effect while the possessed creature is on the ground (jumpOffset ~ 0), the
  // same "grounded" check a platformer's coyote-time-free jump uses.
  triggerJump() {
    const c = this.possessedId != null ? this.creatureById.get(this.possessedId) : null;
    if (!c || !c.alive || c.jumpOffset > 0.01) return;
    c.jumpVelocity = JUMP_SPEED;
  }

  killAllInRadius(wx, wz, radius) {
    let killed = 0;
    const nearby = this._ensureSpatialIndex().queryRadius(wx, wz, radius, creature => creature.alive, this._radiusQuery);
    for (const c of nearby) {
      this._kill(c);
      killed++;
    }
    if (killed) {
      this.creatures = this.creatures.filter(c => c.alive);
      this._spatialDirty = true;
    }
    return killed;
  }

  pullInRadius(wx, wz, radius, strength) {
    const nearby = this._ensureSpatialIndex().queryRadius(wx, wz, radius, creature => creature.alive && !creature.possessed, this._radiusQuery);
    for (const c of nearby) {
      const dx = wx - c.x, dz = wz - c.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) continue;
      const pull = strength * (1 - d / radius);
      c.x += (dx / d) * pull;
      c.z += (dz / d) * pull;
      c.target = null;
      c.choppingTree = null;
    }
    if (nearby.length) this._spatialDirty = true;
  }

  // ---------- Arrow projectiles (visual only — damage is already applied by the caller) ----------
  _spawnArrow(ax, ay, az, bx, by, bz) {
    const mesh = new THREE.Mesh(ARROW_GEO, ARROW_MAT);
    mesh.position.set(ax, ay, az);
    mesh.rotation.y = Math.atan2(bx - ax, bz - az);
    this.scene.add(mesh);
    this.projectiles.push({ mesh, from: { x: ax, y: ay, z: az }, to: { x: bx, y: by, z: bz }, t: 0, duration: 0.22 });
  }

  _updateProjectiles(dt) {
    if (!this.projectiles.length) return;
    for (const p of this.projectiles.slice()) {
      p.t += dt;
      const frac = Math.min(1, p.t / p.duration);
      const x = p.from.x + (p.to.x - p.from.x) * frac;
      const z = p.from.z + (p.to.z - p.from.z) * frac;
      const arc = Math.sin(frac * Math.PI) * 0.3;
      p.mesh.position.set(x, p.from.y + (p.to.y - p.from.y) * frac + arc, z);
      if (frac >= 1) {
        this.scene.remove(p.mesh);
        this.projectiles = this.projectiles.filter(item => item !== p);
      }
    }
  }

  healInRadius(wx, wz, radius) {
    const nearby = this._ensureSpatialIndex().queryRadius(wx, wz, radius, creature => creature.alive, this._radiusQuery);
    for (const c of nearby) {
      c.health = c.maxHealth;
      c.hunger = Math.max(0, c.hunger - 60);
      c.infected = false;
      c.infectTimer = 0;
      this.statusSystem?.clearNegative?.(c);
    }
  }

  infectInRadius(wx, wz, radius) {
    if (!this._lawEnabled('disease')) return;
    const nearby = this._ensureSpatialIndex().queryRadius(wx, wz, radius, creature => creature.alive, this._radiusQuery);
    for (const c of nearby) {
      if (!(c.diseaseResist && Math.random() < 0.5)) {
        c.infected = true;
        c.infectTimer = 14 + Math.random() * 6;
      }
    }
  }

  nearestOfType(x, z, types, maxDist, excludeId, predicate) {
    return this._ensureSpatialIndex().nearest(x, z, maxDist, c =>
      c.alive && c.id !== excludeId && types.includes(c.type) && (!predicate || predicate(c)));
  }

  queryRadius(x, z, radius, predicate = null, out = []) {
    return this._ensureSpatialIndex().queryRadius(x, z, radius, predicate, out);
  }

  _kill(c) {
    if (!c?.alive) return false;
    c.alive = false;
    this.creatureById.delete(c.id);
    this.countsByType.set(c.type, Math.max(0, (this.countsByType.get(c.type) || 1) - 1));
    this._spatialDirty = true;
    if (this.possessedId === c.id) this.releasePossessed();
    if (c.model3d) {
      this.group.remove(c.model3d.root);
      c.model3d.root.traverse(o => { if (o.isMesh) o.material?.dispose?.(); });
      c.model3d = null;
    }
    this.events?.emit?.('creature:died', { creature: c });
    return true;
  }

  _pickWanderTarget(c) {
    const world = this.world;
    const anchorX = c.settlementId ? c.homeX : c.x;
    const anchorZ = c.settlementId ? c.homeZ : c.z;
    const strandedSwimmer = CIVILIZED_TYPES.includes(c.type) && this._isLiquidWaterWorld(c.x, c.z);
    const maxReach = strandedSwimmer ? 18 : (c.settlementId ? c.homeRadius : 4);
    const tries = strandedSwimmer ? 18 : 6;
    for (let attempt = 0; attempt < tries; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = c.settlementId ? Math.random() * maxReach : 1.5 + Math.random() * maxReach;
      const tx = anchorX + Math.cos(ang) * dist;
      const tz = anchorZ + Math.sin(ang) * dist;
      if (!this._isLiquidWaterWorld(tx, tz)) { c.target = { x: tx, z: tz }; return; }
    }
    c.target = null;
  }

  _pickWanderTargetWater(c) {
    const world = this.world;
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 1 + Math.random() * 5;
      const tx = c.x + Math.cos(ang) * dist, tz = c.z + Math.sin(ang) * dist;
      if (this._isLiquidWaterWorld(tx, tz, true)) { c.target = { x: tx, z: tz }; return; }
    }
    c.target = null;
  }

  // Lumberjacks path to the nearest grown tree within their settlement's reach and
  // chop it on arrival (see _chopTree) instead of generating wood out of thin air.
  _decideLumberjack(c) {
    if (this._seekPartner(c)) return;
    if (c.choppingTree) {
      if (c.chopTimer == null && !c.target) c.target = { x: c.choppingTree.wx, z: c.choppingTree.wz };
      return;
    }
    // Search radius grows with the settlement's own size instead of a flat 9-unit floor —
    // a brand-new village shouldn't be able to reach out and clear-cut a huge area on day one.
    const tree = this.world.findNearestTree(c.x, c.z, (c.homeRadius || 4) + 2);
    if (tree) { c.choppingTree = tree; c.target = { x: tree.wx, z: tree.wz }; return; }
    if (!c.target || Math.random() < 0.2) this._pickWanderTarget(c);
  }

  _chopTree(c) {
    const tree = c.choppingTree;
    c.choppingTree = null;
    if (!tree || !this.world.hasTree(tree.gx, tree.gz)) return;
    this.world.removeTree(tree.gx, tree.gz);
    const settlement = this._getSettlement(c.settlementId);
    if (settlement?.resources) settlement.resources.wood = finiteOr(settlement.resources.wood, 0) + 3.5;
  }

  _decideSoldier(c) {
    if (c.warTargetEmpire == null) {
      if (this.settlementManager?._demobilize) this.settlementManager._demobilize(c);
      else { c.role = null; c.profession = 'Aldeano'; c.economicRoleSet = false; c.combatTarget = null; }
      return;
    }
    const enemy = this.nearestOfType(c.x, c.z, CIVILIZED_TYPES, 10, c.id, cc => cc.empireId === c.warTargetEmpire);
    if (enemy) {
      c.target = { x: enemy.x, z: enemy.z };
      c.combatTarget = enemy.id;
      return;
    }
    c.combatTarget = null;
    if (c.warDestination) c.target = { x: c.warDestination.x, z: c.warDestination.z };
  }

  _isAtWarWith(empireIdA, empireIdB) {
    if (empireIdA == null || empireIdB == null || empireIdA === empireIdB) return false;
    const empireA = this.settlementManager?.empires?.find(e => e.id === empireIdA);
    return empireA?.relations?.get(empireIdB)?.status === 'war';
  }

  // A tower garrison never marches out — it just holds its post and shoots (as an archer)
  // at whichever enemy of its empire wanders within range, reusing the same combat/arrow
  // machinery as regular soldiers via c.combatTarget + c.archer.
  _decideGarrison(c) {
    const pos = c.garrisonPos || { x: c.homeX, z: c.homeZ };
    const enemy = this.nearestOfType(c.x, c.z, CIVILIZED_TYPES, ARCHER_ATTACK_RANGE + 1.5, c.id,
      cc => cc.empireId != null && this._isAtWarWith(c.empireId, cc.empireId));
    if (enemy) { c.target = { x: enemy.x, z: enemy.z }; c.combatTarget = enemy.id; return; }
    c.combatTarget = null;
    const d = Math.hypot(c.x - pos.x, c.z - pos.z);
    c.target = d > 0.6 ? { x: pos.x, z: pos.z } : null;
  }

  _decideZombie(c) {
    const prey = this.nearestOfType(c.x, c.z, ['herbivore', 'carnivore', ...CIVILIZED_TYPES], 9, c.id);
    if (prey) { c.target = { x: prey.x, z: prey.z }; c.hunting = prey.id; return; }
    c.hunting = null;
    if (!c.target || Math.random() < 0.15) this._pickWanderTarget(c);
  }

  _decideFantasy(c) {
    if (c.type === 'fairy') {
      const wounded = this._ensureSpatialIndex().nearest(c.x, c.z, 5, other =>
        other.alive && other.id !== c.id && other.health < other.maxHealth * 0.7 && !HOSTILE_FANTASY_TYPES.has(other.type));
      if (wounded) {
        wounded.health = Math.min(wounded.maxHealth, wounded.health + 6);
        c.target = { x: wounded.x, z: wounded.z };
        return;
      }
    }
    if (c.type === 'mage') {
      const enemy = this._ensureSpatialIndex().nearest(c.x, c.z, 11, other =>
        other.alive && other.id !== c.id && HOSTILE_FANTASY_TYPES.has(other.type));
      if (enemy) {
        c.archer = true;
        c.combatTarget = enemy.id;
        c.target = { x: enemy.x, z: enemy.z };
        return;
      }
      c.combatTarget = null;
    }
    if (HOSTILE_FANTASY_TYPES.has(c.type)) {
      const prey = this._ensureSpatialIndex().nearest(c.x, c.z, c.type === 'dragon' ? 16 : 10, other =>
        other.alive && other.id !== c.id && !HOSTILE_FANTASY_TYPES.has(other.type));
      if (prey) {
        c.hunting = prey.id;
        c.target = { x: prey.x, z: prey.z };
        return;
      }
      c.hunting = null;
    }
    if (!c.target || Math.random() < 0.18) this._pickWanderTarget(c);
  }

  _decideWildPack(c) {
    if (c.type === 'boar') {
      const threat = this.nearestOfType(c.x, c.z, ['bear', 'carnivore', ...HOSTILE_FANTASY_TYPES], 5, c.id);
      if (threat && !c.fearless) {
        const dx = c.x - threat.x, dz = c.z - threat.z, distance = Math.hypot(dx, dz) || 1;
        c.target = { x: c.x + dx / distance * 5, z: c.z + dz / distance * 5 };
        c.fleeing = true;
        return;
      }
      c.fleeing = false;
    } else if (c.type === 'bear' && c.hunger > 35) {
      const prey = this.nearestOfType(c.x, c.z, ['herbivore', 'boar', ...CIVILIZED_TYPES], 10, c.id);
      if (prey) { c.hunting = prey.id; c.target = { x: prey.x, z: prey.z }; return; }
    }
    c.hunting = null;
    // Boar and bear had no reproduction path anywhere in this file — every other branch above
    // either flees, hunts, or falls through to wander. Their numbers could therefore only ever
    // fall (aging, predation, manual removal) and never recover, so a long-running world
    // eventually loses them outright while herbivores — which do reproduce, and lose one of their
    // two natural predators once bears are gone — grow unchecked toward their own cap (reported
    // live, with a screenshot: a field solid with sheep and no other animal in sight). Same
    // pattern as the herbivore/carnivore reproduction above, tuned to each type's own stats:
    // permissive for boar (a prey species that breeds readily once not actively fleeing), gated
    // by successful hunting for bear (an apex predator, like carnivore's own gate).
    if (this._lawEnabled('reproduction') && c.health > 60 && c.reproCooldown <= 0 &&
        c.age > (c.type === 'bear' ? 6 : 4) && c.age < c.maxAge * 0.85) {
      const hungerCeiling = c.type === 'bear' ? 15 : 18;
      if (c.hunger < hungerCeiling) {
        const mate = this.nearestOfType(c.x, c.z, [c.type], 3, c.id);
        if (mate && mate.reproCooldown <= 0 && mate.hunger < hungerCeiling && this._canReproducePair(c, mate)) {
          this._tryReproduce(c, mate);
          return;
        }
      }
    }
    if (!c.target || Math.random() < 0.14) this._pickWanderTarget(c);
  }

  _homeHasFood(c, amount = REPRO_FOOD_MIN) {
    const settlement = this._getSettlement(c.settlementId);
    return !!settlement?.resources && finiteOr(settlement.resources.food, 0) >= amount;
  }

  _canReproducePair(a, b) {
    if (!this._lawEnabled('reproduction') || !a?.alive || !b?.alive || a.type !== b.type) return false;
    if (!CIVILIZED_TYPES.includes(a.type)) return true;
    if (this.civilizationSystem && !this.civilizationSystem.canReproduce(a, b)) return false;
    if (a.settlementId == null || a.settlementId !== b.settlementId || !this._homeHasFood(a)) return false;
    // Births are capped by how much housing the settlement actually has — otherwise
    // population keeps climbing on food alone long after the city has run out of room,
    // which is both unrealistic and (with a few hundred extra 3D units) a real frame-rate hit.
    const settlement = this._getSettlement(a.settlementId);
    const capacity = Math.max(10, (settlement?.houses?.length || 0) * 4.5);
    return (settlement?.pop || 0) < capacity;
  }

  // Civilized reproduction requires an already-matched couple (canReproduce() checks mutual
  // partnerId), but a settlement's citizens otherwise wander independently on their own jobs —
  // without this, they'd only ever reproduce by the coincidence of both drifting into the same
  // 3-unit patch, which in practice almost never happened once a village had more than its
  // founding handful of people. Walk a ready pair toward each other instead of leaving it to
  // chance; returns true if this creature spent its turn on reproduction (bred or is walking
  // toward its partner), so the caller should stop deciding anything else this tick.
  _seekPartner(c) {
    if (!this._lawEnabled('reproduction') || c.hunger >= 20 || c.health <= 60 || c.reproCooldown > 0 ||
        c.age <= 6 || c.age >= c.maxAge * 0.8 || c.settlementId == null) return false;
    const partner = this.civilizationSystem?.getPartner?.(c);
    if (!partner || partner.reproCooldown > 0 || partner.hunger >= 20 || !this._canReproducePair(c, partner)) return false;
    const d = Math.hypot(partner.x - c.x, partner.z - c.z);
    if (d <= 3) { this._tryReproduce(c, partner); return true; }
    if (d <= PARTNER_SEEK_RANGE) { c.target = { x: partner.x, z: partner.z }; return true; }
    return false;
  }

  _decide(c) {
    if (c.type === 'zombie') { this._decideZombie(c); return; }
    if (c.type === 'boar' || c.type === 'bear') { this._decideWildPack(c); return; }
    if (FANTASY_TYPES.includes(c.type)) { this._decideFantasy(c); return; }
    if (CIVILIZED_TYPES.includes(c.type) && c.garrison) { this._decideGarrison(c); return; }
    if (CIVILIZED_TYPES.includes(c.type) && c.role === 'soldado') { this._decideSoldier(c); return; }
    if (CIVILIZED_TYPES.includes(c.type) && c.profession === 'Leñador' && c.settlementId != null) { this._decideLumberjack(c); return; }

    if (c.type === 'fish') {
      if (this._lawEnabled('reproduction') && c.health > 60 && c.reproCooldown <= 0 && c.age > 3 && c.age < c.maxAge * 0.85) {
        const mate = this.nearestOfType(c.x, c.z, ['fish'], 3, c.id);
        if (mate && mate.reproCooldown <= 0 && this._canReproducePair(c, mate)) {
          this._tryReproduce(c, mate);
          return;
        }
      }
      if (!c.target || Math.random() < 0.15) this._pickWanderTargetWater(c);
    } else if (c.type === 'herbivore') {
      const threat = c.fearless ? null : this.nearestOfType(c.x, c.z, ['carnivore', 'zombie'], 4.5, c.id);
      if (threat) {
        const dx = c.x - threat.x, dz = c.z - threat.z;
        const d = Math.hypot(dx, dz) || 1;
        c.target = { x: c.x + (dx / d) * 4, z: c.z + (dz / d) * 4 };
        c.fleeing = true;
        return;
      }
      c.fleeing = false;
      if (this._lawEnabled('reproduction') && c.hunger < 18 && c.health > 60 && c.reproCooldown <= 0 && c.age > 5 && c.age < c.maxAge * 0.85) {
        const mate = this.nearestOfType(c.x, c.z, ['herbivore'], 3, c.id);
        if (mate && mate.reproCooldown <= 0 && mate.hunger < 18 && this._canReproducePair(c, mate)) {
          this._tryReproduce(c, mate);
          return;
        }
      }
      if (!c.target || Math.random() < 0.15) this._pickWanderTarget(c);
    } else if (c.type === 'carnivore') {
      if (c.hunger > 40) {
        const prey = this.nearestOfType(c.x, c.z, ['herbivore', ...CIVILIZED_TYPES], 8, c.id);
        if (prey) { c.target = { x: prey.x, z: prey.z }; c.hunting = prey.id; return; }
      }
      c.hunting = null;
      if (this._lawEnabled('reproduction') && c.hunger < 15 && c.health > 60 && c.reproCooldown <= 0 && c.age > 4 && c.age < c.maxAge * 0.85) {
        const mate = this.nearestOfType(c.x, c.z, ['carnivore'], 3, c.id);
        if (mate && mate.reproCooldown <= 0 && mate.hunger < 15 && this._canReproducePair(c, mate)) {
          this._tryReproduce(c, mate);
          return;
        }
      }
      if (!c.target || Math.random() < 0.12) this._pickWanderTarget(c);
    } else if (CIVILIZED_TYPES.includes(c.type)) {
      if (this._seekPartner(c)) return;
      if (!c.settlementId && c.age > 4 && (!c.target || Math.random() < 0.3)) {
        const companion = this.nearestOfType(c.x, c.z, [c.type], 18, c.id, cc => !cc.settlementId);
        if (companion) {
          const cd = Math.hypot(companion.x - c.x, companion.z - c.z);
          if (cd > 2) { c.target = { x: companion.x, z: companion.z }; return; }
        }
      }
      if (!c.target || Math.random() < 0.12) this._pickWanderTarget(c);
    }
  }

  _tryReproduce(a, b) {
    if (!this._canReproducePair(a, b)) return null;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const baby = this.spawn(a.type, mx + (Math.random() - 0.5), mz + (Math.random() - 0.5), {
      traits: this.civilizationSystem?.inheritedTraits(a, b),
      genome: this.civilizationSystem?.inheritedGenome?.(a, b),
    });
    a.reproCooldown = (26 + Math.random() * 16) * (a.reproMul || 1) * (this.civilizationSystem?.reproductionCooldownMultiplier?.(a) || 1);
    b.reproCooldown = (26 + Math.random() * 16) * (b.reproMul || 1) * (this.civilizationSystem?.reproductionCooldownMultiplier?.(b) || 1);
    if (!baby) return null;

    this.civilizationSystem?.registerBirth(baby, a, b);

    baby.age = 0;
    baby.hunger = 15;
    if (a.settlementId) {
      this.setHome(baby, a.settlementId, a.empireId, a.homeX, a.homeZ, a.homeRadius);
      const settlement = this._getSettlement(a.settlementId);
      if (settlement?.resources) settlement.resources.food = Math.max(0, finiteOr(settlement.resources.food, 0) - REPRO_FOOD_COST);
    }
    return baby;
  }

  _updateInstance(c) {
    let m = c.model3d;
    if (!m) return;
    if (!m.isGltf && creatureAssetReady(c.type, c.sex)) {
      const visible = m.root.visible;
      this.group.remove(m.root);
      for (const part of m.tintTargets || []) part.material?.dispose();
      c.model3d = m = this._createModel(c.type, c.visualScale, c.id, c.sex);
      m.root.visible = visible;
    }
    const moving = !!c.target && !c.possessed || (c.possessed && (Math.abs(this._possessedInput.x) > 0.01 || Math.abs(this._possessedInput.z) > 0.01));
    const now = this._animationTime * 1000;
    const bob = moving ? Math.abs(Math.sin(now * 0.008 + c.phase)) * 0.05 : 0;
    m.root.position.set(c.x, c.y + bob + (c.jumpOffset || 0), c.z);
    m.root.rotation.y = c.heading;
    if (!m.root.visible) return;
    const swing = moving ? Math.sin(now * 0.012 + c.phase) * 0.5 : 0;
    if (m.kind === 'quad' && !m.isGltf) {
      m.legFL.rotation.x = swing; m.legBR.rotation.x = swing;
      m.legFR.rotation.x = -swing; m.legBL.rotation.x = -swing;
    } else if (m.kind === 'fish') {
      m.tail.rotation.y = Math.sin(now * 0.018 + c.phase) * 0.7;
    } else if (!m.isGltf) {
      // Shared hip/shoulder pivots keep every humanoid on the same walking cycle.
      m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
      if(m.armL)m.armL.rotation.x=-swing*.65;
      if(m.armR)m.armR.rotation.x=m.weapon?-.3:swing*.65;
    }
    const statusTint = this.statusSystem?.tint?.(c);
    const tint = c.possessed ? POSSESSED_COLOR : statusTint || (c.type === 'zombie' ? ZOMBIE_COLOR : c.infected ? INFECT_COLOR
      : c.commander ? COMMANDER_COLOR : (c.role === 'soldado' ? SOLDIER_COLOR : NORMAL_COLOR));
    // Tint rarely changes between frames — skip the per-part color multiply/copy when it
    // hasn't, which otherwise runs on every mesh of every creature every single frame.
    if (m._lastTint !== tint) {
      m._lastTint = tint;
      for (const part of m.tintTargets) {
        const base = part.material.userData.base;
        if (base) _tintColor.copy(base).multiply(tint); else _tintColor.copy(tint);
        part.material.color.copy(_tintColor);
      }
    }
  }

  updateVisuals(camera, dt) {
    if (!camera || this.disposed) return this.visualStats;
    this._visualUpdateTimer -= Math.max(0, Number(dt) || 0);
    if (this._visualUpdateTimer > 0) return this.visualStats;
    this._visualUpdateTimer = 0.18;

    camera.updateMatrixWorld?.();
    _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _viewFrustum.setFromProjectionMatrix(_viewProjection);
    const detailDistanceSq = 66 * 66;
    const stats = { detailed: 0, instanced: 0, culled: 0 };
    const lodCounts = new Map();
    for (const [type, previousMesh] of this.farLodMeshes) {
      let mesh = previousMesh;
      const required = this.count(type);
      // Guardados anteriores pueden superar el tope actual; conservar también su visibilidad.
      if (required > mesh.instanceMatrix.count) {
        mesh = new THREE.InstancedMesh(previousMesh.geometry, previousMesh.material, required);
        mesh.frustumCulled = false;
        mesh.userData.lodType = type;
        this.group.remove(previousMesh);
        previousMesh.dispose();
        this.group.add(mesh);
        this.farLodMeshes.set(type, mesh);
      }
      mesh.count = 0;
      lodCounts.set(type, 0);
    }

    for (const c of this.creatures) {
      const root = c.model3d?.root;
      if (!root) continue;
      if (!c.alive || c.sailing) {
        root.visible = false;
        stats.culled++;
        continue;
      }
      _viewPoint.set(c.x, c.y + 0.5, c.z);
      const visible = _viewFrustum.containsPoint(_viewPoint);
      if (!visible) {
        root.visible = false;
        stats.culled++;
        continue;
      }
      const dx = camera.position.x - c.x;
      const dy = camera.position.y - c.y;
      const dz = camera.position.z - c.z;
      const detailed = c.possessed || dx * dx + dy * dy + dz * dz <= detailDistanceSq;
      root.visible = detailed;
      if (detailed && root.userData.detailedLod !== true) {
        root.userData.detailedLod = true;
        root.traverse(object => {
          if (object.isMesh) object.castShadow = c.type !== 'fish';
        });
      }
      if (detailed) {
        stats.detailed++;
        continue;
      }
      root.userData.detailedLod = false;
      const mesh = this.farLodMeshes.get(c.type);
      const slot = lodCounts.get(c.type) || 0;
      if (!mesh || slot >= mesh.instanceMatrix.count) {
        stats.culled++;
        continue;
      }
      _lodDummy.position.set(c.x, c.y + (c.type === 'fish' ? 0 : c.visualScale * 0.36), c.z);
      _lodDummy.rotation.set(0, c.heading, 0);
      _lodDummy.scale.setScalar(Math.max(0.15, c.visualScale));
      _lodDummy.updateMatrix();
      mesh.setMatrixAt(slot, _lodDummy.matrix);
      lodCounts.set(c.type, slot + 1);
      stats.instanced++;
    }
    for (const [type, mesh] of this.farLodMeshes) {
      mesh.count = lodCounts.get(type) || 0;
      if (mesh.count) mesh.instanceMatrix.needsUpdate = true;
    }
    this.visualStats = stats;
    return stats;
  }

  _trackedTarget(c, pendingDeaths) {
    if (c.hunting != null) {
      const target = this.creatureById.get(c.hunting);
      if (target?.alive && !pendingDeaths.has(target)) return { target, kind: 'hunt', range: HUNT_ATTACK_RANGE };
      c.hunting = null;
      c.target = null;
    }
    if (c.combatTarget != null) {
      const target = this.creatureById.get(c.combatTarget);
      const validEnemy = target?.alive && !pendingDeaths.has(target) &&
        (c.warTargetEmpire == null || target.empireId === c.warTargetEmpire);
      if (validEnemy) return { target, kind: 'combat', range: c.archer ? ARCHER_ATTACK_RANGE : COMBAT_ATTACK_RANGE };
      c.combatTarget = null;
      c.target = null;
    }
    return null;
  }

  _feedCreature(c, def, dt, forageable) {
    if (!this._lawEnabled('hunger')) return;
    c.hunger = Math.min(100, c.hunger + dt * def.hungerRate * c.hungerMul);

    // Boar had no eating mechanism at all — herbivore forages here, carnivore/bear reset hunger to
    // 0 on a successful hunt (see the 'hunt' kind branch below), but boar's own _decideWildPack
    // only ever flees or reproduces, never eats. Hunger climbed unopposed until starvation, so
    // every boar in a world died on a fixed timer no matter how well it reproduced or how much
    // prey was around — a real wild pig roots around for food same as any other grazer, so it
    // forages the same way herbivore does (reported live, with a screenshot, as boar and bear
    // both vanishing from a long-running world, leaving nothing but herbivores).
    if ((c.type === 'herbivore' || c.type === 'boar') && forageable && c.hunger > 0 && !c.fleeing) {
      c.hunger = Math.max(0, c.hunger - dt * 6);
    } else if (CIVILIZED_TYPES.includes(c.type)) {
      const settlement = this._getSettlement(c.settlementId);
      const stocked = settlement?.resources && c.hunger > CIV_FOOD_THRESHOLD && settlement.resources.food > 0;
      if (stocked) {
        const food = Math.min(
          settlement.resources.food,
          CIV_FOOD_RATE * dt,
          c.hunger / FOOD_NUTRITION,
        );
        settlement.resources.food -= food;
        c.hunger = Math.max(0, c.hunger - food * FOOD_NUTRITION);
      } else if (forageable && c.hunger > 0 && !c.fleeing) {
        // A settled citizen whose settlement's stockpile has run dry now scrapes by on their own
        // too, same as someone with no settlement at all — previously this branch only fired for
        // c.settlementId == null, so a settlement with zero food and zero income (a new colony
        // that happened to found without a single farmer among it, say) had every citizen just
        // sit there starving with no possible recovery: nothing they could do fed them until the
        // stockpile refilled itself, which it never would with nobody left alive to produce it.
        // A reduced rate here isn't a real "settled citizens forage worse" mechanic, just an
        // easy-looking number — and HOMELESS_FORAGE_RATE (1.8) barely keeps pace with even the
        // slowest hungerRate (human, 1.7) as it is, so halving it left citizens starving slower
        // instead of not starving.
        c.hunger = Math.max(0, c.hunger - HOMELESS_FORAGE_RATE * dt);
      }
    }

    if (c.hunger >= 100) c.health -= dt * 6;
  }

  _processDisease(c, dt) {
    if (!this._lawEnabled('disease')) {
      c.infected = false;
      c.infectTimer = 0;
      return;
    }
    if (!c.infected) return;
    c.health -= dt * 4;
    c.infectTimer -= dt;
    if (Math.random() < dt * 0.15) {
      const nearby = this.nearestOfType(c.x, c.z, ['herbivore', 'carnivore', 'zombie', ...CIVILIZED_TYPES], 1.2, c.id);
      if (nearby && !nearby.infected && !(nearby.diseaseResist && Math.random() < 0.5)) {
        nearby.infected = true;
        nearby.infectTimer = 14 + Math.random() * 6;
      }
    }
    if (c.infectTimer <= 0) {
      if (Math.random() < 0.5) c.infected = false;
      else c.infectTimer = 5;
    }
  }

  _applyPossessedMovement(c, def, dt) {
    const inp = this._possessedInput;
    const mag = Math.hypot(inp.x, inp.z);
    c.target = null; c.hunting = null; c.combatTarget = null;
    this._clearNavigation(c);
    if (mag > 0.001) {
      const civilized = CIVILIZED_TYPES.includes(c.type);
      const dirX = inp.x / mag, dirZ = inp.z / mag;
      const speed = def.speed * (c.speedMul || 1) * (this.statusSystem?.movementMultiplier?.(c) || 1) * POSSESSED_SPEED_MUL
        * (inp.run ? POSSESSED_RUN_MUL : 1);
      const nx = c.x + dirX * speed * dt, nz = c.z + dirZ * speed * dt;
      const nextIsWater = this._isLiquidWaterWorld(nx, nz, c.type === 'fish');
      const [nextVx, nextVz] = this.world.worldToGrid(nx, nz);
      const blocked = this.settlementManager?.isNavigationBlockedGrid(nextVx, nextVz);
      if ((!nextIsWater || civilized) && !blocked && !this.world.lava?.[this.world.idx(nextVx, nextVz)]) {
        c.x = nx; c.z = nz;
        c.heading = Math.atan2(dirX, dirZ);
        c.swimming = civilized && nextIsWater;
      }
    }
  }

  update(dt, stepsThisFrame = 1) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const detail = this.profileDetail ? { navQueue: 0, navQueueLength: 0, settlementIndex: 0, spatialRebuild: 0, decide: 0, mainLoop: 0, cleanup: 0, projectiles: 0 } : null;
    let dt0 = detail ? performance.now() : 0;
    const world = this.world;
    const pendingDeaths = new Set();
    const zombifyQueue = [];
    this._animationTime += dt;
    // GameRuntime tells us how many fixed steps are running inside this one rendered frame
    // (fast-forward, or the clock catching up after a slow frame) so a x4 game speed can't
    // multiply this call's cost by 4 within a single frame the way a flat per-step budget would.
    this.navigation.processQueue(Math.max(1, Math.round(NAV_QUEUE_NODE_BUDGET / stepsThisFrame)));
    if (detail) { detail.navQueue = performance.now() - dt0; detail.navQueueLength = this.navigation.queueLength; dt0 = performance.now(); }
    this._refreshSettlementIndex();
    if (detail) { detail.settlementIndex = performance.now() - dt0; dt0 = performance.now(); }
    this.spatialIndex.rebuild(this.creatures, creature => creature?.alive);
    this._spatialDirty = false;
    if (detail) { detail.spatialRebuild += performance.now() - dt0; dt0 = performance.now(); }

    for (const c of this.creatures) {
      if (!c.alive) continue;
      const def = TYPES[c.type];
      if (!def) { pendingDeaths.add(c); continue; }

      if (this._lawEnabled('aging') && !c.possessed) c.age += dt * 0.06;
      const groundH = world.heightAtWorld(c.x, c.z);
      const forageable = groundH > CONFIG.WATER_LEVEL + 0.3 && groundH < CONFIG.MAX_H - 4;
      this._feedCreature(c, def, dt, forageable);

      const [vx, vz] = world.worldToGrid(c.x, c.z);
      if (world.isBurning(vx, vz) && !c.fireImmune) c.health -= dt * 35;
      const cellIndex = world.idx(vx, vz);
      if (world.lava?.[cellIndex] && !c.fireImmune) c.health -= dt * 75;
      if ((world.temperature?.[cellIndex] ?? 10) < -18 && !c.fireImmune) c.health -= dt * 3;
      this._processDisease(c, dt);
      c.repathTimer = Math.max(0, (c.repathTimer || 0) - dt);

      if (c.possessed) {
        this._applyPossessedMovement(c, def, dt);
      } else if (c.sailing) {
        c.target = null; c.hunting = null; c.combatTarget = null;
        this._clearNavigation(c);
      } else {
        c.aiTimer -= dt;
        if (c.aiTimer <= 0) {
          if (detail) {
            const decideStart = performance.now();
            this._decide(c);
            detail.decide += performance.now() - decideStart;
          } else {
            this._decide(c);
          }
          c.aiTimer = 0.35 + Math.random() * 0.4;
        }

        const tracked = this._trackedTarget(c, pendingDeaths);
        if (tracked) c.target = { x: tracked.target.x, z: tracked.target.z };

        if (c.target) {
          const actualDx = c.target.x - c.x, actualDz = c.target.z - c.z;
          const actualDist = Math.hypot(actualDx, actualDz);
          if (tracked && actualDist <= tracked.range) {
            c.heading = Math.atan2(actualDx, actualDz);
            const attackRate = tracked.kind === 'hunt' ? 1.8 : 1.5;
            const dodgeChance = DODGE_BASE + Math.max(0, (tracked.target.speedMul || 1) - 1) * 0.25;
            if (Math.random() < Math.min(1, dt * attackRate) && Math.random() >= dodgeChance) {
              if (tracked.kind === 'combat' && c.archer) {
                this._spawnArrow(c.x, c.y + 0.45, c.z, tracked.target.x, tracked.target.y + 0.35, tracked.target.z);
              }
              // Formación/postura (Fase 12): only meaningful between soldiers, so it's excluded
              // from 'hunt' kind (a carnivore's damage to prey has nothing to do with army orders).
              const postureMul = tracked.kind === 'combat' ? (c.stanceOffenseMul || 1) / (tracked.target.stanceDefenseMul || 1) : 1;
              tracked.target.health -= (tracked.kind === 'hunt' ? 34 : 22) * c.damageMul * postureMul;
              if (tracked.target.health <= 0 && !pendingDeaths.has(tracked.target)) {
                this.civilizationSystem?.recordKill(c, tracked.target);
                pendingDeaths.add(tracked.target);
                if (tracked.kind === 'hunt') c.hunger = 0;
                if (c.type === 'zombie' && CIVILIZED_TYPES.includes(tracked.target.type) &&
                    this._lawEnabled('disease') && Math.random() < 0.55) {
                  zombifyQueue.push({ x: tracked.target.x, z: tracked.target.z });
                }
                c.target = null;
                if (tracked.kind === 'hunt') c.hunting = null;
                else c.combatTarget = null;
              }
            }
          } else {
            const movement = this._resolveMovementTarget(c, c.target);
            if (movement) {
              const dx = movement.point.x - c.x, dz = movement.point.z - c.z;
              const dist = Math.hypot(dx, dz);
              if (dist > 0.12) {
            const civilized = CIVILIZED_TYPES.includes(c.type);
            const isFish = c.type === 'fish';
            const currentlyInWater = this._isLiquidWaterWorld(c.x, c.z, c.type === 'fish');
            // 1.6x let a fleeing herbivore (1.6 speed) outrun even a hunting carnivore (2.1 speed,
            // deliberately the faster of the two) at 2.56 effective — a chase that started once
            // never actually ended: the predator's hunger climbed straight to 100 while forever
            // one step behind, starving out any carnivore/bear that ever locked onto prey (proven
            // live: a single carnivore with 20 herbivores nearby chased the same target for over
            // 30 straight seconds without a single hit). Capped low enough that every predator
            // stays faster than its boosted prey; still a real adrenaline burst over its own
            // unboosted pace.
            const fleeMul = c.fleeing ? 1.2 : 1;
            const swimMul = civilized && currentlyInWater ? SWIM_SPEED_MUL : 1;
            const step = Math.min(dist, def.speed * c.speedMul * (this.statusSystem?.movementMultiplier?.(c) || 1) * fleeMul * swimMul * dt);
            const nx = c.x + (dx / dist) * step, nz = c.z + (dz / dist) * step;
            const nextIsWater = this._isLiquidWaterWorld(nx, nz, c.type === 'fish');
            const [nextVx, nextVz] = world.worldToGrid(nx, nz);
            const mode = c.flying ? 'air' : (isFish ? 'water' : 'land');
            const canEnter = Number.isFinite(this.navigation.traversalCost(nextVx, nextVz, vx, vz, mode,
              mode === 'land' && this.settlementManager ? (x, z) => this.settlementManager.isNavigationBlockedGrid(x, z) : null));
            if (canEnter) {
              c.x = nx;
              c.z = nz;
              c.heading = Math.atan2(dx, dz);
              c.swimming = civilized && nextIsWater;
            } else {
              c.target = null;
              c.hunting = null;
              c.combatTarget = null;
              this._clearNavigation(c);
            }
              } else if (!tracked && movement.final) {
                if (c.choppingTree && c.chopTimer == null) c.chopTimer = CHOP_DURATION;
                c.target = null;
                this._clearNavigation(c);
              }
            }
          }
        }
      }

      if (c.chopTimer != null) {
        c.chopTimer -= dt;
        if (c.chopTimer <= 0) { c.chopTimer = null; this._chopTree(c); }
      }

      const inWater = this._isLiquidWaterWorld(c.x, c.z, c.type === 'fish');
      c.swimming = CIVILIZED_TYPES.includes(c.type) && inWater;
      if (c.type === 'fish') {
        if (!inWater) c.health -= dt * 28;
      } else if (inWater && !c.sailing && !c.flying) {
        c.oxygen = Math.max(0, (c.oxygen ?? 12) - dt);
        if (c.oxygen <= 0) c.health -= dt * 14;
      } else {
        c.oxygen = Math.min(c.maxOxygen || 12, (c.oxygen ?? 12) + dt * 4);
      }
      let desiredY;
      if (c.type === 'fish') {
        desiredY = Math.max(world.heightAtWorld(c.x, c.z) + 0.1, (world.riverSurfaceAtWorld?.(c.x,c.z) ?? CONFIG.WATER_LEVEL) - 0.15);
      } else {
        const groundH = world.bridgeHeightAtWorld?.(c.x, c.z) ?? world.heightAtWorld(c.x, c.z);
        const waterSurface = world.riverSurfaceAtWorld?.(c.x,c.z) ?? CONFIG.WATER_LEVEL;
        // Blend ground-height and swim-surface-height smoothly across a shoreline band instead
        // of a hard cutoff at the water line — a hard cutoff let civilized units hover at a
        // stuck average height when wandering micro-movements kept flipping isWaterWorld().
        const swimT = CIVILIZED_TYPES.includes(c.type)
          ? Math.max(0, Math.min(1, (waterSurface - groundH + 0.3) / 0.6))
          : 0;
        desiredY = groundH * (1 - swimT) + (waterSurface + SWIM_SURFACE_OFFSET) * swimT;
        if (c.flying) desiredY = groundH + (c.type === 'dragon' ? 2.2 : 1.15);
      }
      c.y += (desiredY - c.y) * Math.min(1, dt * 10);
      // Jump arc, additive on top of the ground/swim height above: only ever nonzero for a
      // possessed creature (triggerJump() is the only place that sets jumpVelocity), so this is a
      // no-op read/write for the other 99% of creatures every other frame. Kept separate from `c.y`
      // itself so the jump's up-and-down arc never feeds into the swim/bridge/flying logic above,
      // which all reason about the creature's actual ground/water level.
      if (c.jumpVelocity || c.jumpOffset) {
        c.jumpVelocity -= JUMP_GRAVITY * dt;
        c.jumpOffset += c.jumpVelocity * dt;
        if (c.jumpOffset <= 0) { c.jumpOffset = 0; c.jumpVelocity = 0; }
      }

      if (c.reproCooldown > 0) c.reproCooldown -= dt;

      const diedOfAge = this._lawEnabled('aging') && !c.immortal && !c.possessed && c.age >= c.maxAge;
      if (c.health <= 0 || diedOfAge) pendingDeaths.add(c);
      else this._updateInstance(c);
    }

    if (detail) { detail.mainLoop = performance.now() - dt0; dt0 = performance.now(); }

    for (const c of pendingDeaths) this._kill(c);
    if (pendingDeaths.size) this.creatures = this.creatures.filter(c => c.alive);
    if (this._lawEnabled('disease')) {
      for (const point of zombifyQueue) this.spawn('zombie', point.x, point.z);
    }
    if (detail) { detail.cleanup = performance.now() - dt0; dt0 = performance.now(); }
    this.spatialIndex.rebuild(this.creatures, creature => creature?.alive);
    this._spatialDirty = false;
    if (detail) { detail.spatialRebuild += performance.now() - dt0; dt0 = performance.now(); }
    this._updateProjectiles(dt);
    if (detail) { detail.projectiles = performance.now() - dt0; this.lastDetailTimings = detail; }
  }

  serialize() {
    const creatures = [];
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const record = {};
      for (const [key, value] of Object.entries(c)) {
        if (key === 'model3d' || key === 'possessed' || key.startsWith('nav') || key === 'repathTimer' ||
          key === 'jumpOffset' || key === 'jumpVelocity') continue;
        const cloned = cloneSerializable(value);
        if (cloned !== undefined) record[key] = cloned;
      }
      creatures.push(record);
    }
    return { version: 1, nextUid: UID, creatures };
  }

  _clearCreatures() {
    for (const c of this.creatures) {
      c.alive = false;
      if (c.model3d) {
        this.group.remove(c.model3d.root);
        c.model3d.root.traverse(o => { if (o.isMesh) o.material?.dispose?.(); });
        c.model3d = null;
      }
    }
    this.creatures = [];
    this.creatureById.clear();
    this.countsByType.clear();
    this.spatialIndex.clear();
    this._spatialDirty = false;
    this.possessedId = null;
  }

  restore(payload) {
    const records = Array.isArray(payload) ? payload :
      (Array.isArray(payload?.creatures) ? payload.creatures : (Array.isArray(payload?.records) ? payload.records : []));
    const savedNextUid = Array.isArray(payload) ? null : finiteOr(payload?.nextUid, null);

    if (this.disposed) {
      this.group = new THREE.Group();
      this.scene.add(this.group);
      this.disposed = false;
    } else if (!this.group.parent) {
      this.scene.add(this.group);
    }
    this._clearCreatures();

    const usedIds = new Set();
    let maxId = 0;
    let fallbackId = 1;
    for (const raw of records) {
      if (!raw || typeof raw !== 'object' || !TYPES[raw.type] || raw.alive === false) continue;
      const x = finiteOr(raw.x, 0);
      const z = finiteOr(raw.z, 0);
      let id = Number.isInteger(raw.id) && raw.id > 0 ? raw.id : fallbackId;
      while (usedIds.has(id)) id = ++fallbackId;
      usedIds.add(id);
      fallbackId = Math.max(fallbackId, id + 1);
      maxId = Math.max(maxId, id);

      const seed = {
        sex: raw.sex,
        name: raw.name,
        profession: raw.profession,
        traits: Array.isArray(raw.traits) ? raw.traits : undefined,
        visualScale: raw.visualScale,
      };
      const c = this._makeDefaultCreature(raw.type, x, z, id, seed);
      for (const [key, value] of Object.entries(raw)) {
        if (key === 'model3d' || key === 'possessed' || key === 'id' || key === 'type' || key === 'x' || key === 'z' ||
            key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const cloned = cloneSerializable(value);
        if (cloned !== undefined) c[key] = cloned;
      }
      c.id = id;
      c.type = raw.type;
      c.x = x;
      c.z = z;
      c.alive = true;
      c.possessed = false;
      c.target = normalizePoint(c.target);
      c.warDestination = normalizePoint(c.warDestination);
      c.visualScale = finiteOr(c.visualScale, TYPES[c.type].size);
      c.maxHealth = Math.max(1, finiteOr(c.maxHealth, 100));
      c.health = Math.max(0, finiteOr(c.health, c.maxHealth));
      c.hunger = Math.max(0, Math.min(100, finiteOr(c.hunger, 20)));
      c.age = Math.max(0, finiteOr(c.age, 0));
      c.maxAge = Math.max(0.01, finiteOr(c.maxAge, TYPES[c.type].maxAge));
      c.speedMul = Math.max(0.01, finiteOr(c.speedMul, 1));
      c.damageMul = Math.max(0, finiteOr(c.damageMul, 1));
      c.stanceOffenseMul = Math.max(0, finiteOr(c.stanceOffenseMul, 1));
      c.stanceDefenseMul = Math.max(0, finiteOr(c.stanceDefenseMul, 1));
      c.hungerMul = Math.max(0, finiteOr(c.hungerMul, 1));
      c.reproMul = Math.max(0, finiteOr(c.reproMul, 1));
      c.swimming = CIVILIZED_TYPES.includes(c.type) && this._isLiquidWaterWorld(c.x, c.z);
      c.oxygen = Math.max(0, finiteOr(c.oxygen, 12));
      c.maxOxygen = Math.max(1, finiteOr(c.maxOxygen, 12));
      this._clearNavigation(c);
      c.repathTimer = 0;
      c.y = finiteOr(c.y, c.swimming ? CONFIG.WATER_LEVEL + SWIM_SURFACE_OFFSET : this.world.heightAtWorld(c.x, c.z));
      c.model3d = this._createModel(c.type, c.visualScale, c.id, c.sex);
      if (c.role === 'soldado') {
        const weapon = attachWeapon(c.model3d, c.weaponKind || (c.archer ? 'bow' : 'sword'));
        if (weapon && c.masterwork) weapon.traverse(o => { if (o.isMesh) o.material.color.set(0xe8c65a); });
      }
      this.creatures.push(c);
      this.creatureById.set(c.id, c);
      this.countsByType.set(c.type, (this.countsByType.get(c.type) || 0) + 1);
      this._updateInstance(c);
    }

    UID = Math.max(1, maxId + 1, savedNextUid ?? 1);
    this.spatialIndex.rebuild(this.creatures, creature => creature?.alive);
    this._spatialDirty = false;
    return this.creatures.length;
  }

  dispose() {
    if (this.disposed) return;
    this._clearCreatures();
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    this.group.removeFromParent();
    for (const mesh of this.farLodMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.farLodMeshes.clear();
    this.settlementManager = null;
    this.statusSystem = null;
    this.settlementById.clear();
    this.disposed = true;
  }
}

export { TYPES };
