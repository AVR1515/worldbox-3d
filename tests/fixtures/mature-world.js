// Controlled, flat reference: isolates active cities from island/vegetation costs.
export function populateMatureWorld(session, population = 500) {
  const { world, creatures, settlements, civilization } = session;
  world.height.fill(7); world.biome.fill(2); world.moisture.fill(.5);
  world.jitter.fill(1); world.temperature.fill(18);
  for (let z = 0; z < world.size; z++) for (let x = 0; x < world.size; x++) {
    if (x < 10 || z < 10 || x >= world.size - 10 || z >= world.size - 10) world.height[world.idx(x, z)] = 0;
  }
  world.buildTerrainMesh();
  const empires = [settlements.createEmpire(), settlements.createEmpire()];
  const cities = [];
  for (const [index, [x, z]] of [[-24,-24], [24,-24], [-24,24], [24,24]].entries()) {
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
    }
    settlements.addWall(city); settlements.addTower(city); settlements.addFlag(city); settlements.addLabel(city);
    const site = civilization._siteFor(city);
    for (const type of ['warehouse', 'workshop', 'smithy', 'barracks', 'market']) site.buildings.push({ type, level: 1, health: 120 });
  }
  const civilianTotal = Math.min(900, population);
  const counts = [320, 200, 200, 180].map(cap => Math.floor(cap * civilianTotal / 900));
  counts[0] += civilianTotal - counts.reduce((sum, n) => sum + n, 0);
  for (const [cityIndex, city] of cities.entries()) for (let i = 0; i < counts[cityIndex]; i++) {
    const angle = i * 2.399963, radius = 8 + (i % 7) * .45;
    const creature = creatures.spawn(city.race, city.x + Math.cos(angle) * radius, city.z + Math.sin(angle) * radius, { sex: i % 2 ? 'f' : 'm' });
    if (!creature) throw new Error(`No se pudo crear habitante ${cityIndex}/${i}`);
    creature.age = 20;
    creatures.setHome(creature, city.id, city.empireId, city.x, city.z, 16);
    city.pop++;
  }
  const wildlife = population - civilianTotal;
  const herbivores = Math.min(355, wildlife);
  for (let i = 0; i < herbivores; i++) {
    if (!creatures.spawn('herbivore', (i % 20 - 10) * 1.2, (Math.floor(i / 20) - 9) * 1.2)) throw new Error('Límite de herbívoros');
  }
  for (let i = 0; i < wildlife - herbivores; i++) {
    if (!creatures.spawn('fish', ...world.gridToWorld(2 + i % 5, 2 + Math.floor(i / 5)))) throw new Error('Límite de peces');
  }
  for (const empire of empires) settlements.ensureKing(empire);
  civilization.update(1);
  return { cities, empires };
}
