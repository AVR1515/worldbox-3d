import { SimplexNoise } from './noise.js';

const HUMIDITY_BIAS = { arido: -0.26, normal: 0, exuberante: 0.26 };
const CLIMATE_MOISTURE_BIAS = { templado: 0, arido: -0.2, artico: 0.05, tropical: 0.25 };
// Repeated, seeded climate provinces with continuous transitions between them.
const climateCache = new Map();
function climateProvinces(seed) {
  const key = String(seed);
  if (climateCache.has(key)) return climateCache.get(key);
  let state = seedState(seed);
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const cold = 1 + Math.floor(random() * 3), dry = 2 + Math.floor(random() * 3);
  const labels = Array.from({length:16}, (_,i) => i < cold ? 'artico' : i < cold+dry ? 'arido' : i < cold+dry+4 ? 'tropical' : 'templado');
  for (let i=15;i>0;i--) { const j=Math.floor(random()*(i+1)); [labels[i],labels[j]]=[labels[j],labels[i]]; }
  const provinces = labels.map((kind,i) => ({kind,x:(i%4+.2+random()*.6)/4-.5,z:(Math.floor(i/4)+.2+random()*.6)/4-.5,r:.075+random()*.035}));
  if (climateCache.size > 12) climateCache.delete(climateCache.keys().next().value);
  climateCache.set(key,provinces); return provinces;
}
export function regionalClimateSample(vx, vz, size, seed) {
  const x=vx/size-.5, z=vz/size-.5;
  const wx=x+Math.sin(z*19+x*6)*.022, wz=z+Math.sin(x*17-z*5)*.022;
  let total=0,temperature=0,moisture=0, strongest=-1, kind='templado';
  for (const region of climateProvinces(seed)) {
    const distance=(wx-region.x)**2+(wz-region.z)**2;
    const weight=Math.exp(-distance/(2*region.r*region.r));
    total+=weight;
    temperature+=weight*({artico:-15,arido:34,tropical:31,templado:20}[region.kind]);
    moisture+=weight*({artico:.07,arido:-.52,tropical:.4,templado:0}[region.kind]);
    if(weight>strongest) {strongest=weight;kind=region.kind;}
  }
  return {kind,temperature:temperature/total,moisture:moisture/total};
}
export function regionalClimate(vx,vz,size,seed) { return regionalClimateSample(vx,vz,size,seed).kind; }
const WATER_BIAS_HEIGHT = { bajo: 1.6, normal: 0, alto: -1.8 };

function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function seedState(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 0x9e3779b9;
}

function placeArchipelago(size, random) {
  const islands = [];
  const count = size < 160 ? 5 : size < 220 ? 6 : 7;
  for (let i = 0; i < count; i++) {
    let best = null;
    // Spread island centers out; coastlines may fill the space between them.
    // Their shared boundaries become sea channels instead of packing circles.
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = (random() - 0.5) * 0.7, z = (random() - 0.5) * 0.7;
      let clearance = (0.48 - Math.max(Math.abs(x), Math.abs(z))) * 2;
      for (const other of islands) {
        clearance = Math.min(clearance, Math.hypot(x - other.x, z - other.z));
      }
      if (!best || clearance > best.clearance) best = { x, z, clearance };
      if (!islands.length) break;
    }
    islands.push({ ...best, radius: 0.235 + random() * 0.035,
      angle: random() * Math.PI * 2, aspect: 0.62 + random() * 0.2,
      bend: (random() - 0.5) * 0.9, plateau: random() * 0.45 });
  }
  return islands;
}

function archipelagoHeight(nx, nz, islands, noise, mountainLevel, size, waterLevel) {
  // Warp both coasts and separating channels together, keeping them irregular
  // without allowing neighboring islands to join across their shared boundary.
  const wx = nx + noise.fbm(nx * 7 + 40, nz * 7, 3, 2, 0.5) * 0.045;
  const wz = nz + noise.fbm(nx * 7 - 40, nz * 7, 3, 2, 0.5) * 0.045;
  let island = islands[0], nearest = Infinity;
  for (const candidate of islands) {
    const distance = (wx - candidate.x) ** 2 + (wz - candidate.z) ** 2;
    if (distance < nearest) { nearest = distance; island = candidate; }
  }
  let boundary = Infinity;
  for (const other of islands) {
    if (other === island) continue;
    const distance = (wx - other.x) ** 2 + (wz - other.z) ** 2;
    boundary = Math.min(boundary, (distance - nearest) / (2 * Math.hypot(other.x - island.x, other.z - island.z)));
  }
  const dx = wx - island.x, dz = wz - island.z;
  const c = Math.cos(island.angle), s = Math.sin(island.angle);
  const x = (dx * c + dz * s) / island.radius;
  const z = (-dx * s + dz * c) / island.radius;
  // Overlapping lobes form an elongated body and a bent peninsula, rather than
  // a radial cone. The coast profile is independent of the interior relief.
  const body = 1 - Math.hypot((x + 0.16) / 0.95, (z + island.bend * 0.2) / island.aspect);
  const peninsula = 1 - Math.hypot((x - 0.58) / 0.78, (z - island.bend) / (island.aspect * 0.65));
  const detail = noise.fbm(wx * 23 + 30, wz * 23 + 30, 3, 2, 0.5);
  const coast = Math.max(body, peninsula) * island.radius + detail * 0.014;
  const channelHalfWidth = Math.max(2 / size, 0.011);
  const shore = Math.min(coast, boundary - channelHalfWidth, 0.46 - Math.max(Math.abs(wx), Math.abs(wz)));
  // Widening this past ~0.05 (or reshaping floor/inland to shrink the vertical rise instead)
  // was tried and reverted: archipelago.test.js pins land area to a fixed height>5 cutoff, and
  // either move shifts *where* that cutoff falls in shore-space, which either shrinks each
  // island (wider ramp, same cutoff reached later) or fuses neighboring islands across their
  // strait (raised floor/lowered inland, cutoff reached sooner — including inside channels that
  // are supposed to stay underwater). 0.05 is the widest transition that still lands the cutoff
  // in the same place the original 0.045 did, closely enough for every seed/preset combination
  // this suite checks.
  const shelf = smoothstep(shore / 0.05);
  const rolling = noise.fbm(wx * 11 - 80, wz * 11, 3, 2, 0.5);
  const hills = smoothstep((rolling - 0.12) / 0.55) * ([0.25, 2.2, 6][mountainLevel] ?? 2.2);
  const floor = Math.max(0, waterLevel - 3);
  const inland = waterLevel + 2.7 + island.plateau + rolling * 0.5 + hills;
  return floor + shelf * (inland - floor);
}

export function generateBaseTerrain({
  size, seed, mapType = 'island', mountainLevel = 1, humidity = 'normal',
  climate = 'templado', waterLevelPreset = 'normal', maxHeight = 24, waterLevel = 5,
}) {
  const verts = size + 1;
  const length = verts * verts;
  const half = size / 2;
  const height = new Float32Array(length);
  const moisture = new Float32Array(length);
  const jitter = new Float32Array(length);
  const mountainExp = [2.0, 1.5, 0.78][mountainLevel] ?? 1.5;
  const humidityBias = HUMIDITY_BIAS[humidity] || 0;
  const climateMoistBias = CLIMATE_MOISTURE_BIAS[climate] || 0;
  const waterBiasHeight = WATER_BIAS_HEIGHT[waterLevelPreset] || 0;
  const elevNoise = new SimplexNoise(seed);
  const warpNoise = new SimplexNoise(seed + 13.7);
  const moistNoise = new SimplexNoise(seed + 91.7);
  const islandNoise = new SimplexNoise(seed + 251.3);
  const ridgeNoise = new SimplexNoise(seed + 517.9);
  let rngState = seedState(seed);
  const random = () => {
    let state = rngState >>> 0;
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    rngState = state || 0x9e3779b9;
    return (rngState >>> 0) / 4294967296;
  };
  const islands = mapType === 'archipelago' ? placeArchipelago(size, random) : null;

  for (let vz = 0; vz <= size; vz++) {
    for (let vx = 0; vx <= size; vx++) {
      const index = vz * verts + vx;
      const nx = (vx - half) / size;
      const nz = (vz - half) / size;
      const warpX = warpNoise.fbm(nx * 2 + 10, nz * 2 + 10, 3, 2, 0.5) * 0.18;
      const warpZ = warpNoise.fbm(nx * 2 - 10, nz * 2 - 10, 3, 2, 0.5) * 0.18;
      const wx = nx + warpX, wz = nz + warpZ;
      const distance = Math.sqrt(wx * wx + wz * wz);
      let elevation, falloff;

      if (mapType === 'archipelago') {
        elevation = archipelagoHeight(nx, nz, islands, islandNoise, mountainLevel, size, waterLevel);
      } else if (mapType === 'continents') {
        elevation = elevNoise.fbm(wx * 2.4, wz * 2.4, 5, 2, 0.5);
        const lake = (islandNoise.fbm(wx * 1.4 + 40, wz * 1.4 + 40, 3, 2, 0.5) + 1) / 2;
        falloff = (1 - smoothstep(distance / 0.92)) - (lake > 0.62 ? (lake - 0.62) * 2.4 : 0);
      } else if (mapType === 'ring') {
        elevation = elevNoise.fbm(wx * 3.2, wz * 3.2, 5, 2.05, 0.5);
        falloff = 1 - smoothstep(Math.abs(distance - 0.36) / 0.24);
      } else {
        elevation = elevNoise.fbm(wx * 3, wz * 3, 5, 2.05, 0.5);
        falloff = 1 - smoothstep(distance / 0.72);
      }

      let normalized = islands ? elevation / maxHeight
        : Math.pow(Math.max(0, Math.min(1, (elevation * 0.4 + falloff * 1.05 - 0.4 + 1) / 2)), mountainExp);
      // fBm alone only ever produces smoothly rolling hills — no cliff faces or jagged peaks.
      // Ridged noise (1 - |fbm|) folds valleys into sharp creases; masked to the upper half of
      // the height range and added on top (never subtracted), so it can't lower dry land below
      // the water line or otherwise disturb the tuned island/continent shape below that band.
      if (!islands && normalized > 0.5) {
        const ridge = 1 - Math.abs(ridgeNoise.fbm(wx * 6.5, wz * 6.5, 4, 2.1, 0.5));
        const ridgeMask = smoothstep((normalized - 0.5) / 0.5);
        normalized = Math.min(1, normalized + ridge * ridgeMask * 0.22);
      }
      const edgeDistance = Math.min(vx, size - vx, vz, size - vz);
      const edgeMask = smoothstep(Math.min(1, edgeDistance / 9));
      let h = normalized * maxHeight;
      // Keep coastlines intact while flattening the inland profile of the plain preset.
      if (!islands && mountainLevel === 0 && h > waterLevel + 1) {
        h = waterLevel + 1 + (h - waterLevel - 1) * 0.24;
      }
      h = h * edgeMask + (waterLevel - 3) * (1 - edgeMask);
      h = Math.max(0, Math.min(maxHeight, h + waterBiasHeight * edgeMask));
      // Most coastline should read as a flat beach at sea level, not a cliff dropping straight
      // into the water — every map type's own noise otherwise keeps climbing right past the
      // shoreline at whatever rate the interior relief happens to use there, however steep
      // (reported live, with a screenshot, as a settlement founded at the coast sitting on a
      // narrow shelf with a sharp drop to the water). Only a thin band just above the waterline
      // gets compressed toward a flat beach; it blends back into the untouched relief a few units
      // up, so mountains can still meet the sea, just not everywhere at once. Applied to the
      // finished height (after the edge/water-level-preset shift above) so the band sits at the
      // actual waterline regardless of preset, and for every map type, archipelago included.
      //
      // The compression rate r(t) (t = how far through the band, 0 at the shore to 1 at its outer
      // edge) itself eases from a low floor up to exactly 1 at the boundary, and height is the
      // *integral* of that rate rather than a direct blend of the endpoint heights — a blend that
      // multiplies a growing scale factor by a growing height difference can overshoot a slope of
      // 1 partway through the band (caught by a test asserting the beach only ever gets flatter,
      // never locally steeper than the untouched terrain would have been). Integrating keeps the
      // local slope (the derivative w.r.t. h) equal to r(t) everywhere: always <=1, so this can
      // only flatten, and it matches the untouched slope with no seam right at the boundary.
      const COASTAL_BAND = 3.2, RATE_FLOOR = 0.15;
      if (h > waterLevel && h < waterLevel + COASTAL_BAND) {
        const t = (h - waterLevel) / COASTAL_BAND;
        const integral = RATE_FLOOR * t + (1 - RATE_FLOOR) * (t ** 3 - 0.5 * t ** 4);
        h = waterLevel + COASTAL_BAND * integral;
      }
      // Physical-scale erosion detail keeps large maps from becoming stretched hills.
      // Leave beaches and the flat preset intact; break up inland slopes and ridgelines.
      if (mountainLevel > 0 && h > waterLevel + 3.4) {
        const inland = smoothstep((h - waterLevel - 3.4) / 3);
        const crags = ridgeNoise.fbm(vx * .085 + 71, vz * .085 - 19, 3, 2.1, .5);
        const ridge = 1 - Math.abs(ridgeNoise.fbm(wx * 17, wz * 17, 3, 2, .5));
        h = Math.max(waterLevel + 3.4, Math.min(maxHeight, h + inland * (crags * .85 + (ridge - .65) * (mountainLevel === 2 ? 2.4 : 1.2))));
      }
      height[index] = h;
      const localBias = climate === 'mixto' ? regionalClimateSample(vx, vz, size, seed).moisture : climateMoistBias;
      const wetness = (moistNoise.fbm(nx * 3.5 + 50, nz * 3.5 + 50, 4, 2, 0.5) + 1) / 2 + humidityBias + localBias;
      moisture[index] = Math.max(0, Math.min(1, wetness));
      jitter[index] = 0.94 + random() * 0.12;
    }
  }
  return { height, moisture, jitter, rngState: rngState >>> 0 };
}
