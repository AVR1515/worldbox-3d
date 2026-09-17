import * as THREE from 'three';
import { CONFIG } from './world.js';
import { NavigationGrid } from './navigation.js';
import { GLTFLoader } from '../node_modules/three/examples/jsm/loaders/GLTFLoader.js';

function lerp(a, b, t) { return a + (b - a) * t; }

function routeLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  return total;
}

function sampleRoute(route, progress) {
  if (!route?.length) return { x: 0, z: 0, heading: 0 };
  if (route.length === 1) return { ...route[0], heading: 0 };
  const total = routeLength(route) || 1;
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 1; i < route.length; i++) {
    const from = route[i - 1], to = route[i];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (remaining <= length || i === route.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 1;
      return { x: lerp(from.x, to.x, t), z: lerp(from.z, to.z, t), heading: Math.atan2(to.x - from.x, to.z - from.z) };
    }
    remaining -= length;
  }
  const last = route[route.length - 1];
  return { ...last, heading: 0 };
}

const HULL_MAT = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9 });
const DECK_MAT = new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.95 });
const SAIL_MAT = new THREE.MeshStandardMaterial({ color: 0xe8e2cf, roughness: 0.85, side: THREE.DoubleSide });
const MAST_MAT = new THREE.MeshStandardMaterial({ color: 0x4a3320, roughness: 1 });
const SHARED_BOAT_MATERIALS = new Set([HULL_MAT, DECK_MAT, SAIL_MAT, MAST_MAT]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

// ---------- Real ship model, Fase 10 ----------
// Loaded once and cloned per ship; every clone shares the template's geometry/materials (see the
// `sharedGltf` flag below), so disposeBoatMesh must skip them — only the per-instance pennant
// plane gets its own geometry/material to free.
const SHIP_LENGTH = 2.3; // matches the old primitive hull's ~2.15 length, read from world units
const shipLoader = new GLTFLoader();
let shipTemplate = null;
let shipPennantHeight = 1.56; // falls back to the primitive mast's old pennant height until loaded

function fitBoatToLength(object, targetLength) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const scale = targetLength / (Math.max(size.x, size.z) || 1);
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

let shipRequested = false;
function ensureShipTemplateRequested() {
  // Vitest's unit-test environment is plain Node (no `document`/`window`), and Three's loaders
  // resolve relative URLs against `document.baseURI` — this guard keeps ship-restoring unit
  // tests on the primitive fallback instead of throwing, without affecting real browser play.
  if (shipRequested || typeof document === 'undefined') return;
  shipRequested = true;
  shipLoader.load('./assets/gislinge_viking_boat.glb', gltf => {
    const fitted = fitBoatToLength(gltf.scene, SHIP_LENGTH);
    fitted.traverse(object => {
      if (object.isMesh) { object.castShadow = true; object.userData.sharedGltf = true; }
    });
    shipPennantHeight = new THREE.Box3().setFromObject(fitted).max.y + 0.12;
    shipTemplate = fitted;
  }, undefined, error => {
    console.warn('No se pudo cargar el modelo 3D del barco (assets/gislinge_viking_boat.glb); se usará el modelo generado por código.', error);
  });
}

// Exported so main.js can call this when the map creator opens, same as models.js's
// preloadCreatureModels() and for the same reason: an eager top-level call here fires before
// tests/e2e/game.spec.js's "no requests before Jugar is visible" check runs, since this .glb's
// embedded textures decode through local blob: URLs that check mistakes for an external request.
export function preloadShipModel() {
  ensureShipTemplateRequested();
}

function disposeBoatMesh(mesh) {
  mesh.traverse(object => {
    if (object.userData.sharedGltf) return;
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material && !SHARED_BOAT_MATERIALS.has(material)) material.dispose?.();
    }
  });
}

function buildBoatMesh(role = 'transport') {
  ensureShipTemplateRequested();
  const pennantColor = role === 'fishing' ? 0x4f9fc4 : (role === 'trade' ? 0xe1bb4b : 0xc94c3a);
  const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1), new THREE.MeshStandardMaterial({ color: pennantColor, side: THREE.DoubleSide }));
  if (shipTemplate) {
    const g = shipTemplate.clone(true);
    pennant.position.set(0, shipPennantHeight, 0);
    g.add(pennant);
    return g;
  }
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 2.15), HULL_MAT);
  hull.position.y = 0.19; hull.castShadow = true;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 1.9), DECK_MAT);
  deck.position.y = 0.41;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 5), MAST_MAT);
  mast.position.set(0, 0.85, -0.1);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), SAIL_MAT);
  sail.position.set(0, 0.95, -0.08);
  sail.rotation.y = Math.PI / 2;
  pennant.position.set(0, 1.56, -0.1);
  g.add(hull, deck, mast, sail, pennant);
  return g;
}

// Ferries a handful of colonists across open water to a distant, unconnected shore —
// the closest thing to naval colonization the sim supports right now (see roadmap fase 3/4).
export class ShipManager {
  constructor(scene, world, creatures, settlements, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.creatures = creatures;
    this.settlements = settlements;
    this.toast = opts.toast || (() => {});
    this.events = opts.events || null;
    this.navigation = new NavigationGrid(world, { maxVisited: 14000 });
    this.ships = [];
    this.timer = 12 + Math.random() * 8;
    this.serviceTimer = 8 + Math.random() * 6;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _nearestWaterPoint(vx, vz, radius = 3) {
    let best = null;
    let bestDistance = Infinity;
    this.world.forEachInRadius(vx, vz, radius, (x, z) => {
      if (!this.world.isWater(x, z)) return;
      const distance = Math.hypot(x - vx, z - vz);
      if (distance >= bestDistance) return;
      const [wx, wz] = this.world.gridToWorld(x, z);
      best = { x: wx, z: wz };
      bestDistance = distance;
    });
    return best;
  }

  _waterLineIsClear(from, to) {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(distance / 0.65));
    for (let step = 0; step <= steps; step++) {
      const progress = step / steps;
      const x = lerp(from.x, to.x, progress);
      const z = lerp(from.z, to.z, progress);
      const [gx, gz] = this.world.worldToGrid(x, z);
      if (!this.world.isWater(gx, gz) || this.world.ice?.[this.world.idx(gx, gz)]) return false;
    }
    return true;
  }

  _findLanding(origin, launchPoint) {
    const world = this.world;
    let best = null, bestD = 0;
    for (let t = 0; t < 120; t++) {
      const gx = Math.floor(Math.random() * world.size), gz = Math.floor(Math.random() * world.size);
      if (world.isWater(gx, gz)) continue;
      const [wx, wz] = world.gridToWorld(gx, gz);
      const d = Math.hypot(wx - origin.x, wz - origin.z);
      if (d <= bestD || d <= world.size * 0.16) continue;
      const waterPoint = this._nearestWaterPoint(gx, gz, 2.5);
      if (!waterPoint) continue;
      const route = this.navigation.findPathWorld(launchPoint, waterPoint, { mode: 'water', maxVisited: 14000 });
      if (!route.length) continue;
      bestD = d;
      best = { point: { x: wx, z: wz }, waterPoint, route: [{ x: launchPoint.x, z: launchPoint.z }, ...route] };
    }
    return best ? { ...best, dist: bestD } : null;
  }

  _tryLaunch() {
    const coastal = this.settlements.settlements.filter(s => {
      if (s.pop < 9) return false;
      const [vx, vz] = this.world.worldToGrid(s.x, s.z);
      return this.world.isCoastal(vx, vz, 5);
    });
    if (!coastal.length) return;
    const origin = coastal[Math.floor(Math.random() * coastal.length)];
    const passengers = this.creatures.creatures.filter(c => c.alive && c.settlementId === origin.id &&
      c.role !== 'soldado' && c.profession !== 'Rey' && !c.possessed && c.age > 7);
    if (passengers.length < 3) return;
    let launchPoint = origin.dockPoint || { x: origin.x, z: origin.z };
    const [launchX, launchZ] = this.world.worldToGrid(launchPoint.x, launchPoint.z);
    if (!this.world.isWater(launchX, launchZ)) {
      launchPoint = this._nearestWaterPoint(launchX, launchZ, 4);
    }
    if (!launchPoint) return;
    const landing = this._findLanding(origin, launchPoint);
    if (!landing) return;
    const n = Math.min(3, passengers.length);
    const crew = passengers.slice(0, n);
    for (const c of crew) {
      this.creatures.clearHome(c);
      c.sailing = true;
      c.target = null;
      if (c.model3d) c.model3d.root.visible = false;
    }
    const mesh = buildBoatMesh('transport');
    mesh.position.set(launchPoint.x, CONFIG.WATER_LEVEL + 0.14, launchPoint.z);
    this.group.add(mesh);
    const route = landing.route;
    this.ships.push({
      mesh, from: { x: launchPoint.x, z: launchPoint.z }, to: landing.waterPoint, landing: landing.point,
      role: 'transport', originSettlementId: origin.id,
      route, t: 0, duration: Math.max(6, routeLength(route) / 7), crew, cargo: {},
    });
    this.events?.emit?.('ship:launched', { origin, crew, landing: landing.point });
    this.toast(`⛵ Una expedición zarpa desde el muelle de ${origin.name} en busca de nuevas costas`);
  }

  _coastalSettlements() {
    return this.settlements.settlements.filter(settlement => {
      const [vx, vz] = this.world.worldToGrid(settlement.x, settlement.z);
      return settlement.dockPoint && this.world.isCoastal(vx, vz, 5);
    });
  }

  _launchFishingShip(origin) {
    const launch = origin.dockPoint;
    const [gx, gz] = this.world.worldToGrid(launch.x, launch.z);
    let destination = null;
    for (let attempt = 0; attempt < 18; attempt++) {
      const angle = Math.random() * Math.PI * 2, distance = 5 + Math.random() * 9;
      const vx = Math.round(gx + Math.cos(angle) * distance), vz = Math.round(gz + Math.sin(angle) * distance);
      if (!this.world.inBounds(vx, vz) || !this.world.isWater(vx, vz) || this.world.ice?.[this.world.idx(vx, vz)]) continue;
      const [x, z] = this.world.gridToWorld(vx, vz);
      destination = { x, z };
      break;
    }
    if (!destination) return false;
    const outward = this.navigation.findPathWorld(launch, destination, { mode: 'water', maxVisited: 5000 });
    if (!outward.length) return false;
    const route = [{ ...launch }, ...outward, ...outward.slice(0, -1).reverse(), { ...launch }];
    const mesh = buildBoatMesh('fishing');
    this.group.add(mesh);
    this.ships.push({
      role: 'fishing', mesh, from: { ...launch }, to: { ...launch }, landing: { ...launch }, route,
      t: 0, duration: Math.max(8, routeLength(route) / 5.5), crew: [], cargo: { fish: 8 + Math.random() * 8 },
      originSettlementId: origin.id, destinationSettlementId: origin.id,
    });
    this.events?.emit?.('ship:launched', { origin, role: 'fishing', crew: [] });
    return true;
  }

  _launchTradeShip(origin, destination) {
    if (!origin.dockPoint || !destination.dockPoint) return false;
    const routePart = this.navigation.findPathWorld(origin.dockPoint, destination.dockPoint, { mode: 'water', maxVisited: 16000 });
    if (!routePart.length) return false;
    // Cargo capacity is capped at 10, but must never exceed what's actually in the warehouse —
    // Math.max(2, ...) here used to force a floor of 2 goods shipped even when origin had less
    // (or zero) in stock, driving resources.goods negative. Require at least 2 in stock instead
    // of manufacturing them.
    const goods = Math.min(10, origin.resources?.goods || 0);
    if (goods < 2) return false;
    origin.resources.goods -= goods;
    const route = [{ ...origin.dockPoint }, ...routePart];
    const mesh = buildBoatMesh('trade');
    this.group.add(mesh);
    this.ships.push({
      role: 'trade', mesh, from: { ...origin.dockPoint }, to: { ...destination.dockPoint }, landing: { ...destination.dockPoint }, route,
      t: 0, duration: Math.max(8, routeLength(route) / 6.2), crew: [], cargo: { goods },
      originSettlementId: origin.id, destinationSettlementId: destination.id,
    });
    this.events?.emit?.('ship:launched', { origin, destination, role: 'trade', crew: [] });
    return true;
  }

  _tryServiceLaunch() {
    const coastal = this._coastalSettlements();
    if (!coastal.length) return;
    const activeOrigins = new Set(this.ships.filter(ship => ship.role !== 'transport').map(ship => ship.originSettlementId));
    const origin = coastal.find(settlement => !activeOrigins.has(settlement.id));
    if (!origin) return;
    const allies = coastal.filter(other => other !== origin && other.empireId !== origin.empireId &&
      ['peace', 'alliance'].includes(this.settlements.empires.find(e => e.id === origin.empireId)?.relations.get(other.empireId)?.status));
    if (origin.resources?.goods >= 2 && allies.length && Math.random() < 0.55) {
      if (this._launchTradeShip(origin, allies[Math.floor(Math.random() * allies.length)])) return;
    }
    this._launchFishingShip(origin);
  }

  _finishShip(ship) {
    const origin = this.settlements.settlements.find(s => s.id === ship.originSettlementId);
    const destination = this.settlements.settlements.find(s => s.id === ship.destinationSettlementId);
    if (ship.role === 'fishing') {
      if (origin?.resources) {
        origin.resources.fish = (origin.resources.fish || 0) + (ship.cargo?.fish || 0);
        origin.resources.food += (ship.cargo?.fish || 0) * 0.75;
      }
      this.toast(`🎣 Un barco pesquero regresa${origin ? ` a ${origin.name}` : ''} con su captura`, { history: false });
    } else if (ship.role === 'trade') {
      const goods = ship.cargo?.goods || 0;
      if (destination?.resources) destination.resources.goods = (destination.resources.goods || 0) + goods * 0.65;
      if (origin?.resources) origin.resources.gold = (origin.resources.gold || 0) + goods * 0.7;
      if (destination?.resources) destination.resources.gold = (destination.resources.gold || 0) + goods * 0.15;
      this.toast(`⛵ Una ruta comercial marítima entrega bienes${destination ? ` en ${destination.name}` : ''}`, { history: false });
    }
    for (const c of ship.crew) {
      if (!c.alive) continue;
      c.sailing = false;
      const landing = ship.landing || ship.to;
      c.x = landing.x + (Math.random() - 0.5) * 2.4;
      c.z = landing.z + (Math.random() - 0.5) * 2.4;
      c.y = this.world.heightAtWorld(c.x, c.z);
      c.target = null;
      if (c.model3d) c.model3d.root.visible = true;
    }
    this.group.remove(ship.mesh);
    disposeBoatMesh(ship.mesh);
    this.ships = this.ships.filter(s => s !== ship);
    this.events?.emit?.('ship:landed', {
      crew: ship.crew, landing: ship.landing || ship.to, role: ship.role || 'transport', origin, destination,
    });
    if (!ship.role || ship.role === 'transport') this.toast('🏝️ La expedición desembarca en tierras nuevas');
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 24 + Math.random() * 18; this._tryLaunch(); }
    this.serviceTimer -= dt;
    if (this.serviceTimer <= 0) { this.serviceTimer = 16 + Math.random() * 14; this._tryServiceLaunch(); }
    for (const ship of this.ships.slice()) {
      ship.crew = ship.crew.filter(creature => creature?.alive);
      if ((!ship.role || ship.role === 'transport') && !ship.crew.length) {
        this.group.remove(ship.mesh);
        disposeBoatMesh(ship.mesh);
        this.ships = this.ships.filter(candidate => candidate !== ship);
        continue;
      }
      const route = ship.route || [ship.from, ship.to];
      const p = Math.min(1, (ship.t + dt) / ship.duration);
      const position = sampleRoute(route, p);
      const current = sampleRoute(route, Math.min(1, ship.t / ship.duration));
      // Terraformar o congelar un canal no debe permitir que un barco atraviese tierra.
      if (this.world.isWater && this.world.worldToGrid && !this._waterLineIsClear(current, position)) {
        ship.routeRetry = Math.max(0, (ship.routeRetry || 0) - dt);
        if (!ship.routeRetry) {
          ship.routeRetry = 2;
          const alternative = this.navigation.findPathWorld(current, ship.to, { mode: 'water', maxVisited: 5000 });
          if (alternative.length) {
            ship.route = [{ x: current.x, z: current.z }, ...alternative];
            ship.from = { x: current.x, z: current.z };
            ship.t = 0;
            ship.duration = Math.max(0.1, routeLength(ship.route) / 7);
          }
        }
        continue;
      }
      ship.t += dt;
      ship.mesh.position.set(position.x, CONFIG.WATER_LEVEL + 0.14 + Math.sin(ship.t * 2.4) * 0.05, position.z);
      ship.mesh.rotation.y = position.heading;
      ship.mesh.rotation.z = Math.sin(ship.t * 1.6) * 0.05;
      if (p >= 1) this._finishShip(ship);
    }
  }

  serialize() {
    return {
      version: 1,
      timer: Math.max(0, finite(this.timer, 18)),
      serviceTimer: Math.max(0, finite(this.serviceTimer, 12)),
      ships: this.ships.map(ship => ({
        role: ship.role || 'transport',
        from: { x: finite(ship.from?.x), z: finite(ship.from?.z) },
        to: { x: finite(ship.to?.x), z: finite(ship.to?.z) },
        landing: { x: finite(ship.landing?.x, ship.to?.x), z: finite(ship.landing?.z, ship.to?.z) },
        route: (ship.route || [ship.from, ship.to]).map(point => ({ x: finite(point.x), z: finite(point.z) })),
        t: Math.max(0, finite(ship.t)),
        duration: Math.max(0.1, finite(ship.duration, 8)),
        originSettlementId: ship.originSettlementId ?? null,
        destinationSettlementId: ship.destinationSettlementId ?? null,
        cargo: { ...(ship.cargo || {}) },
        crewIds: ship.crew.filter(creature => creature?.alive).map(creature => creature.id),
      })).filter(ship => ship.role !== 'transport' || ship.crewIds.length > 0),
    };
  }

  restore(payload = {}) {
    for (const ship of this.ships) {
      this.group.remove(ship.mesh);
      disposeBoatMesh(ship.mesh);
    }
    this.ships = [];
    this.timer = Math.max(0, finite(payload.timer, 18));
    this.serviceTimer = Math.max(0, finite(payload.serviceTimer, 12));
    const assignedCrew = new Set();
    const rows = Array.isArray(payload.ships) ? payload.ships : [];
    const limit = this.world.size / 2;

    for (const row of rows) {
      const crew = [];
      for (const id of Array.isArray(row?.crewIds) ? row.crewIds : []) {
        const creature = this.creatures.creatureById.get(Number(id));
        if (!creature?.alive || assignedCrew.has(creature.id)) continue;
        assignedCrew.add(creature.id);
        crew.push(creature);
      }
      const role = ['fishing', 'trade', 'transport'].includes(row?.role) ? row.role : 'transport';
      if (role === 'transport' && !crew.length) continue;

      const from = {
        x: Math.max(-limit, Math.min(limit, finite(row?.from?.x))),
        z: Math.max(-limit, Math.min(limit, finite(row?.from?.z))),
      };
      const to = {
        x: Math.max(-limit, Math.min(limit, finite(row?.to?.x))),
        z: Math.max(-limit, Math.min(limit, finite(row?.to?.z))),
      };
      const landing = {
        x: Math.max(-limit, Math.min(limit, finite(row?.landing?.x, to.x))),
        z: Math.max(-limit, Math.min(limit, finite(row?.landing?.z, to.z))),
      };
      const duration = Math.max(0.1, finite(row?.duration, 8));
      const t = Math.max(0, Math.min(duration, finite(row?.t)));
      const route = Array.isArray(row?.route) && row.route.length >= 2
        ? row.route.map(point => ({
          x: Math.max(-limit, Math.min(limit, finite(point?.x))),
          z: Math.max(-limit, Math.min(limit, finite(point?.z))),
        }))
        : [from, to];
      const mesh = buildBoatMesh(role);
      const progress = Math.min(1, t / duration);
      const position = sampleRoute(route, progress);
      mesh.position.set(position.x, CONFIG.WATER_LEVEL + 0.14, position.z);
      mesh.rotation.y = position.heading;
      this.group.add(mesh);
      for (const creature of crew) {
        creature.sailing = true;
        creature.target = null;
        if (creature.model3d) creature.model3d.root.visible = false;
      }
      this.ships.push({
        mesh, role, from, to, landing, route, t, duration, crew,
        originSettlementId: row?.originSettlementId ?? null,
        destinationSettlementId: row?.destinationSettlementId ?? null,
        cargo: Object.fromEntries(Object.entries(row?.cargo && typeof row.cargo === 'object' ? row.cargo : {})
          .filter(([key]) => key === 'goods' || key === 'fish')
          .map(([key, value]) => [key, Math.max(0, finite(value))])),
      });
    }

    for (const creature of this.creatures.creatures) {
      if (!creature.sailing || assignedCrew.has(creature.id)) continue;
      creature.sailing = false;
      if (creature.model3d) creature.model3d.root.visible = true;
    }
    return this.ships.length;
  }

  dispose() {
    for (const ship of this.ships.slice()) {
      for (const c of ship.crew) { c.sailing = false; if (c.model3d) c.model3d.root.visible = true; }
      this.group.remove(ship.mesh);
      disposeBoatMesh(ship.mesh);
    }
    this.ships = [];
    this.scene.remove(this.group);
  }
}
