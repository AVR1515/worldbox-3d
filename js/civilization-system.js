import * as THREE from 'three';
import { CIVILIZED_TYPES } from './creatures.js';
import { RESOURCE_CAP_BASE, RADIUS_BY_LEVEL } from './settlements.js';
import { cityPlots, CITY_BLOCK } from './city-layout.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { fitGeometryToHeight } from './core/gltf-utils.js';

const UPDATE_INTERVAL = 1.5;
const BUILDING_CAP = 160;
const BUILDINGS = Object.freeze({
  townhall: { label: 'Ayuntamiento', icon: '🏛️', color: 0xcbb38a, minLevel: 0, cost: {} },
  warehouse: { label: 'Almacén', icon: '📦', color: 0x8b6847, minLevel: 1, cost: { wood: 18, stone: 8 } },
  workshop: { label: 'Taller', icon: '🛠️', color: 0xb57945, minLevel: 1, cost: { wood: 15, stone: 9 } },
  mine: { label: 'Mina', icon: '⛏️', color: 0x666a70, minLevel: 1, cost: { wood: 12, stone: 12 } },
  fishery: { label: 'Pesquería', icon: '🎣', color: 0x4f8194, minLevel: 1, cost: { wood: 20, stone: 5 } },
  smithy: { label: 'Herrería', icon: '⚒️', color: 0x594c45, minLevel: 2, cost: { wood: 22, stone: 20 } },
  barracks: { label: 'Cuartel', icon: '🛡️', color: 0x7f4b43, minLevel: 2, cost: { wood: 25, stone: 24 } },
  market: { label: 'Mercado', icon: '🏪', color: 0xb28b3d, minLevel: 2, cost: { wood: 18, stone: 14 } },
});

// Player-facing tactical dial for an empire's army (Fase 12's "formaciones militares"). Doesn't
// touch who a soldier fights, only how hard — applied to every soldier's stanceOffenseMul /
// stanceDefenseMul in _syncArmies(), and read back in creatures.js's combat damage line.
const POSTURE_MULTIPLIERS = Object.freeze({
  balanced: { offense: 1, defense: 1 },
  aggressive: { offense: 1.25, defense: 0.85 },
  cautious: { offense: 0.82, defense: 1.22 },
});

const CLAN_PREFIX = ['Casa', 'Linaje', 'Clan'];
const ITEM_LABELS = Object.freeze({ tool: 'Herramienta', weapon: 'Arma', armor: 'Armadura', heirloom: 'Reliquia' });
const GENOME_KEYS = ['strength', 'vitality', 'speed', 'fertility', 'longevity', 'coldAdaptation', 'heatAdaptation'];
const RACE_GENOMES = Object.freeze({
  human: { strength: 0.5, vitality: 0.52, speed: 0.5, fertility: 0.56, longevity: 0.48, coldAdaptation: 0.48, heatAdaptation: 0.5 },
  orc: { strength: 0.72, vitality: 0.66, speed: 0.43, fertility: 0.5, longevity: 0.4, coldAdaptation: 0.45, heatAdaptation: 0.62 },
  elf: { strength: 0.4, vitality: 0.48, speed: 0.66, fertility: 0.42, longevity: 0.78, coldAdaptation: 0.53, heatAdaptation: 0.56 },
  dwarf: { strength: 0.64, vitality: 0.7, speed: 0.38, fertility: 0.46, longevity: 0.62, coldAdaptation: 0.68, heatAdaptation: 0.4 },
});
const CULTURE_VALUES = ['naturaleza', 'comercio', 'honor', 'conocimiento'];
const RELIGION_TENETS = ['cosecha', 'forja', 'familia', 'valor'];
const CULTURE_PREFIX = ['Tradición', 'Costumbre', 'Legado', 'Pueblo'];
const LANGUAGE_SUFFIX = ['és', 'ano', 'ico', 'ar', 'í'];
const RELIGION_PREFIX = ['Camino de', 'Fe de', 'Culto a', 'Orden de'];
const SUBSPECIES_LABELS = Object.freeze({
  human: { base: 'Humano', cold: 'Humano boreal', heat: 'Humano solar', robust: 'Humano robusto' },
  orc: { base: 'Orco', cold: 'Orco de escarcha', heat: 'Orco de ceniza', robust: 'Orco colosal' },
  elf: { base: 'Elfo', cold: 'Elfo níveo', heat: 'Elfo del sol', robust: 'Elfo silvestre' },
  dwarf: { base: 'Enano', cold: 'Enano glacial', heat: 'Enano volcánico', robust: 'Enano de hierro' },
});
const zeroMatrix = new THREE.Matrix4().compose(new THREE.Vector3(0, -100, 0), new THREE.Quaternion(), new THREE.Vector3(0.001, 0.001, 0.001));

// ---------- Mine-entrance model ----------
// Every other building type shares one InstancedMesh per type (one geometry, one material, cheap
// at the ~160-building cap) — the mina used to be the exception because a downloaded model with
// ~20 loose rocks and several distinct materials doesn't collapse into one shared geometry without
// losing what makes it read as a mine. Built procedurally instead (same low-poly, flat-shaded,
// vertex-colored technique as createTownhouse() in city-layout.js and the tree/grass geometry in
// botanical-geometry.js), it's just as cheap as any other building's geometry — one mesh, one
// material — but still gets an individually-cloned mesh per building rather than an InstancedMesh
// slot, since a mine already carries its own live `.mesh` reference for lifecycle/repositioning
// (see _rebuildBuildingVisuals()'s dedicated branch for the 'mine' type below) and there's no
// benefit to instancing a handful of mines per city.
const MINE_REFERENCE_HEIGHT = 1.8;
let mineGeometry = null;
let mineMaterial = null;

function buildMineGeometry() {
  const pieces = [];
  const colorize = (g, color) => {
    g.deleteAttribute('uv');
    const c = new THREE.Color(color), data = [];
    for (let i = 0; i < g.attributes.position.count; i++) data.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(data, 3));
    pieces.push(g);
  };
  const box = (x, y, z, w, h, d, color, rotY = 0) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    if (rotY) g.rotateY(rotY);
    colorize(g.translate(x, y, z), color);
  };
  const rock = (x, y, z, r, color) => colorize(new THREE.IcosahedronGeometry(r, 0).toNonIndexed().translate(x, y, z), color);

  const rockDark = 0x5c5650, rockMid = 0x746c62, rockLight = 0x8c8276, timber = 0x5b3d24, ore = 0x8b6f9c;
  // Rocky hillside behind the shaft — kept well clear of z > -0.2 so it reads as a backdrop the
  // entrance is dug into, instead of a boulder pile burying the doorway (an earlier pass put two
  // "filler" rocks right in front of the frame and hid the entrance completely).
  rock(-0.45, 0.48, -0.75, 0.5, rockMid);
  rock(0.42, 0.5, -0.78, 0.52, rockDark);
  rock(0, 0.72, -0.9, 0.46, rockLight);
  rock(-0.7, 0.28, -0.62, 0.3, rockDark);
  rock(0.68, 0.26, -0.64, 0.28, rockMid);
  // Dark tunnel mouth, framed by timber posts and a lintel — well forward of the rock face so the
  // frame never disappears behind it (an earlier pass had the side rocks reaching close enough to
  // the frame to swallow it visually).
  box(0, 0.4, 0.08, 0.62, 0.78, 0.16, 0x0b0908);
  box(-0.38, 0.42, 0.16, 0.14, 0.86, 0.2, timber);
  box(0.38, 0.42, 0.16, 0.14, 0.86, 0.2, timber);
  box(0, 0.88, 0.16, 0.9, 0.18, 0.22, timber);
  box(-0.55, 0.34, 0.3, 0.09, 0.68, 0.09, timber, 0.32);
  box(0.55, 0.34, 0.3, 0.09, 0.68, 0.09, timber, -0.32);
  // Ore-cart rails running out of the entrance, with a loaded cart parked on them.
  box(-0.14, 0.045, 0.42, 0.05, 0.05, 0.85, 0x2c2723);
  box(0.14, 0.045, 0.42, 0.05, 0.05, 0.85, 0x2c2723);
  box(0, 0.16, 0.62, 0.32, 0.22, 0.38, 0x6b4a34);
  rock(0.06, 0.3, 0.65, 0.13, ore);
  rock(-0.06, 0.28, 0.58, 0.1, ore);
  // Loose ore pile beside the entrance.
  rock(0.58, 0.14, 0.22, 0.17, rockMid);
  rock(0.68, 0.1, 0.28, 0.13, ore);

  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  const fitted = fitGeometryToHeight(new THREE.Mesh(merged), MINE_REFERENCE_HEIGHT);
  merged.dispose();
  return fitted;
}

function buildMineMesh() {
  mineGeometry ??= buildMineGeometry();
  mineMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
  const mesh = new THREE.Mesh(mineGeometry, mineMaterial);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = true;
  return mesh;
}

function disposeMineMesh(mesh) {
  mesh.traverse(object => {
    if (object.userData.sharedGltf || object.userData.sharedGeometry) return;
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material?.dispose?.();
  });
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, finite(value))); }

function makeGenome(type) {
  const baseline = RACE_GENOMES[type] || RACE_GENOMES.human;
  return Object.fromEntries(GENOME_KEYS.map(key => [key, clamp(baseline[key] + (Math.random() - 0.5) * 0.16)]));
}

function normalizeGenome(genome, type = 'human') {
  const baseline = RACE_GENOMES[type] || RACE_GENOMES.human;
  return Object.fromEntries(GENOME_KEYS.map(key => [key, clamp(finite(genome?.[key], baseline[key]))]));
}

function resourceDefaults(resources = {}) {
  resources.wood = Math.max(0, finite(resources.wood));
  resources.food = Math.max(0, finite(resources.food));
  resources.stone = Math.max(0, finite(resources.stone));
  resources.gold = Math.max(0, finite(resources.gold));
  resources.gems = Math.max(0, finite(resources.gems));
  resources.ore = Math.max(0, finite(resources.ore));
  resources.fish = Math.max(0, finite(resources.fish));
  resources.tools = Math.max(0, finite(resources.tools));
  resources.weapons = Math.max(0, finite(resources.weapons));
  resources.armor = Math.max(0, finite(resources.armor));
  resources.goods = Math.max(0, finite(resources.goods));
  return resources;
}

function uniqueIds(values) {
  return [...new Set((values || []).map(Number).filter(Number.isInteger))];
}

export class CivilizationSystem {
  constructor(scene, world, creatures, settlements, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.creatures = creatures;
    this.settlements = settlements;
    this.events = opts.events || null;
    this.toast = opts.toast || (() => {});
    this.people = new Map();
    this.clans = new Map();
    this.productionSites = new Map();
    this.armies = new Map();
    this.communities = new Map();
    this.cultures = new Map();
    this.languages = new Map();
    this.religions = new Map();
    this.subspecies = new Map();
    this.nextClanId = 1;
    this.nextItemId = 1;
    this.nextCultureId = 1;
    this.nextLanguageId = 1;
    this.nextReligionId = 1;
    this._timer = 0;
    this._visualDirty = true;
    this._obstacles = [];
    this.group = new THREE.Group();
    this.group.name = 'civilization-buildings';
    this.scene.add(this.group);
    this.buildingMeshes = new Map();
    for (const [type, definition] of Object.entries(BUILDINGS)) {
      // 'mine' isn't instanced — see buildMineMesh()'s comment above: the real model brings too
      // many distinct materials to collapse into one shared InstancedMesh without losing most of
      // what makes it look like a mine. Each mine building gets its own cloned mesh instead,
      // created lazily in _rebuildBuildingVisuals().
      if (type === 'mine') continue;
      const height = type === 'townhall' ? 2.1 : 1.45;
      const geometry = new THREE.BoxGeometry(type === 'warehouse' ? 1.25 : 0.95, height, type === 'market' ? 1.2 : 0.95).translate(0, height / 2, 0);
      const material = new THREE.MeshStandardMaterial({ color: definition.color, roughness: 0.9 });
      const mesh = new THREE.InstancedMesh(geometry, material, BUILDING_CAP);
      mesh.count = 0;
      // Keep economic buildings in the simulation without drawing their obsolete boxes.
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.buildingMeshes.set(type, mesh);
      // Retain the pools for compatibility, but production records no longer draw
      // these old colored blocks or introduce invisible navigation obstacles.
    }
    const socialGeometry = new THREE.RingGeometry(1.15, 1.55, 28);
    socialGeometry.rotateX(-Math.PI / 2);
    this.socialLayerMesh = new THREE.InstancedMesh(socialGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false }), BUILDING_CAP);
    this.socialLayerMesh.count = 0;
    this.socialLayerMesh.visible = false;
    this.socialLayerMesh.frustumCulled = false;
    this.socialLayerMode = 'none';
    this.group.add(this.socialLayerMesh);
    this._unsubDeath = this.events?.on?.('creature:died', ({ creature }) => this.onCreatureDied(creature));
    this._unsubBirth = this.events?.on?.('family:birth', ({ child, parents }) => {
      for (const parent of parents || []) this.remember(parent, 'birth', `Nació ${child?.name || 'un descendiente'}`, 14);
    });
    this._unsubLevel = this.events?.on?.('creature:level', ({ creature, level }) => this.remember(creature, 'level', `Alcanzó el nivel ${level}`, 8));
    this._unsubWar = this.events?.on?.('diplomacy:war', ({ a, b }) => {
      this._rememberEmpire(a?.id, 'war', `Comenzó la guerra contra ${b?.name || 'otro reino'}`, -14);
      this._rememberEmpire(b?.id, 'war', `Comenzó la guerra contra ${a?.name || 'otro reino'}`, -14);
    });
    this._unsubPeace = this.events?.on?.('diplomacy:peace', ({ a, b }) => {
      this._rememberEmpire(a?.id, 'peace', `Se firmó la paz con ${b?.name || 'otro reino'}`, 10);
      this._rememberEmpire(b?.id, 'peace', `Se firmó la paz con ${a?.name || 'otro reino'}`, 10);
    });
    this._unsubAlliance = this.events?.on?.('diplomacy:alliance', ({ a, b }) => {
      this._rememberEmpire(a?.id, 'alliance', `Se selló una alianza con ${b?.name || 'otro reino'}`, 7);
      this._rememberEmpire(b?.id, 'alliance', `Se selló una alianza con ${a?.name || 'otro reino'}`, 7);
    });
    this._unsubCapture = this.events?.on?.('settlement:captured', ({ settlement, attackerEmpire, oldEmpire }) => {
      for (const creature of this.creatures.creatures) {
        if (!creature.alive) continue;
        if (creature.settlementId === settlement?.id) this.remember(creature, 'capture', `${settlement.name} fue conquistada`, -12);
        else if (creature.empireId === attackerEmpire?.id) this.remember(creature, 'victory', `Su reino conquistó ${settlement?.name || 'una ciudad'}`, 6);
        else if (creature.empireId === oldEmpire?.id) this.remember(creature, 'defeat', `Su reino perdió ${settlement?.name || 'una ciudad'}`, -7);
      }
    });
    this._unsubShip = this.events?.on?.('ship:landed', payload => this._exchangeIdeas(payload?.origin, payload?.destination, payload?.role));
  }

  ensurePerson(creature) {
    if (!creature || !CIVILIZED_TYPES.includes(creature.type)) return null;
    let person = this.people.get(creature.id);
    if (!person) {
      person = {
        creatureId: creature.id,
        partnerId: null,
        parentIds: [],
        childrenIds: [],
        clanId: null,
        generation: 0,
        inventory: [],
        equipment: { tool: null, weapon: null, armor: null },
        progression: { level: 1, xp: 0, kills: 0 },
        genome: creature._genomeSeed ? normalizeGenome(creature._genomeSeed, creature.type) : makeGenome(creature.type),
        genomeInherited: !!creature._genomeSeed,
        genomeApplied: false,
        happiness: 60,
        memories: [],
        cultureId: null,
        languageId: null,
        religionId: null,
        subspeciesId: null,
      };
      this.people.set(creature.id, person);
      delete creature._genomeSeed;
    }
    return person;
  }

  inheritedTraits(parentA, parentB) {
    const pool = [...new Set([...(parentA?.traits || []), ...(parentB?.traits || [])])];
    const inherited = pool.filter(() => Math.random() < 0.42).slice(0, 3);
    return inherited.length ? inherited : undefined;
  }

  inheritedGenome(parentA, parentB) {
    const a = this.ensurePerson(parentA), b = this.ensurePerson(parentB);
    if (!a || !b) return null;
    return Object.fromEntries(GENOME_KEYS.map(key => {
      const inherited = (a.genome[key] + b.genome[key]) / 2;
      return [key, clamp(inherited + (Math.random() - 0.5) * 0.07)];
    }));
  }

  registerBirth(child, parentA, parentB) {
    const person = this.ensurePerson(child);
    const a = this.ensurePerson(parentA), b = this.ensurePerson(parentB);
    if (!person || !a || !b) return;
    person.parentIds = [parentA.id, parentB.id];
    person.generation = Math.max(a.generation || 0, b.generation || 0) + 1;
    person.clanId = a.clanId || b.clanId || null;
    if (!person.genomeInherited) person.genome = this.inheritedGenome(parentA, parentB) || person.genome;
    person.genomeInherited = true;
    person.genomeApplied = false;
    person.cultureId = a.cultureId || b.cultureId || null;
    person.languageId = a.languageId || b.languageId || null;
    person.religionId = a.religionId || b.religionId || null;
    a.partnerId = parentB.id;
    b.partnerId = parentA.id;
    if (!a.childrenIds.includes(child.id)) a.childrenIds.push(child.id);
    if (!b.childrenIds.includes(child.id)) b.childrenIds.push(child.id);
    if (person.clanId) this._addToClan(person.clanId, child.id);
    this.events?.emit?.('family:birth', { child, parents: [parentA, parentB] });
  }

  canReproduce(a, b) {
    if (!a || !b || a.sex === b.sex) return false;
    const personA = this.ensurePerson(a), personB = this.ensurePerson(b);
    return !!personA && !!personB && personA.partnerId === b.id && personB.partnerId === a.id && !this._areCloseRelatives(a, b);
  }

  // canReproduce() only accepts an already-matched couple (see _formFamilies()), but
  // CreatureManager's mate search used to just grab whichever same-type neighbor happened to be
  // nearest — almost never the creature's actual partner once a settlement has more than two
  // people, so most villages sat frozen at their founding population. Give it a way to find the
  // real partner directly so it can walk them toward each other instead of gambling on proximity.
  getPartner(creature) {
    const person = this.people.get(creature?.id);
    if (!person?.partnerId) return null;
    const partner = this.creatures.creatureById.get(person.partnerId);
    return partner?.alive ? partner : null;
  }

  _createClan(founder, empireId) {
    const id = this.nextClanId++;
    const surname = String(founder?.name || `Fundador ${id}`).split(/\s+/).filter(Boolean).at(-1);
    const clan = {
      id,
      name: `${CLAN_PREFIX[id % CLAN_PREFIX.length]} ${surname}`,
      empireId,
      founderId: founder?.id || null,
      leaderId: founder?.id || null,
      memberIds: founder ? [founder.id] : [],
      prestige: 10,
    };
    this.clans.set(id, clan);
    if (founder) this.ensurePerson(founder).clanId = id;
    return clan;
  }

  _addToClan(clanId, creatureId) {
    const clan = this.clans.get(clanId);
    if (!clan) return false;
    if (!clan.memberIds.includes(creatureId)) clan.memberIds.push(creatureId);
    const person = this.people.get(creatureId);
    if (person) person.clanId = clanId;
    return true;
  }

  _areCloseRelatives(a, b) {
    const pa = this.people.get(a.id), pb = this.people.get(b.id);
    if (!pa || !pb) return false;
    if (pa.parentIds.includes(b.id) || pb.parentIds.includes(a.id)) return true;
    return pa.parentIds.some(id => pb.parentIds.includes(id));
  }

  _formFamilies() {
    for (const settlement of this.settlements.settlements) {
      const candidates = this.creatures.creatures.filter(creature => {
        // In this simulation a civilized creature becomes reproductively active at age 7
        // (the same accelerated scale used by CreatureManager). Requiring age 16 here left
        // freshly founded villages unable to form families for several real-time minutes.
        if (!creature.alive || creature.settlementId !== settlement.id || !CIVILIZED_TYPES.includes(creature.type) || creature.age < 7) return false;
        return this.ensurePerson(creature).partnerId == null;
      });
      let paired = 0;
      for (const creature of candidates) {
        if (paired >= 3) break;
        const person = this.people.get(creature.id);
        if (person.partnerId != null) continue;
        const partner = candidates.find(other => other !== creature && other.type === creature.type && other.sex !== creature.sex &&
          this.people.get(other.id)?.partnerId == null && !this._areCloseRelatives(creature, other));
        if (!partner || Math.random() > 0.22) continue;
        const partnerData = this.people.get(partner.id);
        person.partnerId = partner.id;
        partnerData.partnerId = creature.id;
        const clanId = person.clanId || partnerData.clanId;
        if (clanId) {
          this._addToClan(clanId, creature.id);
          this._addToClan(clanId, partner.id);
        }
        paired++;
      }
    }
  }

  _ensureClans() {
    for (const creature of this.creatures.creatures) {
      if (!creature.alive || !CIVILIZED_TYPES.includes(creature.type)) continue;
      const person = this.ensurePerson(creature);
      if (person.clanId && this.clans.has(person.clanId)) continue;
      const settlement = this.settlements.settlements.find(item => item.id === creature.settlementId);
      if (!settlement) continue;
      const localClan = [...this.clans.values()].find(clan => clan.empireId === settlement.empireId && clan.memberIds.length < 18);
      if (localClan) this._addToClan(localClan.id, creature.id);
      else this._createClan(creature, settlement.empireId);
    }
    for (const clan of this.clans.values()) {
      clan.memberIds = clan.memberIds.filter(id => this.creatures.creatureById.get(id)?.alive);
      if (!clan.memberIds.length) { this.clans.delete(clan.id); continue; }
      if (!clan.memberIds.includes(clan.leaderId)) clan.leaderId = this._bestCandidate(clan.memberIds)?.id || clan.memberIds[0];
      clan.prestige = Math.max(1, clan.memberIds.reduce((sum, id) => sum + (this.people.get(id)?.progression.level || 1), 0));
    }
  }

  _bestCandidate(ids) {
    return ids.map(id => this.creatures.creatureById.get(id)).filter(creature => creature?.alive)
      .sort((a, b) => {
        const aLevel = this.people.get(a.id)?.progression.level || 1;
        const bLevel = this.people.get(b.id)?.progression.level || 1;
        return bLevel - aLevel || b.age - a.age;
      })[0] || null;
  }

  chooseHeir(empire, previousKingId = null) {
    const previous = this.people.get(previousKingId);
    const children = previous?.childrenIds || [];
    const eligibleChild = this._bestCandidate(children.filter(id => this.creatures.creatureById.get(id)?.empireId === empire.id));
    if (eligibleChild) return eligibleChild;
    const clan = previous?.clanId ? this.clans.get(previous.clanId) : null;
    const clanHeir = clan ? this._bestCandidate(clan.memberIds.filter(id => this.creatures.creatureById.get(id)?.empireId === empire.id)) : null;
    if (clanHeir) return clanHeir;
    return this._bestCandidate(this.creatures.creatures.filter(c => c.alive && c.empireId === empire.id && CIVILIZED_TYPES.includes(c.type)).map(c => c.id));
  }

  chooseRebelLeader(settlement) {
    const residents = this.creatures.creatures.filter(c => c.alive && c.settlementId === settlement.id && CIVILIZED_TYPES.includes(c.type));
    const clans = new Map();
    for (const resident of residents) {
      const clanId = this.people.get(resident.id)?.clanId;
      if (clanId) clans.set(clanId, (clans.get(clanId) || 0) + 1);
    }
    const dominant = [...clans.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const clan = this.clans.get(dominant);
    return this._bestCandidate(clan?.memberIds.filter(id => this.creatures.creatureById.get(id)?.settlementId === settlement.id) || residents.map(c => c.id));
  }

  onSettlementEmpireChanged(settlement, empireId) {
    const clanIds = new Set(this.creatures.creatures.filter(c => c.alive && c.settlementId === settlement.id)
      .map(c => this.people.get(c.id)?.clanId).filter(Boolean));
    for (const clanId of clanIds) {
      const clan = this.clans.get(clanId);
      if (clan) clan.empireId = empireId;
    }
  }

  _societyName(settlement, prefix) {
    const stem = String(settlement?.name || 'Origen').replace(/[^\p{L}]/gu, '').slice(0, 9) || 'Origen';
    return `${prefix} ${stem}`;
  }

  _createCulture(settlement) {
    const id = this.nextCultureId++;
    const value = CULTURE_VALUES[(id + settlement.id) % CULTURE_VALUES.length];
    const culture = {
      id,
      name: this._societyName(settlement, CULTURE_PREFIX[id % CULTURE_PREFIX.length]),
      value,
      traditions: [],
      originSettlementId: settlement.id,
    };
    this.cultures.set(id, culture);
    return culture;
  }

  _createLanguage(settlement) {
    const id = this.nextLanguageId++;
    const stem = String(settlement?.name || 'Origen').split(/\s+/)[0].replace(/[^\p{L}]/gu, '') || 'Origen';
    const language = { id, name: `${stem}${LANGUAGE_SUFFIX[id % LANGUAGE_SUFFIX.length]}`, originSettlementId: settlement.id, speakers: 0 };
    this.languages.set(id, language);
    return language;
  }

  _createReligion(settlement) {
    const id = this.nextReligionId++;
    const symbol = ['Sol', 'Luna', 'Bosque', 'Forja', 'Mar'][id % 5];
    const religion = {
      id,
      name: `${RELIGION_PREFIX[id % RELIGION_PREFIX.length]} ${symbol}`,
      tenet: RELIGION_TENETS[(id + settlement.id) % RELIGION_TENETS.length],
      holySettlementId: settlement.id,
      followers: 0,
    };
    this.religions.set(id, religion);
    return religion;
  }

  _ensureCommunity(settlement) {
    let community = this.communities.get(settlement.id);
    if (community) {
      if (!this.cultures.has(community.cultureId)) community.cultureId = this._createCulture(settlement).id;
      if (!this.languages.has(community.languageId)) community.languageId = this._createLanguage(settlement).id;
      if (!this.religions.has(community.religionId)) community.religionId = this._createReligion(settlement).id;
      return community;
    }
    const sibling = [...this.communities.values()].find(item => {
      const home = this.settlements.settlements.find(candidate => candidate.id === item.settlementId);
      return home?.empireId === settlement.empireId;
    });
    community = {
      settlementId: settlement.id,
      cultureId: sibling?.cultureId || this._createCulture(settlement).id,
      languageId: sibling?.languageId || this._createLanguage(settlement).id,
      religionId: sibling?.religionId || this._createReligion(settlement).id,
      cohesion: 72,
    };
    this.communities.set(settlement.id, community);
    return community;
  }

  _ensureSocieties() {
    const liveSettlements = new Set(this.settlements.settlements.map(settlement => settlement.id));
    for (const id of [...this.communities.keys()]) if (!liveSettlements.has(id)) this.communities.delete(id);
    for (const settlement of this.settlements.settlements) {
      const community = this._ensureCommunity(settlement);
      const culture = this.cultures.get(community.cultureId);
      if (culture) {
        const wanted = [
          settlement.level >= 1 ? 'arquitectura' : null,
          settlement.farms?.length ? 'agricultura' : null,
          settlement.dockPoint ? 'navegación' : null,
          settlement.level >= 2 ? 'artesanía' : null,
          settlement.level >= 3 ? 'crónicas' : null,
        ].filter(Boolean);
        culture.traditions = [...new Set([...culture.traditions, ...wanted])];
      }
      const residents = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === settlement.id && CIVILIZED_TYPES.includes(creature.type));
      for (const creature of residents) {
        const person = this.ensurePerson(creature);
        if (!person.cultureId || !this.cultures.has(person.cultureId)) person.cultureId = community.cultureId;
        else if (person.cultureId !== community.cultureId && Math.random() < 0.035) person.cultureId = community.cultureId;
        if (!person.languageId || !this.languages.has(person.languageId)) person.languageId = community.languageId;
        else if (person.languageId !== community.languageId && Math.random() < 0.09) person.languageId = community.languageId;
        if (!person.religionId || !this.religions.has(person.religionId)) person.religionId = community.religionId;
        else if (person.religionId !== community.religionId && Math.random() < 0.018) person.religionId = community.religionId;
      }
      const agreeing = residents.filter(creature => {
        const person = this.people.get(creature.id);
        return person?.cultureId === community.cultureId && person?.languageId === community.languageId && person?.religionId === community.religionId;
      }).length;
      community.cohesion = residents.length ? Math.round((agreeing / residents.length) * 100) : 0;
    }
    for (const language of this.languages.values()) language.speakers = 0;
    for (const religion of this.religions.values()) religion.followers = 0;
    for (const person of this.people.values()) {
      if (this.creatures.creatureById.get(person.creatureId)?.alive) {
        const language = this.languages.get(person.languageId); if (language) language.speakers++;
        const religion = this.religions.get(person.religionId); if (religion) religion.followers++;
      }
    }
  }

  _applyGenome(creature, person) {
    if (person.genomeApplied) return;
    const genome = person.genome;
    creature.damageMul *= 0.88 + genome.strength * 0.24;
    creature.speedMul *= 0.9 + genome.speed * 0.2;
    creature.maxHealth *= 0.88 + genome.vitality * 0.24;
    creature.health = Math.min(creature.maxHealth, creature.health * (0.88 + genome.vitality * 0.24));
    creature.maxAge *= 0.88 + genome.longevity * 0.24;
    creature.reproMul *= 1.14 - genome.fertility * 0.28;
    person.genomeApplied = true;
  }

  _subspeciesKind(genome) {
    if (genome.coldAdaptation >= 0.7) return 'cold';
    if (genome.heatAdaptation >= 0.7) return 'heat';
    if ((genome.strength + genome.vitality) / 2 >= 0.69) return 'robust';
    return 'base';
  }

  _updateAdaptationAndWellbeing(dt) {
    const speciesCounts = new Map();
    for (const creature of this.creatures.creatures) {
      if (!creature.alive || !CIVILIZED_TYPES.includes(creature.type)) continue;
      const person = this.ensurePerson(creature);
      this._applyGenome(creature, person);
      const [vx, vz] = this.world.worldToGrid(creature.x, creature.z);
      const temperature = this.world.inBounds(vx, vz) ? finite(this.world.temperature?.[this.world.idx(vx, vz)], 20) : 20;
      const coldPressure = temperature < 5 ? Math.min(1, (5 - temperature) / 30) : 0;
      const heatPressure = temperature > 28 ? Math.min(1, (temperature - 28) / 45) : 0;
      person.genome.coldAdaptation = clamp(person.genome.coldAdaptation + coldPressure * dt * 0.0008);
      person.genome.heatAdaptation = clamp(person.genome.heatAdaptation + heatPressure * dt * 0.0008);
      const kind = this._subspeciesKind(person.genome);
      const speciesId = `${creature.type}:${kind}`;
      person.subspeciesId = speciesId;
      speciesCounts.set(speciesId, (speciesCounts.get(speciesId) || 0) + 1);

      for (const memory of person.memories) {
        memory.age = Math.max(0, finite(memory.age) + dt);
        memory.impact *= Math.pow(0.997, dt);
      }
      person.memories = person.memories.filter(memory => Math.abs(memory.impact) >= 0.35).slice(-10);
      const memoryMood = person.memories.reduce((sum, memory) => sum + memory.impact, 0);
      const community = this.communities.get(creature.settlementId);
      const belonging = community ?
        (person.cultureId === community.cultureId ? 3 : -5) + (person.languageId === community.languageId ? 2 : -4) + (person.religionId === community.religionId ? 2 : -3) : -5;
      const family = person.partnerId ? 5 : 0;
      const health = (creature.health / Math.max(1, creature.maxHealth)) * 12;
      const thermalPenalty = coldPressure * (1 - person.genome.coldAdaptation) * 20 + heatPressure * (1 - person.genome.heatAdaptation) * 20;
      const atWar = [...(this.settlements.empires.find(empire => empire.id === creature.empireId)?.relations?.values?.() || [])]
        .some(relation => relation.status === 'war');
      const target = clamp(52 + health - creature.hunger * 0.38 + belonging + family + memoryMood - thermalPenalty - (atWar ? 9 : 0), 0, 100);
      person.happiness += (target - person.happiness) * Math.min(1, dt * 0.08);
      if (thermalPenalty > 14 && person.happiness < 25) creature.health = Math.max(0, creature.health - dt * 0.025);
    }
    this.subspecies.clear();
    for (const [id, population] of speciesCounts) {
      const [race, kind] = id.split(':');
      this.subspecies.set(id, { id, race, kind, name: SUBSPECIES_LABELS[race]?.[kind] || race, population });
    }
  }

  remember(creature, type, text, impact = 0) {
    const person = this.ensurePerson(creature);
    if (!person) return;
    person.memories.push({ type: String(type || 'event'), text: String(text || 'Un recuerdo'), impact: clamp(impact, -25, 25), age: 0 });
    if (person.memories.length > 10) person.memories.splice(0, person.memories.length - 10);
  }

  _rememberEmpire(empireId, type, text, impact) {
    if (!empireId) return;
    for (const creature of this.creatures.creatures) if (creature.alive && creature.empireId === empireId) this.remember(creature, type, text, impact);
  }

  _exchangeIdeas(origin, destination, role) {
    if (role !== 'trade' || !origin || !destination) return;
    const a = this.communities.get(origin.id), b = this.communities.get(destination.id);
    if (!a || !b) return;
    const originResidents = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === origin.id);
    const destinationResidents = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === destination.id);
    const travelerA = originResidents[Math.floor(Math.random() * originResidents.length)];
    const travelerB = destinationResidents[Math.floor(Math.random() * destinationResidents.length)];
    if (travelerA) { this.ensurePerson(travelerA).religionId = b.religionId; this.remember(travelerA, 'trade', `Conoció la fe de ${destination.name}`, 4); }
    if (travelerB) { this.ensurePerson(travelerB).languageId = a.languageId; this.remember(travelerB, 'trade', `Aprendió palabras de ${origin.name}`, 4); }
  }

  productivityMultiplier(settlement) {
    const residents = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === settlement?.id);
    const happiness = residents.length ? residents.reduce((sum, creature) => sum + (this.people.get(creature.id)?.happiness ?? 60), 0) / residents.length : 60;
    const community = this.communities.get(settlement?.id);
    const culture = this.cultures.get(community?.cultureId);
    const religion = this.religions.get(community?.religionId);
    let multiplier = 0.72 + happiness / 250;
    if (culture?.value === 'conocimiento' || culture?.value === 'comercio') multiplier += 0.06;
    if (culture?.value === 'naturaleza' && settlement?.farms?.length) multiplier += 0.05;
    if (religion?.tenet === 'forja') multiplier += 0.05;
    if (religion?.tenet === 'cosecha') multiplier += 0.07;
    return clamp(multiplier, 0.65, 1.25);
  }

  reproductionCooldownMultiplier(creature) {
    const person = this.people.get(creature?.id);
    const religion = this.religions.get(person?.religionId);
    const happiness = person?.happiness ?? 60;
    return clamp((religion?.tenet === 'familia' ? 0.86 : 1) * (1.12 - happiness / 500), 0.72, 1.18);
  }

  diplomacyAffinity(empireA, empireB) {
    const a = [...this.communities.values()].find(item => this.settlements.settlements.find(s => s.id === item.settlementId)?.empireId === empireA?.id);
    const b = [...this.communities.values()].find(item => this.settlements.settlements.find(s => s.id === item.settlementId)?.empireId === empireB?.id);
    if (!a || !b) return 0;
    return (a.languageId === b.languageId ? 0.45 : -0.08) + (a.religionId === b.religionId ? 0.35 : -0.12) + (a.cultureId === b.cultureId ? 0.35 : -0.08);
  }

  _siteFor(settlement) {
    let site = this.productionSites.get(settlement.id);
    if (!site) {
      site = { settlementId: settlement.id, buildings: [], siegeHealth: 100 };
      this.productionSites.set(settlement.id, site);
    }
    resourceDefaults(settlement.resources ||= {});
    if (!site.buildings.some(building => building.type === 'townhall')) {
      site.buildings.push({ type: 'townhall', level: 1, health: 160 });
      this._visualDirty = true;
      this.settlements.markNavigationChanged?.();
    }
    return site;
  }

  _canPay(resources, cost) {
    return Object.entries(cost).every(([key, value]) => (resources[key] || 0) >= value);
  }

  _pay(resources, cost) {
    for (const [key, value] of Object.entries(cost)) resources[key] -= value;
  }

  _desiredBuilding(settlement, site) {
    const has = type => site.buildings.some(building => building.type === type);
    const residents = this.creatures.creatures.filter(c => c.alive && c.settlementId === settlement.id);
    const miners = residents.some(c => c.profession === 'Minero');
    const coastal = this.world.isCoastal(...this.world.worldToGrid(settlement.x, settlement.z), 5);
    const candidates = [
      miners && this.world.findNearestMineral(settlement.x, settlement.z, 24) ? 'mine' : null,
      coastal ? 'fishery' : null,
      'warehouse', 'workshop', 'smithy', 'barracks', 'market',
    ].filter(Boolean);
    const capacity = 2 + settlement.level * 2;
    if (site.buildings.length >= capacity) return null;
    return candidates.find(type => !has(type) && settlement.level >= BUILDINGS[type].minLevel && this._canPay(settlement.resources, BUILDINGS[type].cost)) || null;
  }

  _runProduction(settlement, site, dt) {
    dt *= this.productivityMultiplier(settlement);
    const resources = resourceDefaults(settlement.resources);
    for (const building of site.buildings) {
      if (building.health <= 0) continue;
      switch (building.type) {
        case 'mine': {
          const extracted = this.world.mineNearest(settlement.x, settlement.z, 0.75 * dt, 24);
          if (extracted?.type === 'stone') { resources.stone += extracted.amount * 0.68; resources.ore += extracted.amount * 0.32; }
          else if (extracted) resources[extracted.type] += extracted.amount;
          break;
        }
        case 'fishery': {
          const amount = 0.55 * dt;
          resources.fish += amount;
          resources.food += amount * 0.8;
          break;
        }
        case 'workshop':
          if (resources.wood >= 0.22 * dt && resources.stone >= 0.08 * dt) {
            resources.wood -= 0.22 * dt; resources.stone -= 0.08 * dt;
            resources.goods += 0.2 * dt; resources.tools += 0.08 * dt;
          }
          break;
        case 'smithy':
          if (resources.ore >= 0.2 * dt && resources.wood >= 0.08 * dt) {
            resources.ore -= 0.2 * dt; resources.wood -= 0.08 * dt;
            resources.weapons += 0.07 * dt; resources.armor += 0.055 * dt; resources.tools += 0.045 * dt;
          }
          break;
        case 'market':
          if (resources.goods >= 0.14 * dt) { resources.goods -= 0.14 * dt; resources.gold += 0.09 * dt; }
          break;
      }
    }
    // wood/food/stone/gold/gems get capped separately in SettlementManager.updateEconomy() —
    // these secondary resources never went through that clamp and could accumulate without
    // limit (a mine+smithy running unattended for a long session, for example), unlike every
    // other resource in the game. Same cap formula, applied here since production happens here.
    const cap = RESOURCE_CAP_BASE + settlement.level * 80;
    resources.ore = Math.min(cap, resources.ore);
    resources.fish = Math.min(cap, resources.fish);
    resources.tools = Math.min(cap, resources.tools);
    resources.weapons = Math.min(cap, resources.weapons);
    resources.armor = Math.min(cap, resources.armor);
    resources.goods = Math.min(cap, resources.goods);
  }

  // Mine buildings own an individually-cloned mesh (see buildMineMesh()) rather than a slot in a
  // shared InstancedMesh, so removing a production site has to explicitly detach and dispose it —
  // an InstancedMesh count reset would have covered every other building type for free.
  _disposeSiteMines(site) {
    for (const building of site?.buildings || []) {
      if (!building.mesh) continue;
      this.group.remove(building.mesh);
      disposeMineMesh(building.mesh);
      building.mesh = null;
    }
  }

  _syncProduction(dt) {
    const liveIds = new Set(this.settlements.settlements.map(settlement => settlement.id));
    for (const id of [...this.productionSites.keys()]) {
      if (liveIds.has(id)) continue;
      this._disposeSiteMines(this.productionSites.get(id));
      this.productionSites.delete(id);
      this._visualDirty = true;
    }
    for (const settlement of this.settlements.settlements) {
      const site = this._siteFor(settlement);
      // A new village must be able to reach its first mine. Its initial stone can be spent
      // on homes before level 1, so miners collect exposed material at low efficiency until
      // a proper mine is constructed. The deposit is still finite and physically depleted.
      if (!site.buildings.some(building => building.type === 'mine')) {
        const miners = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === settlement.id &&
          creature.role !== 'soldado' && creature.profession === 'Minero').length;
        if (miners > 0) {
          const extracted = this.world.mineNearest(settlement.x, settlement.z, miners * 0.14 * dt, 24);
          if (extracted?.type === 'stone') settlement.resources.stone += extracted.amount;
          else if (extracted) settlement.resources[extracted.type] = (settlement.resources[extracted.type] || 0) + extracted.amount;
        }
      }
      const desired = this._desiredBuilding(settlement, site);
      if (desired) {
        this._pay(settlement.resources, BUILDINGS[desired].cost);
        site.buildings.push({ type: desired, level: 1, health: 120 });
        site.siegeHealth += desired === 'barracks' ? 80 : 35;
        this._visualDirty = true;
        this.settlements.markNavigationChanged?.();
        this.toast(`${BUILDINGS[desired].icon} ${settlement.name} construye ${BUILDINGS[desired].label.toLowerCase()}`, { history: false });
      }
      this._runProduction(settlement, site, dt);
    }
  }

  storageBonus(settlement) {
    return this.productionSites.get(settlement.id)?.buildings.some(building => building.type === 'warehouse') ? 180 : 0;
  }

  _makeItem(type, quality = 1) {
    return { id: this.nextItemId++, type, label: ITEM_LABELS[type] || type, quality: Math.max(1, Math.min(5, quality)), durability: 100 };
  }

  _equip(person, slot, item, creature) {
    if (person.equipment[slot]) return;
    person.inventory.push(item);
    person.equipment[slot] = item.id;
    if (slot === 'weapon') creature.damageMul *= 1 + item.quality * 0.06;
    if (slot === 'armor') { creature.maxHealth *= 1 + item.quality * 0.05; creature.health = Math.min(creature.maxHealth, creature.health + 5); }
  }

  _syncEquipment() {
    for (const creature of this.creatures.creatures) {
      if (!creature.alive || !CIVILIZED_TYPES.includes(creature.type) || creature.settlementId == null) continue;
      const settlement = this.settlements.settlements.find(item => item.id === creature.settlementId);
      if (!settlement) continue;
      const resources = resourceDefaults(settlement.resources);
      const person = this.ensurePerson(creature);
      const worker = ['Leñador', 'Agricultor', 'Constructor', 'Minero'].includes(creature.profession);
      if (worker && !person.equipment.tool && resources.tools >= 1) {
        resources.tools -= 1;
        this._equip(person, 'tool', this._makeItem('tool', 1 + Math.floor(Math.min(3, resources.gems / 8))), creature);
      }
      if (creature.role === 'soldado') {
        if (!person.equipment.weapon && resources.weapons >= 1) {
          resources.weapons -= 1;
          this._equip(person, 'weapon', this._makeItem('weapon', 1 + Math.floor(Math.min(3, resources.gems / 6))), creature);
        }
        if (!person.equipment.armor && resources.armor >= 1) {
          resources.armor -= 1;
          this._equip(person, 'armor', this._makeItem('armor', 1 + Math.floor(Math.min(3, resources.gems / 7))), creature);
        }
      }
    }
  }

  recordKill(attacker, victim) {
    const person = this.ensurePerson(attacker);
    if (!person) return;
    person.progression.kills++;
    this.remember(attacker, 'battle', `Venció a ${victim?.name || 'un enemigo'}`, 3);
    this._grantXp(attacker, victim?.role === 'soldado' ? 30 : 16);
  }

  _grantXp(creature, amount) {
    const person = this.ensurePerson(creature);
    if (!person) return;
    const progression = person.progression;
    progression.xp += Math.max(0, finite(amount));
    while (progression.xp >= progression.level * 45) {
      progression.xp -= progression.level * 45;
      progression.level++;
      creature.maxHealth += 4;
      creature.health += 4;
      creature.damageMul *= 1.025;
      this.events?.emit?.('creature:level', { creature, level: progression.level });
    }
  }

  _warTarget(empire) {
    for (const [otherId, relation] of empire.relations) {
      if (relation.status !== 'war') continue;
      let target = this.settlements.settlements.find(s => s.id === relation.warGoal && s.empireId === otherId);
      if (!target) {
        const candidates = this.settlements.settlements.filter(s => s.empireId === otherId);
        target = candidates.sort((a, b) => b.level - a.level)[0] || null;
        relation.warGoal = target?.id || null;
      }
      if (target) return { target, enemyEmpireId: otherId };
    }
    return null;
  }

  _syncArmies(dt) {
    const liveEmpires = new Set(this.settlements.empires.map(empire => empire.id));
    for (const id of [...this.armies.keys()]) if (!liveEmpires.has(id)) this.armies.delete(id);
    for (const empire of this.settlements.empires) {
      const soldiers = this.creatures.creatures.filter(c => c.alive && c.empireId === empire.id && c.role === 'soldado' && !c.garrison);
      let army = this.armies.get(empire.id);
      if (!army) {
        army = { id: empire.id, empireId: empire.id, soldierIds: [], captainId: null, order: 'defend', targetSettlementId: null, morale: 100, posture: 'balanced' };
        this.armies.set(empire.id, army);
      }
      army.soldierIds = soldiers.map(c => c.id);
      army.captainId = this._bestCandidate(army.soldierIds)?.id || null;
      const soldierHappiness = soldiers.length ? soldiers.reduce((sum, soldier) => sum + (this.people.get(soldier.id)?.happiness ?? 60), 0) / soldiers.length : 60;
      const valorFaith = soldiers.some(soldier => this.religions.get(this.people.get(soldier.id)?.religionId)?.tenet === 'valor');
      const honorCulture = soldiers.some(soldier => this.cultures.get(this.people.get(soldier.id)?.cultureId)?.value === 'honor');
      army.morale = clamp(35 + soldierHappiness * 0.65 + (valorFaith ? 8 : 0) + (honorCulture ? 6 : 0), 0, 100);
      const postureMul = POSTURE_MULTIPLIERS[army.posture] || POSTURE_MULTIPLIERS.balanced;
      for (const soldier of soldiers) {
        soldier.commander = soldier.id === army.captainId;
        soldier.stanceOffenseMul = postureMul.offense;
        soldier.stanceDefenseMul = postureMul.defense;
      }
      const war = this._warTarget(empire);
      if (war) {
        army.order = 'siege';
        army.targetSettlementId = war.target.id;
        for (const soldier of soldiers) {
          soldier.warTargetEmpire = war.enemyEmpireId;
          soldier.warDestination = { x: war.target.x + (Math.random() - 0.5) * 3, z: war.target.z + (Math.random() - 0.5) * 3 };
        }
      } else {
        army.order = 'defend';
        army.targetSettlementId = empire.capitalId;
      }
      const site = this.productionSites.get(empire.capitalId);
      if (site?.buildings.some(building => building.type === 'barracks')) {
        for (const soldier of soldiers) this._grantXp(soldier, dt * 0.3);
      }
    }
  }

  _updateSieges(dt) {
    for (const army of this.armies.values()) {
      if (army.order !== 'siege' || !army.targetSettlementId) continue;
      const target = this.settlements.settlements.find(s => s.id === army.targetSettlementId);
      const attacker = this.settlements.empires.find(e => e.id === army.empireId);
      if (!target || !attacker || target.empireId === army.empireId) continue;
      // Orders can outlive a peace treaty, conquest or save/load until armies resync.
      if (attacker.relations.get(target.empireId)?.status !== 'war') continue;
      const nearby = [...new Set(army.soldierIds)].map(id => this.creatures.creatureById.get(id)).filter(c =>
        c?.alive && c.empireId === attacker.id && c.role === 'soldado' && !c.garrison &&
        Math.hypot(c.x - target.x, c.z - target.z) < 7);
      if (nearby.length < 2) continue;
      const defenders = this.creatures.creatures.filter(c => c.alive && c.empireId === target.empireId && Math.hypot(c.x - target.x, c.z - target.z) < 7);
      const site = this._siteFor(target);
      site.siegeHealth -= nearby.length * dt * (defenders.length ? 0.8 : 2.4);
      if (site.siegeHealth > 0) continue;
      if (this.settlements.walls.has(target.id)) {
        this.settlements.breachWall(target);
        site.siegeHealth = 75;
        this.toast(`💥 Las murallas de ${target.name} han caído`);
      } else if (!defenders.length) {
        this.settlements.captureSettlement(target, attacker);
        site.siegeHealth = 100 + target.houses.length * 10;
      } else {
        site.siegeHealth = 40;
      }
    }
  }

  // Tells SettlementManager._checkCaptureDir() to stand down: this class's own _updateSieges()
  // (siege health that depletes over time, walls must fall first, needs >=2 attacking soldiers)
  // is the real siege implementation in every actual game session — game-session.js always builds
  // a CivilizationSystem and attaches it via setCivilizationSystem(). _checkCaptureDir()'s own,
  // much simpler capture check (any attacker near an undefended settlement, no wall or health
  // requirement) only matters for a bare SettlementManager used without this class attached, which
  // doesn't happen in production. Takes no parameters because it's a capability flag ("is *a*
  // civilization system managing sieges at all"), not a per-battle check.
  controlsSiegeFor() {
    return true;
  }

  // ---------- Player-facing army orders (Fase 12) ----------
  // These don't reimplement war/siege logic — they just steer the same relation.warGoal and
  // status fields _warTarget()/declareWar()/makePeace() already read every _syncArmies() tick, so
  // an order given here takes effect through the exact same tested path the AI itself uses.

  // Points an empire's army at a specific enemy settlement instead of whatever _warTarget() would
  // pick on its own (by default, the enemy's highest-level settlement) — declares war first if
  // the two empires aren't already fighting. Returns false (and leaves everything untouched) if
  // the empires/settlement don't exist, the settlement belongs to the same empire, or diplomacy
  // is disabled by the world's laws.
  retargetArmy(empireId, settlementId) {
    const empire = this.settlements.empires.find(e => e.id === empireId);
    const target = this.settlements.settlements.find(s => s.id === settlementId);
    if (!empire || !target || target.empireId === empireId) return false;
    const targetEmpire = this.settlements.empires.find(e => e.id === target.empireId);
    if (!targetEmpire) return false;
    const relation = empire.relations.get(targetEmpire.id);
    if (!relation) return false;
    if (relation.status !== 'war' && !this.settlements.declareWar(empire, targetEmpire)) return false;
    relation.warGoal = target.id;
    return true;
  }

  // "Defender": sues for peace with whichever empire this one is currently at war with, which
  // demobilizes its raised soldiers back to villagers via the same path a natural peace treaty
  // already takes (SettlementManager.makePeace()). An empire not at war with anyone has nothing
  // to stand down from — returns false.
  standDownArmy(empireId) {
    const empire = this.settlements.empires.find(e => e.id === empireId);
    if (!empire) return false;
    for (const [otherId, relation] of empire.relations) {
      if (relation.status !== 'war') continue;
      const other = this.settlements.empires.find(e => e.id === otherId);
      if (other) return this.settlements.makePeace(empire, other);
    }
    return false;
  }

  // The "formación" dial: doesn't change who an army fights, only how hard (see
  // POSTURE_MULTIPLIERS and its use in _syncArmies()/creatures.js's combat damage line).
  setArmyPosture(empireId, posture) {
    if (!POSTURE_MULTIPLIERS[posture]) return false;
    let army = this.armies.get(empireId);
    if (!army) {
      if (!this.settlements.empires.some(e => e.id === empireId)) return false;
      army = { id: empireId, empireId, soldierIds: [], captainId: null, order: 'defend', targetSettlementId: null, morale: 100, posture: 'balanced' };
      this.armies.set(empireId, army);
    }
    army.posture = posture;
    return true;
  }

  rebellionSupport(settlement) {
    const residents = this.creatures.creatures.filter(c => c.alive && c.settlementId === settlement.id);
    if (!residents.length) return 0;
    const clanCounts = new Map();
    for (const resident of residents) {
      const clanId = this.people.get(resident.id)?.clanId;
      if (clanId) clanCounts.set(clanId, (clanCounts.get(clanId) || 0) + 1);
    }
    const largestClan = Math.max(0, ...clanCounts.values());
    const averageHappiness = residents.reduce((sum, resident) => sum + (this.people.get(resident.id)?.happiness ?? 60), 0) / residents.length;
    return Math.min(100, (100 - (settlement.loyalty ?? 100)) * 0.62 + (largestClan / residents.length) * 28 + Math.max(0, 48 - averageHappiness) * 0.9);
  }

  onCreatureDied(creature) {
    const person = this.people.get(creature?.id);
    if (!person) return;
    if (person.partnerId) {
      const partner = this.people.get(person.partnerId);
      if (partner) {
        partner.partnerId = null;
        const survivor = this.creatures.creatureById.get(partner.creatureId);
        if (survivor?.alive) this.remember(survivor, 'death', `Murió su pareja ${creature.name || ''}`.trim(), -18);
      }
    }
    const relatives = [...person.parentIds, ...person.childrenIds];
    for (const id of relatives) {
      const relative = this.creatures.creatureById.get(id);
      if (relative?.alive) this.remember(relative, 'death', `Murió ${creature.name || 'un familiar'}`, -12);
    }
    for (const clan of this.clans.values()) {
      if (clan.leaderId === creature.id) clan.leaderId = null;
    }
  }

  getBuildingObstacles() {
    if (this._visualDirty) this._rebuildBuildingVisuals();
    return this._obstacles;
  }

  _rebuildBuildingVisuals() {
    const counts = new Map();
    this._obstacles = [];
    for (const [type, mesh] of this.buildingMeshes) {
      mesh.count = 0;
      counts.set(type, 0);
      for (let index = 0; index < BUILDING_CAP; index++) mesh.setMatrixAt(index, zeroMatrix);
    }
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const upAxis = new THREE.Vector3(0, 1, 0);
    for (const [settlementId, site] of this.productionSites) {
      const settlement = this.settlements.settlements.find(item => item.id === settlementId);
      if (!settlement) continue;
      // Production buildings used to land on a circle drawn independent of the house/farm grid
      // (city-layout.js), so they overlapped houses or sat astride streets as soon as a city grew
      // past its first few plots — reported live, with a screenshot showing a market stall
      // sunk into a row of houses. Give them the same grid plots houses/farms already avoid
      // instead, same collision-avoidance approach addFarm() uses (outer ring first, skip
      // occupied cells and water).
      const takenPlots = new Set();
      // Math.floor, not Math.round: cityPlots() centres a plot at (col+0.5)*CITY_BLOCK, so
      // flooring the inverse division recovers the same integer col/row it started from —
      // rounding would be off by one and silently fail to recognise a house's actual plot.
      for (const h of settlement.houses) takenPlots.add(`${Math.floor((h.x - settlement.x) / CITY_BLOCK)},${Math.floor((h.z - settlement.z) / CITY_BLOCK)}`);
      for (const f of settlement.farms || []) takenPlots.add(`${Math.floor((f.x - settlement.x) / CITY_BLOCK)},${Math.floor((f.z - settlement.z) / CITY_BLOCK)}`);
      const gridPlots = cityPlots(settlement, RADIUS_BY_LEVEL[settlement.level] ?? RADIUS_BY_LEVEL[0]).reverse();
      let nextPlot = 0;
      site.buildings.forEach((building, index) => {
        const angle = ((index + 1) / Math.max(3, site.buildings.length + 1)) * Math.PI * 2 + settlement.id * 0.71;
        let x, z, rotationY = angle;
        while (nextPlot < gridPlots.length) {
          const plot = gridPlots[nextPlot++];
          const key = `${plot.col},${plot.row}`;
          if (takenPlots.has(key)) continue;
          const [pvx, pvz] = this.world.worldToGrid(plot.x, plot.z);
          if (this.world.isWater(pvx, pvz)) continue;
          takenPlots.add(key);
          x = plot.x; z = plot.z; rotationY = plot.rotationY;
          break;
        }
        if (x == null) {
          // No free grid plot (a fully packed city, an old save whose houses predate the grid,
          // or — now that a settlement's flat pad no longer paves over water/rivers running
          // through its radius — simply less buildable land than the grid assumes) — fall back
          // to the original circle instead of refusing to show the building, but still dodge
          // occupied plots so it doesn't land right on top of a house or farm (reported live: a
          // building sharing a house's exact spot).
          for (let attempt = 0; attempt < 8 && x == null; attempt++) {
            const radius = 2.3 + ((index + attempt) % 3) * 1.15;
            const a = angle + attempt * 0.9;
            const cx = settlement.x + Math.cos(a) * radius, cz = settlement.z + Math.sin(a) * radius;
            const [vx, vz] = this.world.worldToGrid(cx, cz);
            if (this.world.isWater(vx, vz)) continue;
            const key = `${Math.floor((cx - settlement.x) / CITY_BLOCK)},${Math.floor((cz - settlement.z) / CITY_BLOCK)}`;
            if (takenPlots.has(key)) continue;
            takenPlots.add(key);
            x = cx; z = cz; rotationY = a;
          }
          if (x == null) { x = settlement.x; z = settlement.z; }
        }
        const y = this.world.heightAtWorld(x, z);
        if (building.type !== 'mine') {
          building.x = x; building.z = z;
          return; // economic records remain, but invisible boxes cannot block pedestrians
        }
        // The mina isn't instanced (see buildMineMesh()) — it gets its own cloned mesh, created
        // once and reused across rebuilds, repositioned directly instead of via setMatrixAt.
        if (building.type === 'mine') {
          if (!building.mesh) { building.mesh = buildMineMesh(); this.group.add(building.mesh); }
          building.mesh.position.set(x, y, z);
          building.mesh.rotation.y = rotationY;
          building.x = x; building.z = z;
          this._obstacles.push({ x, z, radius: 0.65, kind: building.type });
          return;
        }
        const mesh = this.buildingMeshes.get(building.type);
        const slot = counts.get(building.type) || 0;
        if (!mesh || slot >= BUILDING_CAP) return;
        rotation.setFromAxisAngle(upAxis, rotationY);
        matrix.compose(new THREE.Vector3(x, y, z), rotation, scale);
        mesh.setMatrixAt(slot, matrix);
        counts.set(building.type, slot + 1);
        building.x = x; building.z = z;
        this._obstacles.push({ x, z, radius: building.type === 'warehouse' ? 0.82 : 0.65, kind: building.type });
      });
    }
    for (const [type, mesh] of this.buildingMeshes) {
      mesh.count = counts.get(type) || 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this._visualDirty = false;
  }

  describeCreature(creature) {
    const person = this.people.get(creature?.id);
    if (!person) return null;
    const clan = this.clans.get(person.clanId);
    const partner = this.creatures.creatureById.get(person.partnerId);
    const parents = person.parentIds.map(id => this.creatures.creatureById.get(id)?.name).filter(Boolean);
    const culture = this.cultures.get(person.cultureId), language = this.languages.get(person.languageId), religion = this.religions.get(person.religionId);
    const subspecies = this.subspecies.get(person.subspeciesId);
    const genome = person.genome || makeGenome(creature?.type);
    return {
      level: person.progression.level,
      xp: person.progression.xp,
      kills: person.progression.kills,
      partnerName: partner?.name || null,
      parentNames: parents,
      children: person.childrenIds.length,
      clanName: clan?.name || null,
      items: person.inventory.map(item => `${item.label} ${'★'.repeat(item.quality)}`),
      happiness: Math.round(person.happiness),
      cultureName: culture?.name || null,
      languageName: language?.name || null,
      religionName: religion?.name || null,
      subspeciesName: subspecies?.name || SUBSPECIES_LABELS[creature?.type]?.base || null,
      genome: {
        strength: Math.round(genome.strength * 100), vitality: Math.round(genome.vitality * 100),
        fertility: Math.round(genome.fertility * 100), cold: Math.round(genome.coldAdaptation * 100), heat: Math.round(genome.heatAdaptation * 100),
      },
      memories: person.memories.slice(-3).reverse().map(memory => memory.text),
    };
  }

  describeSettlement(settlement) {
    const site = this.productionSites.get(settlement?.id);
    const community = this.communities.get(settlement?.id);
    const residents = this.creatures.creatures.filter(creature => creature.alive && creature.settlementId === settlement?.id);
    const happiness = residents.length ? residents.reduce((sum, creature) => sum + (this.people.get(creature.id)?.happiness ?? 60), 0) / residents.length : 0;
    const culture = this.cultures.get(community?.cultureId);
    return {
      buildings: (site?.buildings || []).map(building => BUILDINGS[building.type]?.label || building.type),
      siegeHealth: Math.max(0, Math.round(site?.siegeHealth || 0)),
      storageBonus: this.storageBonus(settlement),
      happiness: Math.round(happiness),
      cohesion: community?.cohesion ?? 0,
      cultureName: culture?.name || null,
      cultureValue: culture?.value || null,
      traditions: culture?.traditions || [],
      languageName: this.languages.get(community?.languageId)?.name || null,
      religionName: this.religions.get(community?.religionId)?.name || null,
      religionTenet: this.religions.get(community?.religionId)?.tenet || null,
    };
  }

  describeEmpire(empire) {
    const communities = [...this.communities.values()].filter(item => this.settlements.settlements.find(s => s.id === item.settlementId)?.empireId === empire?.id);
    const primary = communities[0];
    return {
      cultureName: this.cultures.get(primary?.cultureId)?.name || null,
      languageName: this.languages.get(primary?.languageId)?.name || null,
      religionName: this.religions.get(primary?.religionId)?.name || null,
      subspecies: [...this.subspecies.values()].filter(species => species.population > 0).sort((a, b) => b.population - a.population).slice(0, 3),
    };
  }

  setMapLayer(mode = 'none') {
    this.socialLayerMode = ['culture', 'religion', 'language', 'army'].includes(mode) ? mode : 'none';
    this.socialLayerMesh.visible = this.socialLayerMode !== 'none';
    this._rebuildSocialLayer();
  }

  _rebuildSocialLayer() {
    if (!this.socialLayerMesh || this.socialLayerMode === 'none') { if (this.socialLayerMesh) this.socialLayerMesh.count = 0; return; }
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let count = 0;
    for (const settlement of this.settlements.settlements.slice(0, BUILDING_CAP)) {
      const community = this.communities.get(settlement.id);
      let value = this.socialLayerMode === 'culture' ? community?.cultureId : this.socialLayerMode === 'religion' ? community?.religionId : community?.languageId;
      if (this.socialLayerMode === 'army') value = this.armies.get(settlement.empireId)?.soldierIds?.length || 0;
      const radius = 1.3 + Math.min(5, Math.sqrt(Math.max(1, settlement.pop || 1)) * .35);
      dummy.position.set(settlement.x, this.world.heightAtWorld(settlement.x, settlement.z) + .12, settlement.z);
      dummy.scale.set(radius, radius, radius); dummy.updateMatrix();
      this.socialLayerMesh.setMatrixAt(count, dummy.matrix);
      if (this.socialLayerMode === 'army') color.setHSL(value > 12 ? 0 : .12, .85, .55);
      else color.setHSL(((Number(value) || settlement.id) * .6180339) % 1, .72, .58);
      this.socialLayerMesh.setColorAt(count, color);
      count++;
    }
    this.socialLayerMesh.count = count;
    this.socialLayerMesh.instanceMatrix.needsUpdate = true;
    if (this.socialLayerMesh.instanceColor) this.socialLayerMesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    this._timer += dt;
    if (this._timer < UPDATE_INTERVAL) return;
    const elapsed = this._timer;
    this._timer = 0;
    for (const creature of this.creatures.creatures) this.ensurePerson(creature);
    this._ensureClans();
    this._formFamilies();
    this._ensureSocieties();
    this._updateAdaptationAndWellbeing(elapsed);
    this._syncProduction(elapsed);
    this._syncEquipment();
    this._syncArmies(elapsed);
    this._updateSieges(elapsed);
    for (const settlement of this.settlements.settlements) settlement.rebellionSupport = this.rebellionSupport(settlement);
    if (this._visualDirty) this._rebuildBuildingVisuals();
    if (this.socialLayerMode !== 'none') this._rebuildSocialLayer();
  }

  serialize() {
    return {
      version: 2,
      nextClanId: this.nextClanId,
      nextItemId: this.nextItemId,
      nextCultureId: this.nextCultureId,
      nextLanguageId: this.nextLanguageId,
      nextReligionId: this.nextReligionId,
      people: [...this.people.values()].map(person => ({
        ...person,
        parentIds: [...person.parentIds], childrenIds: [...person.childrenIds],
        inventory: person.inventory.map(item => ({ ...item })),
        equipment: { ...person.equipment }, progression: { ...person.progression }, genome: { ...person.genome },
        memories: person.memories.map(memory => ({ ...memory })),
      })),
      clans: [...this.clans.values()].map(clan => ({ ...clan, memberIds: [...clan.memberIds] })),
      // A mine building carries a live Three.js `mesh` reference (see buildMineMesh()) that isn't
      // part of the building's actual state — just the object rendering it — and, being part of
      // the scene graph, has circular parent/children links that would throw a "converting
      // circular structure to JSON" error the moment JSON.stringify reached it. Drop it here and
      // let _rebuildBuildingVisuals() recreate it lazily on load, exactly like a fresh building.
      productionSites: [...this.productionSites.values()].map(site => ({
        ...site, buildings: site.buildings.map(({ mesh, ...building }) => ({ ...building })),
      })),
      armies: [...this.armies.values()].map(army => ({ ...army, soldierIds: [...army.soldierIds] })),
      communities: [...this.communities.values()].map(community => ({ ...community })),
      cultures: [...this.cultures.values()].map(culture => ({ ...culture, traditions: [...culture.traditions] })),
      languages: [...this.languages.values()].map(language => ({ ...language })),
      religions: [...this.religions.values()].map(religion => ({ ...religion })),
    };
  }

  restore(data = {}) {
    this.people.clear(); this.clans.clear(); this.productionSites.clear(); this.armies.clear();
    this.communities.clear(); this.cultures.clear(); this.languages.clear(); this.religions.clear(); this.subspecies.clear();
    for (const row of Array.isArray(data.people) ? data.people : []) {
      const creatureId = Number(row?.creatureId);
      const creature = this.creatures.creatureById.get(creatureId);
      if (!creature) continue;
      this.people.set(creatureId, {
        creatureId,
        partnerId: Number.isInteger(Number(row.partnerId)) ? Number(row.partnerId) : null,
        parentIds: uniqueIds(row.parentIds), childrenIds: uniqueIds(row.childrenIds),
        clanId: Number.isInteger(Number(row.clanId)) ? Number(row.clanId) : null,
        generation: Math.max(0, Math.trunc(finite(row.generation))),
        inventory: (Array.isArray(row.inventory) ? row.inventory : []).slice(0, 12).map(item => ({ ...item })),
        equipment: { tool: null, weapon: null, armor: null, ...(row.equipment || {}) },
        progression: { level: 1, xp: 0, kills: 0, ...(row.progression || {}) },
        genome: normalizeGenome(row.genome, creature.type),
        genomeInherited: row.genomeInherited !== false,
        genomeApplied: row.genomeApplied === true,
        happiness: clamp(finite(row.happiness, 60), 0, 100),
        memories: (Array.isArray(row.memories) ? row.memories : []).slice(-10).map(memory => ({
          type: String(memory?.type || 'event'), text: String(memory?.text || 'Un recuerdo').slice(0, 140),
          impact: clamp(memory?.impact, -25, 25), age: Math.max(0, finite(memory?.age)),
        })),
        cultureId: Number(row.cultureId) > 0 ? Number(row.cultureId) : null,
        languageId: Number(row.languageId) > 0 ? Number(row.languageId) : null,
        religionId: Number(row.religionId) > 0 ? Number(row.religionId) : null,
        subspeciesId: typeof row.subspeciesId === 'string' ? row.subspeciesId : null,
      });
    }
    for (const row of Array.isArray(data.clans) ? data.clans : []) {
      const id = Number(row?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      this.clans.set(id, { ...row, id, memberIds: uniqueIds(row.memberIds) });
    }
    for (const row of Array.isArray(data.productionSites) ? data.productionSites : []) {
      const settlementId = Number(row?.settlementId);
      if (!this.settlements.settlements.some(s => s.id === settlementId)) continue;
      this.productionSites.set(settlementId, {
        settlementId,
        siegeHealth: Math.max(0, finite(row.siegeHealth, 100)),
        buildings: (Array.isArray(row.buildings) ? row.buildings : []).filter(building => BUILDINGS[building?.type]).map(building => ({ ...building })),
      });
    }
    for (const row of Array.isArray(data.armies) ? data.armies : []) {
      const empireId = Number(row?.empireId);
      if (!this.settlements.empires.some(e => e.id === empireId)) continue;
      this.armies.set(empireId, {
        ...row, empireId, soldierIds: uniqueIds(row.soldierIds),
        posture: POSTURE_MULTIPLIERS[row.posture] ? row.posture : 'balanced',
      });
    }
    for (const row of Array.isArray(data.cultures) ? data.cultures : []) {
      const id = Number(row?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      this.cultures.set(id, {
        id, name: String(row.name || `Cultura ${id}`).slice(0, 60),
        value: CULTURE_VALUES.includes(row.value) ? row.value : 'naturaleza',
        traditions: [...new Set((Array.isArray(row.traditions) ? row.traditions : []).map(String))].slice(0, 12),
        originSettlementId: Number(row.originSettlementId) || null,
      });
    }
    for (const row of Array.isArray(data.languages) ? data.languages : []) {
      const id = Number(row?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      this.languages.set(id, { id, name: String(row.name || `Lengua ${id}`).slice(0, 60), originSettlementId: Number(row.originSettlementId) || null, speakers: Math.max(0, Math.trunc(finite(row.speakers))) });
    }
    for (const row of Array.isArray(data.religions) ? data.religions : []) {
      const id = Number(row?.id);
      if (!Number.isInteger(id) || id <= 0) continue;
      this.religions.set(id, {
        id, name: String(row.name || `Fe ${id}`).slice(0, 60),
        tenet: RELIGION_TENETS.includes(row.tenet) ? row.tenet : 'familia',
        holySettlementId: Number(row.holySettlementId) || null,
        followers: Math.max(0, Math.trunc(finite(row.followers))),
      });
    }
    for (const row of Array.isArray(data.communities) ? data.communities : []) {
      const settlementId = Number(row?.settlementId);
      if (!this.settlements.settlements.some(settlement => settlement.id === settlementId)) continue;
      this.communities.set(settlementId, {
        settlementId,
        cultureId: this.cultures.has(Number(row.cultureId)) ? Number(row.cultureId) : null,
        languageId: this.languages.has(Number(row.languageId)) ? Number(row.languageId) : null,
        religionId: this.religions.has(Number(row.religionId)) ? Number(row.religionId) : null,
        cohesion: clamp(row.cohesion, 0, 100),
      });
    }
    this.nextClanId = Math.max(1, Math.trunc(finite(data.nextClanId, 1)), ...[...this.clans.keys()].map(id => id + 1));
    this.nextItemId = Math.max(1, Math.trunc(finite(data.nextItemId, 1)));
    this.nextCultureId = Math.max(1, Math.trunc(finite(data.nextCultureId, 1)), ...[...this.cultures.keys()].map(id => id + 1));
    this.nextLanguageId = Math.max(1, Math.trunc(finite(data.nextLanguageId, 1)), ...[...this.languages.keys()].map(id => id + 1));
    this.nextReligionId = Math.max(1, Math.trunc(finite(data.nextReligionId, 1)), ...[...this.religions.keys()].map(id => id + 1));
    for (const creature of this.creatures.creatures) this.ensurePerson(creature);
    this._ensureSocieties();
    this._updateAdaptationAndWellbeing(0);
    this._visualDirty = true;
    this._rebuildBuildingVisuals();
    this._rebuildSocialLayer();
    return this;
  }

  dispose() {
    this._unsubDeath?.();
    this._unsubBirth?.(); this._unsubLevel?.(); this._unsubWar?.(); this._unsubPeace?.(); this._unsubAlliance?.(); this._unsubCapture?.(); this._unsubShip?.();
    for (const mesh of this.buildingMeshes.values()) {
      mesh.geometry.dispose(); mesh.material.dispose(); this.group.remove(mesh);
    }
    this.buildingMeshes.clear();
    for (const site of this.productionSites.values()) this._disposeSiteMines(site);
    this.socialLayerMesh.geometry.dispose(); this.socialLayerMesh.material.dispose(); this.group.remove(this.socialLayerMesh);
    this.scene.remove(this.group);
    this.people.clear(); this.clans.clear(); this.productionSites.clear(); this.armies.clear();
    this.communities.clear(); this.cultures.clear(); this.languages.clear(); this.religions.clear(); this.subspecies.clear();
  }
}

export { BUILDINGS };
