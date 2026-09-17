import { expect, test } from '@playwright/test';

test('muralla continua, orientada y actualizada tras cargar los modelos reales', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/wall-preview', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
  await page.goto('/wall-preview');
  await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({ quality: 'ultra', ambientOcclusionResolution: 0.5 });
    const session = new GameSession({ scene: render.scene, size: 64, laws: {} });
    const { world, settlements } = session;
    world.height.fill(7); world.biome.fill(2); world.moisture.fill(.5); world.jitter.fill(1); world.temperature.fill(18);
    world.buildTerrainMesh();
    const empire = settlements.createEmpire();
    const city = { id: 1, x: 0, z: 0, level: 3, pop: 60, empireId: empire.id, race: 'human', name: 'Muralla de referencia', houses: [], farms: [], resources: { wood: 100, food: 100, stone: 100 } };
    settlements.settlements.push(city);
    for (const [x, z] of [[0,0], [3,3], [-3,2], [2,-4]]) {
      const house = { slot: settlements.allocHouseSlot(), x, z, variant: 0, scaleMul: 1, rotationY: 0 };
      city.houses.push(house); settlements._syncHouseInstance(city, house, true);
    }
    settlements.addWall(city); settlements.addTower(city);
    render.camera.position.set(24, 36, 32); render.camera.lookAt(0, 7, 0);
    window.wallPreview = { render, session, city };
  });
  // Capture the historical failure too, even if the following acceptance checks reject it.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.wallPreview.render.render());
  await page.screenshot({ path: testInfo.outputPath('city-walls.png') });
  // Segments/gates now live in two shared InstancedMesh pools (js/settlements.js) instead of one
  // THREE.Mesh per segment — real model loaded is checked on those two shared geometries, not per
  // child, and a rebuild reusing the same (already-loaded) geometry is what the "rebuilt" check
  // below now trivially guarantees, since there's only ever one geometry object per piece type.
  await expect.poll(() => page.evaluate(() => {
    const { session } = window.wallPreview;
    const { wallSegmentMesh, wallGateMesh } = session.settlements;
    return wallSegmentMesh.geometry.attributes.position.count > 100 && wallGateMesh.geometry.attributes.position.count > 100;
  }), { timeout: 10000 }).toBe(true);
  const result = await page.evaluate(() => {
    const { session, city, render } = window.wallPreview;
    const wall = session.settlements.walls.get(city.id);
    const segGeometryId = session.settlements.wallSegmentMesh.geometry.uuid;
    const gateGeometryId = session.settlements.wallGateMesh.geometry.uuid;
    const errors = wall.children.map(s => {
      return Math.min(Math.abs(Math.cos(s.rotation.y)), Math.abs(Math.sin(s.rotation.y)));
    });
    session.settlements.wallSegmentMesh.geometry.computeBoundingBox();
    session.settlements.wallGateMesh.geometry.computeBoundingBox();
    const widthOf = child => {
      const geometry = child.isGate ? session.settlements.wallGateMesh.geometry : session.settlements.wallSegmentMesh.geometry;
      return geometry.boundingBox.max.x - geometry.boundingBox.min.x;
    };
    const sorted = wall.children; // contour order, including concave corners
    const gaps = sorted.map((a, i) => {
      const b = sorted[(i + 1) % sorted.length];
      return a.position.distanceTo(b.position) - (widthOf(a) * a.scale.x + widthOf(b) * b.scale.x) / 2;
    });
    session.settlements._ensureNavigationObstacles();
    const gates = wall.children.filter(s => s.userData.isGate);
    const obstacles = session.settlements._navigationObstacles.filter(o => o.kind === 'wall');
    session.settlements.removeWall(city); session.settlements.addWall(city);
    const rebuilt = session.settlements.walls.get(city.id);
    render.render();
    return { maxRadial: Math.max(...errors), maxGap: Math.max(...gaps), gates: gates.length,
      obstacles: obstacles.length, segments: wall.children.length,
      rebuilt: session.settlements.wallSegmentMesh.geometry.uuid === segGeometryId &&
        session.settlements.wallGateMesh.geometry.uuid === gateGeometryId &&
        rebuilt.children.length > 0 };
  });
  expect(result.maxRadial).toBeLessThan(1e-6);
  expect(result.maxGap).toBeLessThanOrEqual(0.05);
  expect(result.gates).toBe(4);
  expect(result.obstacles).toBe(result.segments - result.gates);
  expect(result.rebuilt).toBe(true);
  const restored = await page.evaluate(async () => {
    const { GameSession } = await import('/js/game-session.js');
    const { SaveRepository, SAVE_FORMAT_VERSION } = await import('/js/save-system.js');
    const { render, session, city } = window.wallPreview;
    // El nivel 3 requiere catorce casas reales también después de validar el guardado.
    for (let i = city.houses.length; i < 14; i++) city.houses.push({ x: (i % 4 - 1.5) * 2.2, z: (Math.floor(i / 4) - 1.5) * 2.2, variant: 0, scaleMul: 1 });
    const keys = ['world', 'creatures', 'settlements', 'ships', 'civilization', 'cataclysms'];
    const repository = new SaveRepository(localStorage);
    repository.save({ version: SAVE_FORMAT_VERSION, schema: { version: SAVE_FORMAT_VERSION }, ...Object.fromEntries(keys.map(key => [key, session[key].serialize()])) });
    const saved = repository.load();
    session.dispose();
    const loaded = new GameSession({ scene: render.scene, size: 64, laws: {} });
    for (const key of keys) loaded[key].restore(saved[key]);
    loaded.statuses.syncFromCreatures();
    const wall = loaded.settlements.walls.get(city.id);
    render.render();
    const values = wall.children.map(s => Math.min(Math.abs(Math.cos(s.rotation.y)), Math.abs(Math.sin(s.rotation.y))));
    return { level: loaded.settlements.settlements[0].level, gates: wall.children.filter(s => s.userData.isGate).length,
      loadedModels: loaded.settlements.wallSegmentMesh.geometry.attributes.position.count > 100 &&
        loaded.settlements.wallGateMesh.geometry.attributes.position.count > 100,
      maxRadial: Math.max(...values) };
  });
  expect(restored).toMatchObject({ level: 3, gates: 4, loadedModels: true });
  expect(restored.maxRadial).toBeLessThan(1e-6);
  await page.screenshot({ path: testInfo.outputPath('city-walls-restored.png') });
  expect(errors).toEqual([]);
});
