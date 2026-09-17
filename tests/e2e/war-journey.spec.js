import { test, expect } from '@playwright/test';

test('las tropas salen de una ciudad amurallada y alcanzan la ciudad enemiga sin moverlas manualmente', async ({ page }, testInfo) => {
  await page.route('**/war-march', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/war-march');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const { populateMatureWorld } = await import('/tests/fixtures/mature-world.js');
    let seed = 4421;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const render = new RenderSystem(document.querySelector('canvas'));
    const session = new GameSession({ scene: render.scene, size: 132, laws: { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: true, rebellions: false, naturalDisasters: false } });
    const { empires } = populateMatureWorld(session, 240);
    session.settlements.declareWar(empires[0], empires[1]);
    // This test is specifically about the autonomous march/engagement, not about how long a war
    // randomly lasts before diplomacy makes peace (updateDiplomacy() rolls a peace chance every
    // DIPLO_INTERVAL regardless of march progress) - keep the war going for the duration of this
    // test so an early, otherwise-legitimate peace roll can't demobilize the army before it
    // arrives. Peace/diplomacy timing itself is exercised elsewhere (pause-menu/siege specs).
    session.settlements.makePeace = () => false;
    session.settlements.raiseSoldiers(empires[0], empires[1]);
    session.civilization._syncArmies(0);
    const army = session.civilization.armies.get(empires[0].id);
    const ids = [...army.soldierIds];
    const target = session.settlements.settlements.find(s => s.id === army.targetSettlementId);
    let minimumDistance = Infinity, engaged = false, elapsed = 0;
    for (let i = 0; i < 3600; i++) {
      session.runtime.update(1 / 30, 1); elapsed += 1 / 30;
      for (const id of ids) {
        const c = session.creatures.creatureById.get(id);
        if (!c?.alive) continue;
        minimumDistance = Math.min(minimumDistance, Math.hypot(c.x - target.x, c.z - target.z));
        if (c.combatTarget != null) engaged = true;
      }
      if (minimumDistance < 15 && engaged) break;
    }
    session.dispose();
    return { soldiers: ids.length, minimumDistance, engaged, elapsed };
  });
  await testInfo.attach('autonomous-march.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.soldiers).toBeGreaterThanOrEqual(2);
  expect(result.minimumDistance).toBeLessThan(15);
  expect(result.engaged).toBe(true);
});

test('ciudades maduras: asedio, carga de brecha, conquista, paz y reparación', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/war-journey', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/war-journey');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const { populateMatureWorld } = await import('/tests/fixtures/mature-world.js');
    const { SaveRepository, SAVE_FORMAT_VERSION } = await import('/js/save-system.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    const laws = { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: true, rebellions: false, naturalDisasters: false };
    let session = new GameSession({ scene: render.scene, size: 132, laws });
    const { cities, empires } = populateMatureWorld(session, 240);
    const targetId = cities[1].id, attackerId = empires[0].id, defenderId = empires[1].id;
    const keys = ['world', 'creatures', 'settlements', 'ships', 'civilization', 'cataclysms'];
    const repository = new SaveRepository(localStorage);
    const reload = () => {
      repository.save({ version: SAVE_FORMAT_VERSION, schema: { version: SAVE_FORMAT_VERSION }, ...Object.fromEntries(keys.map(key => [key, session[key].serialize()])) });
      const saved = repository.load(); session.dispose();
      session = new GameSession({ scene: render.scene, size: 132, laws });
      for (const key of keys) session[key].restore(saved[key]);
      session.statuses.syncFromCreatures();
    };
    reload();
    const empire = id => session.settlements.empires.find(e => e.id === id);
    const target = () => session.settlements.settlements.find(s => s.id === targetId);
    const declared = session.settlements.declareWar(empire(attackerId), empire(defenderId));
    session.settlements.raiseSoldiers(empire(attackerId), empire(defenderId));
    session.civilization._syncArmies(0);
    const army = session.civilization.armies.get(attackerId);
    army.targetSettlementId = targetId;
    // Control troop arrival and civilian evacuation to isolate siege/persistence.
    // Autonomous travel and battle outcomes are a separate acceptance scenario.
    for (const c of session.creatures.creatures) {
      if (c.empireId === defenderId) { c.x = 24; c.z = 24; }
      if (army.soldierIds.includes(c.id)) { c.x = target().x; c.z = target().z; }
    }
    session.civilization._updateSieges(60);
    const breachOwner = target().empireId;
    reload();
    const breachedAfterLoad = !session.settlements.walls.has(targetId) && target().wallsBreached;
    session.civilization._updateSieges(60);
    const conquered = target().empireId === attackerId;
    const residentsTransferred = session.creatures.creatures.filter(c => c.settlementId === targetId).every(c => c.empireId === attackerId);
    reload();
    const peace = session.settlements.makePeace(empire(attackerId), empire(defenderId));
    // Exercise normal economy ticks for reconstruction, with all other systems active.
    target().resources.wood = 150; target().resources.stone = 150;
    for (let i = 0; i < 1860; i++) session.runtime.update(1 / 30, 1);
    const repaired = session.settlements.walls.has(targetId) && !target().wallsBreached;
    reload();
    const validResources = session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0));
    render.camera.position.set(80, 110, 90); render.camera.lookAt(0, 7, 0); render.render();
    window.warJourney = { session, render };
    return { declared, breachOwner, defenderId, breachedAfterLoad, conquered, residentsTransferred, peace, repaired, validResources,
      restoredOwner: target().empireId, attackerId, cities: session.settlements.settlements.length };
  });
  expect(result).toMatchObject({ declared: true, breachedAfterLoad: true, conquered: true, residentsTransferred: true, peace: true, repaired: true, validResources: true, cities: 4 });
  expect(result.breachOwner).toBe(result.defenderId);
  expect(result.restoredOwner).toBe(result.attackerId);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.warJourney.render.render());
  await page.screenshot({ path: testInfo.outputPath('war-journey.png') });
  expect(errors).toEqual([]);
});
