import { expect, test } from '@playwright/test';

test('ciudad con parcelas, calles y detalles conserva su trazado al guardar', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/city-grid-preview', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
  await page.goto('/city-grid-preview');
  await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    const session = new GameSession({ scene: render.scene, size: 64, laws: {} });
    const { world, settlements } = session;
    world.height.fill(7); world.biome.fill(2); world.moisture.fill(.5); world.jitter.fill(1); world.temperature.fill(18);
    world.buildTerrainMesh();
    const empire = settlements.createEmpire();
    const city = { id: 1, x: 0, z: 0, level: 3, pop: 120, empireId: empire.id, race: 'human', name: 'Nueva ciudad', houses: [], farms: [], resources: { wood: 100, food: 100, stone: 100 } };
    settlements.settlements.push(city);
    settlements._prepareSettlementGround(city, 3);
    for (let i = 0; i < 24; i++) settlements.addHouse(city);
    settlements.addFarm(city); settlements.addFarm(city);
    settlements.addWall(city); settlements.addTower(city);
    settlements._flushHousePaths();
    render.camera.position.set(23, 35, 28); render.camera.lookAt(0, 7, 0);
    window.cityPreview = { render, session, city };
  });
  await expect.poll(() => page.evaluate(() => window.cityPreview.session.settlements.houseMeshes[0].geometry.attributes.position.count)).toBeGreaterThan(100);
  await page.evaluate(() => window.cityPreview.render.render());
  await page.screenshot({ path: testInfo.outputPath('city-grid.png') });
  const result = await page.evaluate(() => {
    const { session, city } = window.cityPreview;
    const saved = session.settlements.serialize().settlements[0];
    return { houses: city.houses.length, farms: city.farms.length, saved: saved.houses.every(h => h.gridPlot), farmSaved: saved.farms.every(f => f.gridPlot),
      details: session.settlements.cityDetailMesh.geometry.attributes.position.count,
      rotations: city.houses.every(h => h.rotationY === 0 || h.rotationY === Math.PI) };
  });
  expect(result.houses).toBe(24);
  expect(result.farms).toBe(2);
  expect(result.saved && result.farmSaved && result.rotations).toBe(true);
  expect(result.details).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});
