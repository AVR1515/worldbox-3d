import * as THREE from 'three';

export const STATUS_DEFINITIONS = Object.freeze({
  frozen: { label: 'Congelado', icon: '❄️', color: 0x9ddcff, defaultDuration: 14 },
  poisoned: { label: 'Envenenado', icon: '🧪', color: 0x87d957, defaultDuration: 18 },
  shielded: { label: 'Escudo', icon: '🫧', color: 0x7fc8ff, defaultDuration: 24 },
  madness: { label: 'Locura', icon: '🌀', color: 0xd184ff, defaultDuration: 22 },
  blessed: { label: 'Bendecido', icon: '✨', color: 0xffe082, defaultDuration: 35 },
  cursed: { label: 'Maldito', icon: '👁️', color: 0x7c63a8, defaultDuration: 35 },
});

const STATUS_COLORS = new Map(Object.entries(STATUS_DEFINITIONS).map(([id, definition]) => [id, new THREE.Color(definition.color)]));

function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }

export class StatusSystem {
  constructor(creatures, opts = {}) {
    this.creatures = creatures;
    this.events = opts.events || null;
    this._nearby = [];
    this.active = new Set();
  }

  _statuses(creature) {
    if (!Array.isArray(creature.statuses)) creature.statuses = [];
    return creature.statuses;
  }

  apply(creature, type, options = {}) {
    const definition = STATUS_DEFINITIONS[type];
    if (!creature?.alive || !definition) return false;
    const statuses = this._statuses(creature);
    const existing = statuses.find(status => status.type === type);
    const duration = Math.max(0.1, finite(options.duration, definition.defaultDuration));
    const intensity = Math.max(0.1, Math.min(3, finite(options.intensity, 1)));
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
      existing.intensity = Math.max(existing.intensity, intensity);
      this.active.add(creature);
      return true;
    }
    const status = { type, remaining: duration, intensity, applied: true };
    if (type === 'shielded') {
      status.bonusHealth = 45 * intensity;
      creature.maxHealth += status.bonusHealth;
      creature.health += status.bonusHealth;
    } else if (type === 'blessed') {
      status.damageBonus = 0.18 * intensity;
      status.speedBonus = 0.12 * intensity;
      creature.damageMul *= 1 + status.damageBonus;
      creature.speedMul *= 1 + status.speedBonus;
      creature.health = creature.maxHealth;
      creature.hunger = Math.max(0, creature.hunger - 40);
    } else if (type === 'cursed') {
      status.damagePenalty = Math.min(0.45, 0.2 * intensity);
      status.speedPenalty = Math.min(0.4, 0.18 * intensity);
      creature.damageMul *= 1 - status.damagePenalty;
      creature.speedMul *= 1 - status.speedPenalty;
    }
    statuses.push(status);
    this.active.add(creature);
    creature.model3d && (creature.model3d._lastTint = null);
    this.events?.emit?.('status:applied', { creature, type, status });
    return true;
  }

  applyInRadius(x, z, radius, type, options = {}) {
    const nearby = this.creatures.queryRadius(x, z, radius, creature => creature.alive, this._nearby);
    let affected = 0;
    for (const creature of nearby) if (this.apply(creature, type, options)) affected++;
    return affected;
  }

  remove(creature, type) {
    const statuses = this._statuses(creature);
    const status = statuses.find(item => item.type === type);
    if (!status) return false;
    if (type === 'shielded' && status.bonusHealth) {
      creature.maxHealth = Math.max(1, creature.maxHealth - status.bonusHealth);
      creature.health = Math.min(creature.maxHealth, creature.health);
    } else if (type === 'blessed') {
      creature.damageMul /= 1 + finite(status.damageBonus);
      creature.speedMul /= 1 + finite(status.speedBonus);
    } else if (type === 'cursed') {
      creature.damageMul /= Math.max(0.1, 1 - finite(status.damagePenalty));
      creature.speedMul /= Math.max(0.1, 1 - finite(status.speedPenalty));
    }
    creature.statuses = statuses.filter(item => item !== status);
    if (!creature.statuses.length) this.active.delete(creature);
    creature.model3d && (creature.model3d._lastTint = null);
    this.events?.emit?.('status:removed', { creature, type });
    return true;
  }

  clearNegative(creature) {
    for (const type of ['frozen', 'poisoned', 'madness', 'cursed']) this.remove(creature, type);
  }

  movementMultiplier(creature) {
    const frozen = Array.isArray(creature?.statuses) ? creature.statuses.find(status => status.type === 'frozen') : null;
    return frozen ? Math.max(0.22, 0.62 - frozen.intensity * 0.12) : 1;
  }

  tint(creature) {
    const statuses = Array.isArray(creature?.statuses) ? creature.statuses : [];
    for (const type of ['shielded', 'blessed', 'cursed', 'madness', 'poisoned', 'frozen']) {
      if (statuses.some(status => status.type === type)) return STATUS_COLORS.get(type);
    }
    return null;
  }

  describe(creature) {
    return (Array.isArray(creature?.statuses) ? creature.statuses : []).map(status => {
      const definition = STATUS_DEFINITIONS[status.type];
      return { type: status.type, label: definition?.label || status.type, icon: definition?.icon || '•', remaining: Math.ceil(status.remaining) };
    });
  }

  update(dt) {
    for (const creature of [...this.active]) {
      if (!creature.alive || !Array.isArray(creature.statuses) || !creature.statuses.length) { this.active.delete(creature); continue; }
      for (const status of [...creature.statuses]) {
        status.remaining -= dt;
        if (status.type === 'poisoned') creature.health -= dt * 3.2 * status.intensity;
        else if (status.type === 'cursed') creature.health -= dt * 0.45 * status.intensity;
        else if (status.type === 'blessed') creature.health = Math.min(creature.maxHealth, creature.health + dt * 1.5 * status.intensity);
        else if (status.type === 'madness' && Math.random() < dt * 0.35) {
          const angle = Math.random() * Math.PI * 2;
          creature.target = { x: creature.x + Math.cos(angle) * 5, z: creature.z + Math.sin(angle) * 5 };
          creature.hunting = null; creature.combatTarget = null;
        }
        if (status.remaining <= 0) this.remove(creature, status.type);
      }
    }
  }

  syncFromCreatures() {
    this.active.clear();
    for (const creature of this.creatures.creatures) if (creature.alive && Array.isArray(creature.statuses) && creature.statuses.length) this.active.add(creature);
  }

  dispose() { this._nearby.length = 0; this.active.clear(); }
}
