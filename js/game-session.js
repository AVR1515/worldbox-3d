import { EventBus } from './core/event-bus.js';
import { CreatureManager } from './creatures.js';
import { GameRuntime } from './game-runtime.js';
import { SettlementManager } from './settlements.js';
import { ShipManager } from './ships.js';
import { World } from './world.js';
import { CivilizationSystem } from './civilization-system.js';
import { StatusSystem } from './status-system.js';
import { CataclysmSystem } from './cataclysm-system.js';

export class GameSession {
  constructor({ scene, size, laws, onToast = null, onStep = null } = {}) {
    this.events = new EventBus();
    if (onToast) this.events.on('ui:toast', ({ message, options } = {}) => onToast(message, options));
    this.world = new World(scene, { size, laws, events: this.events });
    this.creatures = new CreatureManager(scene, this.world, { laws, events: this.events });
    this.settlements = new SettlementManager(scene, this.world, this.creatures, {
      laws,
      events: this.events,
      toast: (message, options) => this.events.emit('ui:toast', { message, options }),
    });
    this.creatures.setSettlementManager(this.settlements);
    this.civilization = new CivilizationSystem(scene, this.world, this.creatures, this.settlements, {
      events: this.events,
      toast: (message, options) => this.events.emit('ui:toast', { message, options }),
    });
    this.creatures.setCivilizationSystem(this.civilization);
    this.settlements.setCivilizationSystem(this.civilization);
    this.statuses = new StatusSystem(this.creatures, { events: this.events });
    this.creatures.setStatusSystem(this.statuses);
    this.cataclysms = new CataclysmSystem(scene, this.world, this.creatures, this.settlements, {
      laws, events: this.events,
      toast: (message, options) => this.events.emit('ui:toast', { message, options }),
    });
    this.ships = new ShipManager(scene, this.world, this.creatures, this.settlements, {
      events: this.events,
      toast: (message, options) => this.events.emit('ui:toast', { message, options }),
    });
    this.events.on('world:terrainChanged', bounds => {
      this.settlements.scheduleTerritoryUpdate(bounds);
      this.settlements.onTerrainChanged(bounds);
    });
    this.runtime = new GameRuntime({
      world: this.world,
      creatures: this.creatures,
      settlements: this.settlements,
      ships: this.ships,
      civilization: this.civilization,
      statuses: this.statuses,
      cataclysms: this.cataclysms,
      events: this.events,
      onStep,
    });
  }

  dispose() {
    this.runtime.dispose();
    this.ships.dispose();
    this.cataclysms.dispose();
    this.statuses.dispose();
    this.civilization.dispose();
    this.settlements.dispose();
    this.creatures.dispose();
    this.world.dispose();
  }
}
