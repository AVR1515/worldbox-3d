import { expect, test } from '@playwright/test';

test('20 ciclos de crear, guardar, cargar y destruir liberan los recursos exclusivos', async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.route('**/lifecycle-preview', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/lifecycle-preview');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({ quality: 'ultra' });
    render.camera.position.set(35, 45, 35); render.camera.lookAt(0, 0, 0);
    const baselineChildren = render.scene.children.length;
    const metrics = [];
    const laws = { aging: false, hunger: false, reproduction: false, disease: false, naturalDisasters: false };
    const keys = ['world', 'creatures', 'settlements', 'ships', 'civilization', 'cataclysms'];
    for (let cycle = 0; cycle < 25; cycle++) {
      const session = new GameSession({ scene: render.scene, size: 32, laws });
      session.world.generate({ seed: 41, mapType: 'island', mountainLevel: 0 });
      session.creatures.spawn('human', 0, 0);
      session.runtime.updateVisuals(1, render.camera); render.render();
      if (cycle === 0) await new Promise(resolve => setTimeout(resolve, 3000));
      const saved = JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key => [key, session[key].serialize()]))));
      session.dispose();
      const restored = new GameSession({ scene: render.scene, size: 32, laws });
      for (const key of keys) restored[key].restore(saved[key]);
      restored.statuses.syncFromCreatures();
      restored.runtime.update(1 / 30, 1);
      restored.runtime.updateVisuals(1, render.camera); render.render();
      restored.dispose(); render.render();
      await new Promise(requestAnimationFrame);
      if (cycle >= 5) metrics.push({ ...render.renderer.info.memory, children: render.scene.children.length });
    }
    return { baselineChildren, metrics };
  });
  await testInfo.attach('world-lifecycle.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.metrics).toHaveLength(20);
  for (const metric of result.metrics) expect(metric.children).toBe(result.baselineChildren);
  for (const metric of result.metrics.slice(-5)) {
    expect(metric.geometries).toBeLessThanOrEqual(result.metrics[0].geometries + 2);
    expect(metric.textures).toBeLessThanOrEqual(result.metrics[0].textures + 2);
  }
});
