import { test, expect } from '@playwright/test';

// Fase B/C, "Desastres y cambios de terreno en vivo": no test ran any disaster during an active,
// populated, autonomously-ticking city (nothing structurally like war-journey.spec.js or
// economy-transport.spec.js existed for this). tests/unit/phase6-7.test.js already covers
// detonate()/earthquake() call arguments against a fully mocked world — this test instead runs
// them for real, live, through runtime.update() ticks against a real terrain/settlement/creature
// state, plus covers three things that had zero coverage anywhere: _naturalDisaster()'s three
// random branches, the naturalDisasters law gate itself, and vfx.js's tornado/acid rain (only
// ever smoke-tested as "the power exists in the UI catalog", never its actual damage/movement).
test('desastres y cambios de terreno en vivo: terremoto, bomba, meteorito, tornado, lluvia ácida y desastre natural', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/disaster-journey', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/disaster-journey');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const { populateMatureWorld } = await import('/tests/fixtures/mature-world.js');
    const { createVfxSystem } = await import('/js/vfx.js');
    const { SaveRepository, SAVE_FORMAT_VERSION } = await import('/js/save-system.js');
    let seed = 4242;
    const seededRandom = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    Math.random = seededRandom;
    const render = new RenderSystem(document.querySelector('canvas'));
    const laws = { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: false, rebellions: false, naturalDisasters: true };
    let session = new GameSession({ scene: render.scene, size: 132, laws });
    const { cities } = populateMatureWorld(session, 240);
    const vfx = createVfxSystem(render.scene);
    vfx.setSimContext({ world: session.world, creatures: session.creatures, settlements: session.settlements });

    const allFinite = () =>
      session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0)) &&
      session.creatures.creatures.every(c => Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.health));
    let corruptAt = null;
    const tick = label => { session.runtime.update(1 / 30, 1); if (!corruptAt && !allFinite()) corruptAt = label; };

    const revisionBefore = session.world.navigationRevision;
    const [cityA, cityB, cityC] = cities;
    const housesBefore = cityA.houses.length;

    // --- Terremoto cerca de una ciudad activa: deforma terreno, daña sin destruirla del todo. ---
    session.cataclysms.earthquake(cityA.x, cityA.z, 10, 1.2);
    for (let i = 0; i < 90; i++) tick('terremoto');
    const housesAfterEarthquake = cityA.houses.length;
    const settlementsAfterEarthquake = session.settlements.settlements.length;

    // --- Bomba (detonate): cráter real, +daño de área, sin acabar de derribar la ciudad. ---
    session.cataclysms.detonate(cityA.x + 3, cityA.z, { radius: 3, damageRadius: 4, craterDepth: -3 });
    for (let i = 0; i < 90; i++) tick('detonación');
    const housesAfterBomb = cityA.houses.length;

    // --- Meteorito: impacto directo de world.js, fuera de CataclysmSystem. ---
    const [mgx, mgz] = session.world.worldToGrid(cityA.x - 6, cityA.z);
    session.world.meteorImpact(mgx, mgz, 1.5);
    session.creatures.killAllInRadius(cityA.x - 6, cityA.z, 2.4);
    for (let i = 0; i < 90; i++) tick('meteorito');

    // --- Detonación final, radio grande: derriba lo que queda de la ciudad A por completo. ---
    session.cataclysms.detonate(cityA.x, cityA.z, { radius: 12, damageRadius: 14, craterDepth: -3 });
    for (let i = 0; i < 30; i++) tick('detonación final');
    const settlementsAfterWipe = session.settlements.settlements.length;
    const cityAStillListed = session.settlements.settlements.some(s => s.id === cityA.id);

    const revisionAfterTerrain = session.world.navigationRevision;

    // --- Tornado (vfx.js, sin cobertura previa de daño real): daña criaturas y puede tumbar casas. ---
    const tornadoTargetHousesBefore = cityB.houses.length;
    vfx.spawnTornado(cityB.x, cityB.z);
    for (let i = 0; i < 240; i++) { tick('tornado'); vfx.updateTornadoes(1 / 30); }
    const tornadoTargetHousesAfter = cityB.houses.length;

    // --- Lluvia ácida (vfx.js, sin cobertura previa de daño real): efecto instantáneo de área. ---
    const acidTargets = session.creatures.creatures.filter(c => c.alive && Math.hypot(c.x - cityC.x, c.z - cityC.z) < 6);
    const acidHealthBefore = acidTargets.map(c => c.health);
    vfx.applyAcidRain(cityC.x, cityC.z, 6);
    const acidHealthAfter = acidTargets.map(c => c.health);
    const acidDamageApplied = acidTargets.length > 0 && acidTargets.every((c, i) => c.health < acidHealthBefore[i] || acidHealthBefore[i] <= 0);

    // --- _naturalDisaster(): sus 3 ramas nunca se habían ejecutado en ninguna prueba. Se fuerza
    // cada una con un Math.random() fijo (restaurado después) en vez de confiar en el azar. ---
    const heightBeforeNatural = session.world.height.slice();
    let naturalDisastersRanCleanly = true;
    const forceBranch = value => {
      Math.random = () => value;
      try { session.cataclysms._naturalDisaster(); } catch { naturalDisastersRanCleanly = false; }
      Math.random = seededRandom;
    };
    forceBranch(0.1); // terremoto
    const terrainChangedAfterEarthquakeBranch = !session.world.height.every((h, i) => h === heightBeforeNatural[i]);
    forceBranch(0.5); // incendio natural
    forceBranch(0.9); // meteorito

    // --- Ley "naturalDisasters": el disparador automático debe respetar el interruptor. ---
    session.cataclysms.laws.naturalDisasters = false;
    session.cataclysms.disasterTimer = 0.001;
    session.cataclysms.update(1 / 30);
    const timerFrozenWhenLawOff = session.cataclysms.disasterTimer < 1; // no se reinició a 100-240
    session.cataclysms.laws.naturalDisasters = true;
    session.cataclysms.update(1 / 30);
    const timerResetWhenLawOn = session.cataclysms.disasterTimer > 50; // sí se reinició

    // --- Persistencia a mitad de desastre: una mina armada y el temporizador a mitad de cuenta
    // deben sobrevivir a guardar/recargar sin perderse ni duplicarse. ---
    session.cataclysms.placeMine(cityB.x + 2, cityB.z, 2);
    const minesBeforeReload = session.cataclysms.mines.length;
    const timerBeforeReload = session.cataclysms.disasterTimer;
    const keys = ['world', 'creatures', 'settlements', 'ships', 'civilization', 'cataclysms'];
    const repository = new SaveRepository(localStorage);
    repository.save({ version: SAVE_FORMAT_VERSION, schema: { version: SAVE_FORMAT_VERSION }, ...Object.fromEntries(keys.map(key => [key, session[key].serialize()])) });
    const saved = repository.load();
    session.dispose();
    session = new GameSession({ scene: render.scene, size: 132, laws });
    for (const key of keys) session[key].restore(saved[key]);
    const minesAfterReload = session.cataclysms.mines.length;
    const timerAfterReload = session.cataclysms.disasterTimer;
    const resourcesValidAfterReload = session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0));

    return {
      corruptAt,
      housesBefore, housesAfterEarthquake, housesAfterBomb,
      settlementsAfterEarthquake, settlementsAfterWipe, cityAStillListed,
      revisionBefore, revisionAfterTerrain,
      tornadoTargetHousesBefore, tornadoTargetHousesAfter,
      acidTargetsCount: acidTargets.length, acidDamageApplied,
      terrainChangedAfterEarthquakeBranch, naturalDisastersRanCleanly,
      timerFrozenWhenLawOff, timerResetWhenLawOn,
      minesBeforeReload, minesAfterReload, timerBeforeReload, timerAfterReload, resourcesValidAfterReload,
    };
  });
  await testInfo.attach('disaster-journey.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.corruptAt).toBeNull();
  expect(result.revisionAfterTerrain).toBeGreaterThan(result.revisionBefore);
  expect(result.housesAfterEarthquake).toBeLessThanOrEqual(result.housesBefore);
  expect(result.settlementsAfterEarthquake).toBe(4); // dañada, no destruida por el terremoto moderado
  expect(result.settlementsAfterWipe).toBe(3); // la detonación final sí la derriba por completo
  expect(result.cityAStillListed).toBe(false);
  expect(result.tornadoTargetHousesAfter).toBeLessThanOrEqual(result.tornadoTargetHousesBefore);
  expect(result.acidTargetsCount).toBeGreaterThan(0);
  expect(result.acidDamageApplied).toBe(true);
  expect(result.terrainChangedAfterEarthquakeBranch).toBe(true);
  expect(result.naturalDisastersRanCleanly).toBe(true);
  expect(result.timerFrozenWhenLawOff).toBe(true);
  expect(result.timerResetWhenLawOn).toBe(true);
  expect(result.minesAfterReload).toBe(result.minesBeforeReload);
  expect(result.timerAfterReload).toBeCloseTo(result.timerBeforeReload, 3);
  expect(result.resourcesValidAfterReload).toBe(true);
  expect(errors).toEqual([]);
});
