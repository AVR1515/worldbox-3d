import { test, expect } from '@playwright/test';

// Fase B, "Economía": extracción → transporte → almacén → producción → uso never had a
// punta-a-punta walkthrough (see docs/HISTORIAL-PROGRESO.md). Mine extraction → equip was
// already covered by tests/unit/civilization-phase4.test.js, and trade-ship departure by
// tests/unit/ship-launches.test.js — but nothing exercised the workshop/production step
// together with the ship's ARRIVAL side (destination.resources.goods/gold actually crediting),
// which is the one genuinely untested leg of the chain. This runs the whole thing live, through
// runtime.update() ticks, letting the game's own autonomous trade-ship logic (ShipManager's
// _tryServiceLaunch(), not a call this test makes directly) decide when to sail — closer to a
// real playthrough than staging the departure by hand.
test('extracción, producción, transporte marítimo autónomo y uso: recorrido económico completo', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/economy-transport', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/economy-transport');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const { SaveRepository, SAVE_FORMAT_VERSION } = await import('/js/save-system.js');
    let seed = 909;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const render = new RenderSystem(document.querySelector('canvas'));
    const laws = { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: false, rebellions: false, naturalDisasters: false };
    let session = new GameSession({ scene: render.scene, size: 100, laws });

    // Two landmasses split by a short water channel, so both cities get a real dock and a real
    // (short) sailing route — flat and featureless is fine, this isn't testing terrain.
    session.world.height.fill(7); session.world.biome.fill(2); session.world.moisture.fill(.5);
    session.world.jitter.fill(1); session.world.temperature.fill(18);
    for (let z = 0; z < session.world.size; z++) for (let x = 44; x < 56; x++) session.world.height[session.world.idx(x, z)] = 0;
    session.world.buildTerrainMesh();

    function makeCity(id, empire, gx, name) {
      const [x, z] = session.world.gridToWorld(gx, 50);
      const city = {
        // level 1 keeps _desiredBuilding()'s auto-construction (civilization-system.js) from
        // adding a minLevel:2 building of its own — an auto-built 'market' at the origin would
        // drain the same goods the workshop produces, undermining the very thing this test
        // measures. The workshop/market buildings this test cares about are added explicitly
        // below regardless of level.
        id, x, z, level: 1, pop: 0, empireId: empire.id, race: 'human', name,
        houses: [], farms: [], loyalty: 100, growTimer: 999, emptyTimer: 0,
        resources: { wood: 0, stone: 0, food: 100, gold: 0, gems: 0, ore: 0, tools: 0, weapons: 0, armor: 0, goods: 0, fish: 0 },
      };
      session.settlements.settlements.push(city);
      empire.capitalId = city.id;
      for (let i = 0; i < 2; i++) {
        const c = session.creatures.spawn('human', x + i * 0.3, z, { sex: i % 2 ? 'f' : 'm' });
        c.age = 20;
        session.creatures.setHome(c, city.id, empire.id, x, z, 16);
      }
      return city;
    }
    const empireA = session.settlements.createEmpire(), empireB = session.settlements.createEmpire();
    const origin = makeCity(session.settlements.nextSettlementId++, empireA, 40, 'Origen');
    const destination = makeCity(session.settlements.nextSettlementId++, empireB, 60, 'Destino');
    session.settlements.addDock(origin);
    session.settlements.addDock(destination);
    const dockA = !!origin.dockPoint, dockB = !!destination.dockPoint;

    session.civilization._siteFor(origin).buildings.push({ type: 'workshop', level: 1, health: 120 });
    session.civilization._siteFor(destination).buildings.push({ type: 'market', level: 1, health: 120 });

    // Seed the raw materials the workshop converts — extraction itself (mine → resources) is
    // already covered elsewhere; this test's job starts at production.
    origin.resources.wood = 200; origin.resources.stone = 200;

    const resourcesValid = () => session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0));
    let negativeAt = null;
    const tick = () => { session.runtime.update(1 / 30, 1); if (!negativeAt && !resourcesValid()) negativeAt = 'desconocido'; };

    // --- Producción + transporte autónomo: el taller produce bienes; ShipManager decide por su
    // cuenta cuándo zarpar un barco de comercio (_tryServiceLaunch, temporizador propio) en vez
    // de que esta prueba fuerce el viaje. ---
    let shipLaunched = false, originGoodsAtLaunch = null, arrived = false;
    const trace = [];
    for (let i = 0; i < 12000 && !(shipLaunched && arrived); i++) {
      tick();
      if (!shipLaunched && session.ships.ships.some(s => s.role === 'trade' && s.originSettlementId === origin.id)) {
        shipLaunched = true;
        originGoodsAtLaunch = origin.resources.goods;
      }
      if (!arrived && destination.resources.goods > 0) arrived = true;
      if (i % 900 === 0) trace.push({ i, originGoods: +origin.resources.goods.toFixed(2), destGoods: +destination.resources.goods.toFixed(2), ships: session.ships.ships.length });
    }
    const goodsAtDestinationAfterArrival = destination.resources.goods;
    const originGoldAfterArrival = origin.resources.gold;
    const destinationGoldAfterArrival = destination.resources.gold;

    // --- Persistencia a mitad de la cadena: guardar y recargar no debe perder ni duplicar nada. ---
    const keys = ['world', 'creatures', 'settlements', 'ships', 'civilization'];
    const repository = new SaveRepository(localStorage);
    repository.save({ version: SAVE_FORMAT_VERSION, schema: { version: SAVE_FORMAT_VERSION }, ...Object.fromEntries(keys.map(key => [key, session[key].serialize()])) });
    const saved = repository.load();
    session.dispose();
    session = new GameSession({ scene: render.scene, size: 100, laws });
    for (const key of keys) session[key].restore(saved[key]);
    const destinationAfterReload = session.settlements.settlements.find(s => s.id === destination.id);
    const goodsAfterReload = destinationAfterReload.resources.goods;

    // --- Uso: el mercado de destino convierte los bienes recibidos en oro. ---
    for (let i = 0; i < 3600 && destinationAfterReload.resources.goods > 0.5; i++) {
      session.runtime.update(1 / 30, 1);
      if (!negativeAt && !session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0))) negativeAt = 'tras recargar';
    }
    const destinationGoldAfterUse = destinationAfterReload.resources.gold;

    return {
      dockA, dockB, negativeAt, trace,
      shipLaunched, originGoodsAtLaunch, arrived, goodsAtDestinationAfterArrival,
      originGoldAfterArrival, destinationGoldAfterArrival, goodsAfterReload, destinationGoldAfterUse,
    };
  });
  await testInfo.attach('economy-transport.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.negativeAt).toBeNull();
  expect(result.dockA).toBe(true);
  expect(result.dockB).toBe(true);
  expect(result.shipLaunched).toBe(true);
  expect(result.arrived).toBe(true);
  expect(result.goodsAtDestinationAfterArrival).toBeGreaterThan(0);
  expect(result.originGoldAfterArrival).toBeGreaterThan(0);
  expect(result.destinationGoldAfterArrival).toBeGreaterThan(0);
  expect(result.goodsAfterReload).toBeCloseTo(result.goodsAtDestinationAfterArrival, 5);
  expect(result.destinationGoldAfterUse).toBeGreaterThan(result.destinationGoldAfterArrival);
  expect(errors).toEqual([]);
});
