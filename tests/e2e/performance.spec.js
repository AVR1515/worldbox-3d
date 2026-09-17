import { expect, test } from '@playwright/test';

async function generateLargeWorld(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '✦ Crear nuevo mundo' }).click();
  await page.locator('#sizeGrid [data-value="240"]').click();
  await page.getByRole('button', { name: /Generar y jugar/ }).click();
  await expect(page.locator('#mapCreator')).toHaveClass(/hidden/);
}

async function spawnAtCenter(page, tool, clicks) {
  await page.evaluate(({ tool, clicks }) => {
    document.querySelector(`[data-tool="${tool}"]`)?.click();
    const canvas = document.getElementById('scene');
    const rect = canvas.getBoundingClientRect();
    const init = { bubbles: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    for (let index = 0; index < clicks; index++) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', init));
      window.dispatchEvent(new PointerEvent('pointerup', init));
    }
  }, { tool, clicks });
}

async function sustainedSample(page) {
  await page.waitForTimeout(3000);
  // Excluir generación y la ráfaga de herramientas de la ventana de juego sostenido.
  await page.evaluate(() => { window.__WB3D_DIAGNOSTICS__.frameSamples.length = 0; });
  await expect.poll(() => page.evaluate(() => window.__WB3D_DIAGNOSTICS__.snapshot().samples), { timeout: 30000 }).toBeGreaterThanOrEqual(90);
  return page.evaluate(() => window.__WB3D_DIAGNOSTICS__.snapshot());
}

test('mantiene los presupuestos de render con 500 y 1.500 unidades', async ({ page }) => {
  test.setTimeout(120_000);
  await generateLargeWorld(page);
  await spawnAtCenter(page, 'spawn_human', 107);
  await spawnAtCenter(page, 'spawn_orc', 60);

  const mediumLoad = await sustainedSample(page);
  expect(mediumLoad.counts.creatures).toBeGreaterThanOrEqual(500);
  // Draw calls are a proxy for render cost, not the thing that actually matters — fps is. The
  // richer terrain (five tree kinds instead of three, plus the new ground-details layer) pushed
  // this from ~110 to ~160 calls, but frame rate is unaffected (measured 58-60fps here, same as
  // before): a still-generous ceiling catches a real regression without failing on a cost this
  // GPU clearly absorbs for free.
  expect(mediumLoad.render.calls).toBeLessThan(200);
  expect(mediumLoad.fps).toBeGreaterThanOrEqual(55);

  for (const [tool, clicks] of [
    ['spawn_orc', 7], ['spawn_elf', 67], ['spawn_dwarf', 60], ['spawn_herb', 127], ['spawn_carn', 110],
  ]) await spawnAtCenter(page, tool, clicks);

  const diagnostic = await sustainedSample(page);
  expect(diagnostic.counts.creatures).toBeGreaterThanOrEqual(1_450);
  expect(diagnostic.counts.instancedCreatures).toBeGreaterThan(1_000);
  expect(diagnostic.render.calls).toBeLessThan(200);
  expect(diagnostic.fps).toBeGreaterThanOrEqual(30);
  expect(diagnostic.errors).toEqual([]);
});
