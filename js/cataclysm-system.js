import * as THREE from 'three';

const MINE_GEO = new THREE.CylinderGeometry(0.22, 0.28, 0.1, 10);
const MINE_MAT = new THREE.MeshStandardMaterial({ color: 0x393d42, metalness: 0.5, roughness: 0.55 });

function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }

export class CataclysmSystem {
  constructor(scene, world, creatures, settlements, opts = {}) {
    this.scene = scene; this.world = world; this.creatures = creatures; this.settlements = settlements;
    this.events = opts.events || null; this.laws = opts.laws || {}; this.toast = opts.toast || (() => {});
    this.mines = []; this.nextMineId = 1; this.disasterTimer = 90 + Math.random() * 90;
    this.group = new THREE.Group(); this.group.name = 'persistent-mines'; scene.add(this.group);
  }

  _mineMesh(x, z) {
    const mesh = new THREE.Mesh(MINE_GEO, MINE_MAT);
    mesh.position.set(x, this.world.heightAtWorld(x, z) + 0.06, z);
    mesh.castShadow = true; this.group.add(mesh); return mesh;
  }

  placeMine(x, z, power = 1) {
    const [gx, gz] = this.world.worldToGrid(x, z);
    if (!this.world.inBounds(gx, gz) || this.world.isWater(gx, gz)) return null;
    const mine = { id: this.nextMineId++, x, z, power: Math.max(0.5, Math.min(3, finite(power, 1))), armedIn: 2, mesh: this._mineMesh(x, z) };
    this.mines.push(mine); return mine;
  }

  _damageBuildings(x, z, radius) {
    for (const settlement of this.settlements.settlements.slice()) {
      for (const house of settlement.houses.slice()) {
        if (Math.hypot(house.x - x, house.z - z) <= radius) {
          this.settlements.removeHouse(house);
          settlement.houses = settlement.houses.filter(item => item !== house);
        }
      }
      if (!settlement.houses.length) this.settlements.removeSettlement(settlement);
    }
  }

  detonate(x, z, tier = {}) {
    const radius = Math.max(0.5, finite(tier.radius, 1.5));
    const damageRadius = Math.max(radius, finite(tier.damageRadius, radius * 1.5));
    const [gx, gz] = this.world.worldToGrid(x, z);
    this.world.terraform(gx, gz, radius, finite(tier.craterDepth, -3));
    this.world.igniteInRadius(gx, gz, radius * 1.3);
    if (tier.heat) this.world.applyHeat(gx, gz, radius * 1.2, tier.heat, tier.lava === true);
    this.creatures.killAllInRadius(x, z, damageRadius);
    this._damageBuildings(x, z, damageRadius);
    this.events?.emit?.('cataclysm:detonation', { x, z, radius, tier });
  }

  earthquake(x, z, radius = 8, strength = 1) {
    const [gx, gz] = this.world.worldToGrid(x, z);
    for (let index = 0; index < 10; index++) {
      const angle = Math.random() * Math.PI * 2, distance = Math.random() * radius;
      this.world.terraform(Math.round(gx + Math.cos(angle) * distance), Math.round(gz + Math.sin(angle) * distance), 0.8 + strength, (Math.random() - 0.58) * 3 * strength);
    }
    for (const creature of this.creatures.queryRadius(x, z, radius)) creature.health -= 18 * strength * (1 - Math.hypot(creature.x - x, creature.z - z) / radius);
    this._damageBuildings(x, z, radius * 0.35 * strength);
    this.events?.emit?.('cataclysm:earthquake', { x, z, radius, strength });
  }

  _naturalDisaster() {
    const x = (Math.random() - 0.5) * this.world.size * 0.7, z = (Math.random() - 0.5) * this.world.size * 0.7;
    const roll = Math.random();
    if (roll < 0.34) { this.earthquake(x, z, 5 + Math.random() * 6, 0.7); this.toast('🌎 Un terremoto sacude el mundo'); }
    else if (roll < 0.67) {
      const [gx, gz] = this.world.worldToGrid(x, z); this.world.igniteInRadius(gx, gz, 2.5 + Math.random() * 3); this.toast('🔥 Se inicia un incendio natural');
    } else {
      const [gx, gz] = this.world.worldToGrid(x, z); this.world.meteorImpact(gx, gz, 1.5); this.creatures.killAllInRadius(x, z, 2.4); this.toast('☄️ Un meteorito cae sin aviso');
    }
  }

  update(dt) {
    for (const mine of [...this.mines]) {
      mine.armedIn -= dt;
      if (mine.armedIn > 0) continue;
      const victim = this.creatures.queryRadius(mine.x, mine.z, 0.75, creature => creature.alive)[0];
      if (!victim) continue;
      this.detonate(mine.x, mine.z, { radius: 0.9 * mine.power, damageRadius: 1.6 * mine.power, craterDepth: -1.5 * mine.power });
      this.group.remove(mine.mesh); this.mines = this.mines.filter(item => item !== mine);
    }
    if (this.laws.naturalDisasters === false) return;
    this.disasterTimer -= dt;
    if (this.disasterTimer <= 0) {
      this.disasterTimer = 100 + Math.random() * 140;
      this._naturalDisaster();
    }
  }

  serialize() {
    return { version: 1, nextMineId: this.nextMineId, disasterTimer: Math.max(0, this.disasterTimer), mines: this.mines.map(({ id, x, z, power, armedIn }) => ({ id, x, z, power, armedIn })) };
  }

  restore(data = {}) {
    for (const mine of this.mines) this.group.remove(mine.mesh);
    this.mines = [];
    for (const row of Array.isArray(data.mines) ? data.mines : []) {
      const x = finite(row.x), z = finite(row.z);
      const mine = { id: Math.max(1, Math.trunc(finite(row.id, this.nextMineId++))), x, z, power: Math.max(0.5, Math.min(3, finite(row.power, 1))), armedIn: Math.max(0, finite(row.armedIn)), mesh: this._mineMesh(x, z) };
      this.mines.push(mine);
    }
    this.nextMineId = Math.max(1, Math.trunc(finite(data.nextMineId, 1)), ...this.mines.map(mine => mine.id + 1));
    this.disasterTimer = Math.max(0, finite(data.disasterTimer, 120));
  }

  dispose() {
    this.scene.remove(this.group); this.mines.length = 0;
  }
}
