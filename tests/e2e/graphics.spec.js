import { expect, test } from '@playwright/test';

test('Ultra, local models, proportions and coastal shaders render correctly', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/graphics-preview', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas id="view"></canvas></body>' }));
  await page.goto('/graphics-preview');
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { World } = await import('/js/world.js');
    const { RenderSystem } = await import('/js/render-system.js');
    const { CameraRig } = await import('/js/camera.js');
    const { DayNightCycle } = await import('/js/daynight.js');
    const { preloadCreatureModels } = await import('/js/models.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    const world = new World(render.scene, { size: 64 });
    world.setGraphics({ quality: 'ultra' });
    world.generate({ seed: 12345, mapType: 'island', climate: 'templado', mountainLevel: 1 });
    preloadCreatureModels();
    const rig = new CameraRig(render.camera, render.renderer.domElement, new THREE.Vector3());
    const day = new DayNightCycle({ fog: render.fog, sun: render.sun, hemi: render.hemi, rig, renderSystem: render, dayCounterEl: {} });
    day.lockDay = true;
    window.graphicsPreview = { THREE, render, world, rig, day };
  });
  await expect.poll(() => page.evaluate(() => {
    const { world } = window.graphicsPreview;
    return Object.values(world.treeMeshes).every(set => set.asset);
  })).toBe(true);
  const dimensions = await page.evaluate(async () => {
    const { world, THREE, render, rig } = window.graphicsPreview;
    const { buildCreatureModel } = await import('/js/models.js');
    const { loadEnvironmentMesh } = await import('/js/environment-assets.js');
    const index = [...world.treeSlots.keys()].find(i => world.height[i] > 6.5 && world.height[i] < 9);
    const [x, z] = world.gridToWorld(index % world.verts, Math.floor(index / world.verts));
    rig.target.set(x, world.height[index] + 0.7, z);
    rig.distance = 23; rig.polar = 0.82; rig.azimuth = 0.4;
    const human = buildCreatureModel('human', 'm'); human.root.scale.setScalar(0.44);
    human.root.position.set(x + 1.5, world.heightAtWorld(x + 1.5, z), z);
    render.scene.add(human.root);
    const animal = buildCreatureModel('herbivore'); animal.root.scale.setScalar(0.4);
    animal.root.position.set(x - 1, world.heightAtWorld(x - 1, z), z);
    render.scene.add(animal.root);
    const model = await loadEnvironmentMesh('./assets/packs/village-props/Separate_assets_glb/house_001.glb', 1.65);
    const house = new THREE.Mesh(model.geometry, model.material); house.castShadow = house.receiveShadow = true;
    house.position.set(x + 3, world.heightAtWorld(x + 3, z), z); render.scene.add(house);
    world.grassMesh.geometry.computeBoundingBox();
    const grassHeight = world.grassMesh.geometry.boundingBox.max.y;
    return { grassHeight, humanHeight: new THREE.Box3().setFromObject(human.root).getSize(new THREE.Vector3()).y, treeHeight: world.treeMeshes.round.trunk.geometry.boundingBox.max.y };
  });
  // Grass is procedurally built now (botanical-geometry.js's createGrassGeometry), not loaded
  // from a GLB model — the exact blade height is an implementation detail; what matters for
  // this test is that it reads as short grass, well under human/tree scale.
  expect(dimensions.grassHeight).toBeGreaterThan(0.05);
  expect(dimensions.grassHeight).toBeLessThan(0.2);
  expect(dimensions.humanHeight).toBeGreaterThan(dimensions.grassHeight * 4);
  expect(dimensions.treeHeight).toBeGreaterThan(dimensions.humanHeight * 4);
  for (const quality of ['low', 'medium', 'high', 'ultra']) {
    await page.evaluate(quality => {
      const { render, world, rig, day } = window.graphicsPreview;
      render.setGraphics({ quality }); world.setGraphics({ quality });
      world._waterTimeUniform.value = 4;
      rig.update(0); day.update(); render.render();
    }, quality);
    await page.screenshot({ path: testInfo.outputPath(`landscape-${quality}.png`) });
  }
  for (const resolution of [1, 0.5]) {
    const dimensions = await page.evaluate(resolution => {
      const { render, world, rig, day } = window.graphicsPreview;
      render.setGraphics({ quality: 'ultra', ambientOcclusionResolution: resolution });
      world._waterTimeUniform.value = 4;
      rig.update(0); day.update(); render.render();
      return { width: render.aoPass.width, height: render.aoPass.height, expectedWidth: Math.round(innerWidth * render.renderer.getPixelRatio() * resolution), expectedHeight: Math.round(innerHeight * render.renderer.getPixelRatio() * resolution) };
    }, resolution);
    expect(dimensions.width).toBe(dimensions.expectedWidth);
    expect(dimensions.height).toBe(dimensions.expectedHeight);
    await page.screenshot({ path: testInfo.outputPath(`contact-shadows-${resolution}.png`) });
  }
  await page.evaluate(() => {
    const { render, world, rig, day } = window.graphicsPreview;
    rig.target.set(0, 5, 0); rig.distance = 80; rig.polar = 1.05;
    rig.update(0); day.update(); render.render();
  });
  await page.screenshot({ path: testInfo.outputPath('ultra-island.png') });
  await page.evaluate(() => {
    const { render, world, rig, day } = window.graphicsPreview;
    let shore;
    for (let z = 8; z < world.size - 8 && !shore; z++) for (let x = 8; x < world.size - 8 && !shore; x++) {
      const h = world.height[world.idx(x, z)];
      if (h > 4.8 && h < 5.1) shore = world.gridToWorld(x, z);
    }
    const [x, z] = shore || [20, 20];
    rig.target.set(x, 5, z); rig.distance = 16; rig.polar = 0.75; rig.azimuth = Math.atan2(x, z);
    rig.update(0); day.update(); render.render();
  });
  await page.screenshot({ path: testInfo.outputPath('ultra-coast.png') });
  expect(errors).toEqual([]);
});

test('graphics controls persist independently and Ultra works on the actual game', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await page.locator('#btnOptionsMenu').click();
  await page.locator('#qualitySetting').selectOption('ultra');
  await page.locator('#waterSetting').selectOption('waves');
  await page.locator('#vegetationSetting').selectOption('normal');
  await page.locator('#ambientOcclusionResolutionSetting').selectOption('1');
  await page.reload();
  await page.locator('#btnOptionsMenu').click();
  await expect(page.locator('#qualitySetting')).toHaveValue('ultra');
  await expect(page.locator('#waterSetting')).toHaveValue('waves');
  await expect(page.locator('#vegetationSetting')).toHaveValue('normal');
  await expect(page.locator('#ambientOcclusionResolutionSetting')).toHaveValue('1');
  await page.screenshot({ path: testInfo.outputPath('graphics-settings.png') });
  await page.locator('#closeSettingsBtn').click();
  await page.getByRole('button', { name: '✦ Crear nuevo mundo' }).click();
  await page.locator('#sizeGrid [data-value="132"]').click();
  await page.getByRole('button', { name: /Generar y jugar/ }).click();
  await expect(page.locator('#mapCreator')).toHaveClass(/hidden/);
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
