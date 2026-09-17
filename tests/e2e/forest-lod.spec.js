import { test, expect } from '@playwright/test';

test('conserva árboles al cambiar detalle, cámara, bioma y guardado', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/forest-lod', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
  await page.goto('/forest-lod');
  await page.evaluate(async () => {
    const { World } = await import('/js/world.js');
    const { RenderSystem } = await import('/js/render-system.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({ quality: 'high', dynamicResolution: false });
    render.sun.position.set(40, 80, 40); render.fog.near = 150; render.fog.far = 600;
    const world = new World(render.scene, { size: 96 });
    world.generate({ seed: 12345, mapType: 'archipelago', mountainLevel: 1 });
    window.forestLod = { world, render };
  });
  await expect.poll(() => page.evaluate(() => Object.values(window.forestLod.world.treeMeshes).every(s => s.asset && s.lods?.length === 2))).toBe(true);
  const far = await page.evaluate(() => {
    const { world, render } = window.forestLod;
    render.camera.position.set(0, 190, 200); render.camera.lookAt(0, 5, 0);
    world.updateVisuals(.3, render.camera); render.render();
    const triCount = geometry => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
    return { stats: world.treeRenderer.stats, count: world.treeSlots.size, triangles: render.renderer.info.render.triangles,
      originalTriangles: [...world.treeSlots.values()].reduce((n, rec) => n + triCount(world.treeMeshes[rec.kind].trunk.geometry), 0) };
  });
  expect(far.stats.full + far.stats.medium + far.stats.far).toBe(far.count);
  expect(far.stats.triangles).toBeLessThan(far.originalTriangles * .4);
  await page.screenshot({ path: testInfo.outputPath('forest-far.png') });
  const near = await page.evaluate(() => {
    const { world, render } = window.forestLod;
    const cell = [...world.treeSlots.keys()].find(i => world.height[i] > 7);
    const [x, z] = world.gridToWorld(cell % world.verts, Math.floor(cell / world.verts));
    render.camera.position.set(x + 12, 17, z + 14); render.camera.lookAt(x, world.height[cell] + 1, z);
    world.updateVisuals(.3, render.camera);
    window.forestLod.colorTrees = 0;
    for (const mesh of world.treeRenderer.group.children) mesh.onBeforeRender = (renderer, scene, camera) => {
      if (camera === render.camera) window.forestLod.colorTrees += mesh.count;
    };
    render.render();
    return { full: world.treeRenderer.stats.full, count: world.treeSlots.size, colorTrees: window.forestLod.colorTrees };
  });
  expect(near.full).toBeGreaterThan(0); expect(near.count).toBe(far.count);
  await page.screenshot({ path: testInfo.outputPath('forest-near.png') });
  const away = await page.evaluate(() => {
    const { world, render } = window.forestLod;
    render.camera.position.set(0, 190, 200);
    render.camera.lookAt(render.camera.position.x, 300, render.camera.position.z + 300);
    window.forestLod.colorTrees = 0;
    world.updateVisuals(.3, render.camera); render.render();
    return window.forestLod.colorTrees;
  });
  expect(away).toBeLessThan(near.colorTrees);
  await page.evaluate(() => {
    const { world } = window.forestLod;
    const cells = [...world.treeSlots.keys()].slice(0, 30);
    for (const cell of cells.slice(0, 20)) world.removeTree(cell % world.verts, Math.floor(cell / world.verts));
    for (const cell of cells.slice(20)) {
      world.biome[cell] = 8; world.temperature[cell] = -10;
      world.refreshTreeKind(cell % world.verts, Math.floor(cell / world.verts));
    }
    const saved = world.serialize(); window.forestLod.saved = saved;
    world.restore(saved);
  });
  await expect.poll(() => page.evaluate(() => Object.values(window.forestLod.world.treeMeshes).every(s => s.asset && s.lods?.length === 2))).toBe(true);
  const restored = await page.evaluate(() => {
    const { world, render, saved } = window.forestLod;
    render.camera.position.set(0, 130, 150); render.camera.lookAt(0, 5, 0);
    world.updateVisuals(.3, render.camera); render.render();
    const appearance = entries => JSON.stringify(entries.sort((a, b) => a[0] - b[0]));
    return { count: world.treeSlots.size, active: world.treeRenderer.stats.active,
      appearance: appearance(world.serialize().treeVisuals) === appearance(saved.treeVisuals) };
  });
  expect(restored).toEqual({ count: far.count - 20, active: far.count - 20, appearance: true });
  expect(errors).toEqual([]);
});
