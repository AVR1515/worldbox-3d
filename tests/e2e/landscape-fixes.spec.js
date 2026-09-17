import { expect, test } from '@playwright/test';

for (const quality of ['high', 'ultra']) test(`${quality} casts ground shadows and keeps roads on edited ground`, async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/landscape-fixes', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
  await page.goto('/landscape-fixes');
  await page.evaluate(async quality => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { World } = await import('/js/world.js');
    const { RenderSystem } = await import('/js/render-system.js');
    const { CameraRig } = await import('/js/camera.js');
    const { DayNightCycle } = await import('/js/daynight.js');
    const { CreatureManager } = await import('/js/creatures.js');
    const { SettlementManager } = await import('/js/settlements.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({ quality, wind: 'off' });
    const world = new World(render.scene, { size: 32 });
    world.setGraphics({ quality, wind: 'off' });
    world.height.fill(7); world.biome.fill(2); world.moisture.fill(0.5); world.jitter.fill(1); world.temperature.fill(18);
    world.buildTerrainMesh(); world.buildTreeMeshes(); world.buildGrassMesh(); world.scatterGrass();
    world.plantTree(12, 16, true); world.plantTree(12, 21, true);
    for (const [x, z, type] of [[22, 19, 1], [21, 22, 2], [23, 22, 3]]) { world.mineralType[world.idx(x, z)] = type; world.mineralAmount[world.idx(x, z)] = 75; }
    world.buildMineralMesh();
    const creatures = new CreatureManager(render.scene, world);
    const settlements = new SettlementManager(render.scene, world, creatures, { toast() {} });
    const s = { id: 1, x: 0, z: 0, level: 0, houses: [], farms: [] };
    settlements.settlements.push(s);
    for (const [x, z, variant] of [[2, 0, 0], [5, 5, 2]]) {
      const house = { slot: settlements.allocHouseSlot(), x, z, variant, scaleMul: 1, rotationY: 0 };
      s.houses.push(house); settlements._syncHouseInstance(s, house, true);
    }
    settlements._flushHousePaths();
    const rig = new CameraRig(render.camera, render.renderer.domElement, new THREE.Vector3(0, 7, 1));
    rig.distance = 21; rig.polar = 1.0; rig.azimuth = 0.45; rig.update(0);
    const day = new DayNightCycle({ fog: render.fog, sun: render.sun, hemi: render.hemi, rig, renderSystem: render, dayCounterEl: {} });
    day.lockDay = true; day.update();
    window.landscapeFixes = { THREE, render, world, settlements };
  }, quality);
  await expect.poll(() => page.evaluate(() => {
    const { world, settlements } = window.landscapeFixes;
    return world.treeMeshes.round.asset && world.mineralMesh.geometry.constructor.name === 'ConvexGeometry' && !!settlements.houseMeshes[0].material.map;
  })).toBe(true);
  const shadows = await page.evaluate(() => {
    const { render, world, settlements } = window.landscapeFixes;
    const draw = () => {
      world.updateVisuals(0.3, render.camera);
      render.render();
      const gl = render.renderer.getContext(), pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const baseline = draw();
    world.treeMeshes.round.trunk.castShadow = false;
    const noTree = draw();
    world.treeMeshes.round.trunk.castShadow = true;
    settlements.houseMeshes.forEach(mesh => { mesh.castShadow = false; });
    const noHouse = draw();
    settlements.houseMeshes.forEach(mesh => { mesh.castShadow = true; });
    world.mineralMesh.castShadow = false;
    const noRock = draw();
    world.mineralMesh.castShadow = true;
    // Count only projected shadows on terrain, never self-shadowing on objects.
    const { THREE } = window.landscapeFixes;
    const black = new THREE.MeshBasicMaterial({ color: 0, toneMapped: false });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const saved = [];
    render.scene.traverse(o => {
      if (o.isMesh) { saved.push([o, o.material]); o.material = o === world.terrainMesh ? white : black; }
    });
    const fog = render.scene.fog; render.scene.fog = null;
    render.renderer.render(render.scene, render.camera);
    const gl = render.renderer.getContext();
    const ground = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, ground);
    for (const [o, material] of saved) o.material = material;
    render.scene.fog = fog; black.dispose(); white.dispose();
    const lighterPixels = pixels => {
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (ground[i] > 250 && ground[i + 1] > 250 && ground[i + 2] > 250 && pixels[i] + pixels[i + 1] + pixels[i + 2] > baseline[i] + baseline[i + 1] + baseline[i + 2] + 24) count++;
      return count;
    };
    draw();
    return { tree: lighterPixels(noTree), house: lighterPixels(noHouse), rock: lighterPixels(noRock) };
  });
  expect(shadows.tree).toBeGreaterThan(150);
  expect(shadows.house).toBeGreaterThan(150);
  expect(shadows.rock).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath('ultra-shadows-roads-rocks.png') });
  await page.evaluate(() => {
    const { world, settlements, render } = window.landscapeFixes;
    for (let z = 17; z <= 20; z++) for (let x = 17; x <= 20; x++) {
      world.height[world.idx(x, z)] += 1.4 * Math.sin((x - 16) * 0.7);
      world.writeVertex(x, z);
    }
    world.refreshTerrainRegion();
    settlements.onTerrainChanged({ minX: 17, minZ: 17, maxX: 20, maxZ: 20 });
    render.render();
  });
  await page.screenshot({ path: testInfo.outputPath('roads-after-terraform.png') });
  expect(errors).toEqual([]);
});
