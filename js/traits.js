export const TRAITS = {
  fuerte:    { name: 'Fuerte',    icon: '💪', desc: '+30% daño y +20% salud máxima', apply: c => { c.damageMul *= 1.3; c.maxHealth *= 1.2; } },
  rapido:    { name: 'Rápido',    icon: '⚡', desc: '+25% velocidad de movimiento', apply: c => { c.speedMul *= 1.25; } },
  perezoso:  { name: 'Perezoso',  icon: '🦥', desc: '-20% velocidad de movimiento', apply: c => { c.speedMul *= 0.8; } },
  longevo:   { name: 'Longevo',   icon: '⏳', desc: '+40% esperanza de vida', apply: c => { c.maxAge *= 1.4; } },
  fertil:    { name: 'Fértil',    icon: '🌱', desc: 'Se reproduce con más frecuencia', apply: c => { c.reproMul *= 0.6; } },
  debil:     { name: 'Débil',     icon: '🩹', desc: '-25% salud máxima', apply: c => { c.maxHealth *= 0.75; } },
  piromano:  { name: 'Pirómano',  icon: '🔥', desc: 'Inmune al fuego', apply: c => { c.fireImmune = true; } },
  codicioso: { name: 'Codicioso', icon: '💰', desc: 'Impulsa la fundación de aldeas', apply: c => { c.greedy = true; } },
  gloton:    { name: 'Glotón',    icon: '🍖', desc: '+50% de apetito', apply: c => { c.hungerMul *= 1.5; } },
  sano:      { name: 'Sano',      icon: '❤️', desc: 'Resiste mejor las enfermedades', apply: c => { c.diseaseResist = true; } },
  valiente:  { name: 'Valiente',  icon: '🛡️', desc: 'Nunca huye de depredadores', apply: c => { c.fearless = true; } },
  inmortal:  { name: 'Inmortal',  icon: '♾️', desc: 'No muere de vejez', apply: c => { c.immortal = true; } },
};

const TRAIT_IDS = Object.keys(TRAITS).filter(id => id !== 'inmortal');

export function pickTraits() {
  if (Math.random() < 0.004) return ['inmortal'];
  const roll = Math.random();
  const n = roll < 0.4 ? 0 : roll < 0.8 ? 1 : 2;
  const pool = [...TRAIT_IDS];
  const picked = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

export function applyTraits(c) {
  c.speedMul = 1; c.damageMul = 1; c.maxHealth = 100; c.hungerMul = 1; c.reproMul = 1;
  c.fireImmune = false; c.diseaseResist = false; c.fearless = false; c.immortal = false; c.greedy = false;
  for (const id of c.traits || []) TRAITS[id]?.apply(c);
}

const NAME_POOLS = {
  human: {
    m: ['Aldric', 'Bram', 'Cedric', 'Doran', 'Edric', 'Fenn', 'Gareth', 'Hendrick', 'Ivo', 'Joran', 'Kael', 'Leon', 'Milo', 'Nolan', 'Oren', 'Piers', 'Quin', 'Roran', 'Soren', 'Torin'],
    f: ['Aira', 'Brenna', 'Ceria', 'Dara', 'Elin', 'Fiora', 'Greta', 'Hilde', 'Isolde', 'Jora', 'Kira', 'Lena', 'Mira', 'Nyla', 'Orla', 'Petra', 'Rhea', 'Sela', 'Talia', 'Vesna'],
  },
  orc: {
    m: ['Grosh', 'Uzgar', 'Mogul', 'Thrak', 'Krug', 'Dulg', 'Ragnok', 'Vorn', 'Zug', 'Hrok'],
    f: ['Grukha', 'Uzza', 'Morga', 'Thruka', 'Krula', 'Dulga', 'Ragna', 'Vorka', 'Zugra', 'Hroka'],
  },
  elf: {
    m: ['Aelar', 'Beiro', 'Caelan', 'Doran', 'Erevan', 'Faelar', 'Galinor', 'Hiran', 'Ivellios', 'Laucian'],
    f: ['Aelis', 'Birel', 'Caelynn', 'Drusilia', 'Enna', 'Faelyn', 'Galinda', 'Hiralia', 'Ivenne', 'Lyssara'],
  },
  dwarf: {
    m: ['Balin', 'Durik', 'Grombar', 'Thorek', 'Ulfgar', 'Baern', 'Dagnal', 'Grimjor', 'Torvald', 'Ovrik'],
    f: ['Bardra', 'Durga', 'Grimna', 'Thordis', 'Ulfa', 'Baela', 'Dagna', 'Grima', 'Torva', 'Ovra'],
  },
};

export function genName(sex, race = 'human') {
  const pools = NAME_POOLS[race] || NAME_POOLS.human;
  const pool = sex === 'f' ? pools.f : pools.m;
  return pool[Math.floor(Math.random() * pool.length)];
}
