import { expect, test } from '@playwright/test';

test('el océano oculta el borde del mapa y continúa hasta el horizonte', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/ocean-preview', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0"><canvas id="view"></canvas></body></html>',
  }));
  await page.goto('/ocean-preview');
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { World } = await import('/js/world.js');
    const { RenderSystem } = await import('/js/render-system.js');
    const render = new RenderSystem(document.getElementById('view'));
    render.resize(1440, 900);
    const world = new World(render.scene, { size: 132 });
    world.generate({ seed: 12345, mapType: 'island' });
    window.oceanPreview = { THREE, render, world };
  });
  for (const [name, position, target, sky] of [
    ['coast-day', [125, 60, 125], [10, 5, 10], 0x8fcdf5],
    ['coast-dusk', [125, 60, 125], [10, 5, 10], 0x1c1740],
    ['zoom-out', [210, 65, 210], [66, 5, 66], 0x8fcdf5],
    ['horizon', [60, 12, 60], [600, 5, 600], 0x8fcdf5],
  ]) {
    const covered = await page.evaluate(({ position, target, sky }) => {
      const { THREE, render, world } = window.oceanPreview;
      render.camera.position.set(...position);
      render.camera.lookAt(...target);
      render.fog.color.set(sky);
      render.hemi.color.set(sky);
      render.updateSky({ horizon: new THREE.Color(sky), sunColor: new THREE.Color(0xfff3d6), angle: Math.PI / 3 });
      render.render();
      // At every compass heading, open water must continue well beyond the
      // original mesh edge even with the camera next to a corner of the map.
      const ray = new THREE.Raycaster();
      return Array.from({ length: 8 }, (_, k) => {
        const angle = k * Math.PI / 4;
        const origin = new THREE.Vector3(position[0] + Math.cos(angle) * 1100, 100, position[2] + Math.sin(angle) * 1100);
        ray.set(origin, new THREE.Vector3(0, -1, 0));
        return ray.intersectObject(world.waterMesh).length > 0;
      }).every(Boolean);
    }, { position, target, sky });
    expect(covered).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  }
  expect(errors).toEqual([]);
});
