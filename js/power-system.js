export const POWERS = Object.freeze([
  { id: 'inspect', icon: '🖐️', label: 'Inspec.', continuous: false, radius: false },
  { id: 'raise', icon: '⛰️', label: 'Elevar', continuous: true, radius: true },
  { id: 'lower', icon: '🕳️', label: 'Bajar', continuous: true, radius: true },
  { id: 'water', icon: '💧', label: 'Agua', continuous: true, radius: true },
  { id: 'tree', icon: '🌳', label: 'Bosque', continuous: true, radius: true },
  { id: 'biome_forest', icon: '🌿', label: 'Pradera', continuous: true, radius: true },
  { id: 'biome_dry', icon: '🏜️', label: 'Árido', continuous: true, radius: true },
  { id: 'biome_swamp', icon: '🐸', label: 'Pantano', continuous: true, radius: true },
  { id: 'fire', icon: '🔥', label: 'Fuego', continuous: true, radius: true },
  { id: 'rain', icon: '🌧️', label: 'Lluvia', continuous: false, radius: false },
  { id: 'frost', icon: '❄️', label: 'Congelar', continuous: true, radius: true },
  { id: 'heat', icon: '☀️', label: 'Calentar', continuous: true, radius: true },
  { id: 'lava', icon: '🌋', label: 'Lava', continuous: true, radius: true },
  { id: 'lightning', icon: '⚡', label: 'Rayo', continuous: false, radius: false },
  { id: 'meteor', icon: '☄️', label: 'Meteoro', continuous: false, radius: true },
  { id: 'spawn_herb', icon: '🐑', label: 'Herbívoro', continuous: false, radius: false },
  { id: 'spawn_carn', icon: '🐺', label: 'Carnívoro', continuous: false, radius: false },
  { id: 'spawn_fish', icon: '🐟', label: 'Pez', continuous: false, radius: false },
  { id: 'spawn_boar', icon: '🐗', label: 'Jabalí', continuous: false, radius: false },
  { id: 'spawn_bear', icon: '🐻', label: 'Oso', continuous: false, radius: false },
  { id: 'spawn_human', icon: '🧑', label: 'Humano', continuous: false, radius: false },
  { id: 'spawn_orc', icon: '🧌', label: 'Orco', continuous: false, radius: false },
  { id: 'spawn_elf', icon: '🧝', label: 'Elfo', continuous: false, radius: false },
  { id: 'spawn_dwarf', icon: '⛏️', label: 'Enano', continuous: false, radius: false },
  { id: 'spawn_dragon', icon: '🐉', label: 'Dragón', continuous: false, radius: false },
  { id: 'spawn_demon', icon: '😈', label: 'Demonio', continuous: false, radius: false },
  { id: 'spawn_skeleton', icon: '💀', label: 'Esqueleto', continuous: false, radius: false },
  { id: 'spawn_mage', icon: '🧙', label: 'Mago', continuous: false, radius: false },
  { id: 'spawn_fairy', icon: '🧚', label: 'Hada', continuous: false, radius: false },
  { id: 'spawn_ghost', icon: '👻', label: 'Fantasma', continuous: false, radius: false },
  { id: 'spawn_alien', icon: '👽', label: 'Alien', continuous: false, radius: false },
  { id: 'control', icon: '🎮', label: 'Poseer', continuous: false, radius: false },
  { id: 'heal', icon: '❤️', label: 'Bendecir', continuous: true, radius: true },
  { id: 'poison', icon: '🧪', label: 'Veneno', continuous: true, radius: true },
  { id: 'shield', icon: '🫧', label: 'Escudo', continuous: true, radius: true },
  { id: 'madness', icon: '🌀', label: 'Locura', continuous: true, radius: true },
  { id: 'curse', icon: '👁️', label: 'Maldición', continuous: true, radius: true },
  { id: 'clone', icon: '🧬', label: 'Clonar', continuous: false, radius: true },
  { id: 'plague', icon: '☠️', label: 'Plaga', continuous: true, radius: true },
  { id: 'zombie', icon: '🧟', label: 'Zombi', continuous: false, radius: false },
  { id: 'tornado', icon: '🌪️', label: 'Tornado', continuous: false, radius: false },
  { id: 'acidrain', icon: '🧪', label: 'Ác. lluvia', continuous: false, radius: true },
  { id: 'magnet', icon: '🧲', label: 'Imán', continuous: true, radius: true },
  { id: 'earthquake', icon: '🌎', label: 'Terremoto', continuous: false, radius: true },
  { id: 'landmine', icon: '🪤', label: 'Mina', continuous: false, radius: false },
  { id: 'tnt', icon: '🧨', label: 'TNT', continuous: false, radius: false },
  { id: 'bomb', icon: '💣', label: 'Bomba', continuous: false, radius: false },
  { id: 'megabomb', icon: '🧨', label: 'Mega-bomba', continuous: false, radius: false },
  { id: 'nuke', icon: '☢️', label: 'Nuclear', continuous: false, radius: false },
  { id: 'antimatter', icon: '⚫', label: 'Antimateria', continuous: false, radius: false },
  { id: 'erase', icon: '🗑️', label: 'Borrar', continuous: false, radius: true },
  { id: 'diplomacy', icon: '🤝', label: 'Diplomacia', continuous: false, radius: false },
]);

export const BOMB_TIERS = Object.freeze({
  bomb: { radius: 1.1, craterDepth: -3, damageRadius: 1.6, label: 'Bomba', color: 0xff9f43 },
  tnt: { radius: 1.8, craterDepth: -4, damageRadius: 2.7, label: 'TNT', color: 0xff552e },
  megabomb: { radius: 2.8, craterDepth: -6, damageRadius: 4.2, label: 'Mega-bomba', color: 0xff7b22 },
  nuke: { radius: 4.5, craterDepth: -8, damageRadius: 8, heat: 95, label: 'Bomba nuclear', color: 0xdfff72, fallout: true },
  antimatter: { radius: 6.2, craterDepth: -13, damageRadius: 12, label: 'Carga de antimateria', color: 0xa66cff, annihilation: true },
});

export const POWER_CATEGORIES = Object.freeze([
  { id: 'world', label: '🌍 Mundo', tools: ['inspect', 'raise', 'lower', 'water', 'tree', 'biome_forest', 'biome_dry', 'biome_swamp', 'frost', 'heat', 'lava', 'erase'] },
  { id: 'life', label: '🐾 Seres', tools: ['spawn_herb', 'spawn_carn', 'spawn_fish', 'spawn_boar', 'spawn_bear', 'spawn_human', 'spawn_orc', 'spawn_elf', 'spawn_dwarf', 'spawn_dragon', 'spawn_demon', 'spawn_skeleton', 'spawn_mage', 'spawn_fairy', 'spawn_ghost', 'spawn_alien', 'zombie', 'control'] },
  { id: 'divine', label: '⚡ Poderes', tools: ['heal', 'shield', 'poison', 'madness', 'curse', 'clone', 'fire', 'rain', 'lightning', 'meteor', 'earthquake', 'plague', 'tornado', 'acidrain', 'magnet', 'landmine', 'bomb', 'tnt', 'megabomb', 'nuke', 'antimatter'] },
  { id: 'reino', label: '🏰 Reino', tools: ['diplomacy'] },
]);

export class PowerSystem {
  constructor(powers = POWERS, categories = POWER_CATEGORIES) {
    this.powers = powers;
    this.categories = categories;
    this.powerById = new Map(powers.map(power => [power.id, power]));
    this.categoryById = new Map(categories.map(category => [category.id, category]));
  }

  getPower(id) {
    return this.powerById.get(id) || null;
  }

  getCategory(id) {
    return this.categoryById.get(id) || this.categories[0] || null;
  }
}
