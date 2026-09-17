import { CONFIG } from '../../js/world.js';

// Nearest buildable grid spot to (gx0, gz0): not water and not steep mountain within a `pad`-cell
// footprint. Real generated terrain (hills/rivers/coastline) doesn't line up with the reference
// fixture's fixed [-24,-24]-style corners the way a flattened plane does, so city placement has to
// search instead of assume.
function findBuildableSpot(world, gx0, gz0, pad = 5) {
  for (let r = 0; r < 60; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const gx = gx0 + dx, gz = gz0 + dz;
      if (!world.inBounds(gx, gz)) continue;
      if (world.isWater(gx, gz) || world.height[world.idx(gx, gz)] >= CONFIG.MAX_H - 6) continue;
      let ok = true;
      for (let fz = -pad; fz <= pad && ok; fz++) for (let fx = -pad; fx <= pad && ok; fx++) {
        const gx2 = gx + fx, gz2 = gz + fz;
        if (!world.inBounds(gx2, gz2) || world.isWater(gx2, gz2) || world.height[world.idx(gx2, gz2)] >= CONFIG.MAX_H - 6) ok = false;
      }
      if (ok) return [gx, gz];
    }
  }
  return [gx0, gz0];
}

function findWaterSpot(world, gx0, gz0) {
  for (let r = 0; r < 60; r++) {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const gx = gx0 + dx, gz = gz0 + dz;
      if (!world.inBounds(gx, gz)) continue;
      if (world.isWater(gx, gz)) return [gx, gz];
    }
  }
  return [gx0, gz0];
}

// Flood-fills outward through contiguous walkable land cells from a seed found by
// findBuildableSpot — same reasoning as collectWaterSpots below, for herbivores instead of fish.
function collectLandSpots(world, gx0, gz0, count) {
  const [sgx, sgz] = findBuildableSpot(world, gx0, gz0, 0);
  const results = [];
  const visited = new Set([`${sgx},${sgz}`]);
  const queue = [[sgx, sgz]];
  while (queue.length && results.length < count) {
    const [gx, gz] = queue.shift();
    results.push([gx, gz]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz, key = `${nx},${nz}`;
      if (visited.has(key) || !world.inBounds(nx, nz)) continue;
      visited.add(key);
      if (world.isWater(nx, nz) || world.height[world.idx(nx, nz)] >= CONFIG.MAX_H - 6) continue;
      queue.push([nx, nz]);
    }
  }
  return results;
}

// Flood-fills outward through contiguous water cells from a seed found by findWaterSpot — a real
// coastline isn't a filled rectangle the way the reference fixture's small fixed patch of ocean
// is, so a naive grid of offsets from one water tile can walk back onto land.
function collectWaterSpots(world, gx0, gz0, count) {
  const [sgx, sgz] = findWaterSpot(world, gx0, gz0);
  const results = [];
  const visited = new Set([`${sgx},${sgz}`]);
  const queue = [[sgx, sgz]];
  while (queue.length && results.length < count) {
    const [gx, gz] = queue.shift();
    results.push([gx, gz]);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + dx, nz = gz + dz, key = `${nx},${nz}`;
      if (visited.has(key) || !world.inBounds(nx, nz) || !world.isWater(nx, nz)) continue;
      visited.add(key);
      queue.push([nx, nz]);
    }
  }
  return results;
}

// Same city population as mature-world.js, but on real generated terrain (hills/forest/rivers)
// instead of the flattened reference plane — isolates whether Ultra performance holds once the
// cities the C-07-C-12 chain validated coexist with the vegetation/shadow cost the forest chain
// validated separately. Neither prior benchmark measured both at once.
export function populateMatureWorldOnTerrain(session, population = 500) {
  const { world, creatures, settlements, civilization } = session;
  const empires = [settlements.createEmpire(), settlements.createEmpire()];
  const cities = [];
  for (const [index, [wx, wz]] of [[-24, -24], [24, -24], [-24, 24], [24, 24]].entries()) {
    const [gx0, gz0] = world.worldToGrid(wx, wz);
    const [gx, gz] = findBuildableSpot(world, gx0, gz0);
    const [x, z] = world.gridToWorld(gx, gz);
    const empire = empires[index % 2];
    const city = { id: settlements.nextSettlementId++, x, z, level: 3, pop: 0,
      empireId: empire.id, race: ['human', 'elf', 'orc', 'dwarf'][index], name: `Referencia ${index + 1}`,
      houses: [], farms: [], loyalty: 100, growTimer: 999, emptyTimer: 0,
      resources: { wood: 150, stone: 150, food: 300, gold: 80, gems: 0, ore: 50, tools: 30, weapons: 30, armor: 30, goods: 30, fish: 0 } };
    settlements.settlements.push(city); cities.push(city);
    if (empire.capitalId == null) empire.capitalId = city.id;
    for (let i = 0; i < 14; i++) {
      const house = { slot: settlements.allocHouseSlot(), x: x + (i % 4 - 1.5) * 2.2,
        z: z + (Math.floor(i / 4) - 1.5) * 2.2, variant: 1, scaleMul: 1, rotationY: 0 };
      city.houses.push(house); settlements._syncHouseInstance(city, house, true);
      settlements._syncPathInstance(city, house, true);
    }
    settlements.addWall(city); settlements.addTower(city); settlements.addFlag(city); settlements.addLabel(city);
    const site = civilization._siteFor(city);
    for (const type of ['warehouse', 'workshop', 'smithy', 'barracks', 'market']) site.buildings.push({ type, level: 1, health: 120 });
  }
  // Real terrain isn't flat/treeless like the reference fixture: clear trees under each city's
  // footprint the same way a live game does when house paths are (re)built, instead of leaving
  // trees clipping through houses and walls.
  settlements._flushHousePaths();
  const civilianTotal = Math.min(900, population);
  const counts = [320, 200, 200, 180].map(cap => Math.floor(cap * civilianTotal / 900));
  counts[0] += civilianTotal - counts.reduce((sum, n) => sum + n, 0);
  for (const [cityIndex, city] of cities.entries()) for (let i = 0; i < counts[cityIndex]; i++) {
    const angle = i * 2.399963;
    // The city center is known-buildable land (findBuildableSpot above), but a fixed radius can
    // still land a citizen on water/mountain past the checked footprint on real terrain (unlike
    // the reference fixture's flat plane) — shrink toward the center instead of failing outright.
    let creature = null;
    for (let radius = 8 + (i % 7) * .45; radius > 0.5 && !creature; radius *= 0.7) {
      creature = creatures.spawn(city.race, city.x + Math.cos(angle) * radius, city.z + Math.sin(angle) * radius, { sex: i % 2 ? 'f' : 'm' });
    }
    if (!creature) creature = creatures.spawn(city.race, city.x, city.z, { sex: i % 2 ? 'f' : 'm' });
    if (!creature) throw new Error(`No se pudo crear habitante ${cityIndex}/${i}`);
    creature.age = 20;
    creatures.setHome(creature, city.id, city.empireId, city.x, city.z, 16);
    city.pop++;
  }
  const wildlife = population - civilianTotal;
  const herbivores = Math.min(355, wildlife);
  const [hgx0, hgz0] = world.worldToGrid(0, 0);
  const landSpots = collectLandSpots(world, hgx0, hgz0, herbivores);
  for (let i = 0; i < herbivores; i++) {
    const spot = landSpots[i % landSpots.length];
    if (!creatures.spawn('herbivore', ...world.gridToWorld(...spot))) throw new Error('Límite de herbívoros');
  }
  const fishCount = wildlife - herbivores;
  const [fgx0, fgz0] = world.worldToGrid(0, 0);
  const waterSpots = collectWaterSpots(world, fgx0, fgz0, fishCount);
  for (let i = 0; i < fishCount; i++) {
    const spot = waterSpots[i % waterSpots.length];
    if (!creatures.spawn('fish', ...world.gridToWorld(...spot))) throw new Error('Límite de peces');
  }
  for (const empire of empires) settlements.ensureKing(empire);
  civilization.update(1);
  return { cities, empires };
}
