import { expect, test } from '@playwright/test';

test('crea un archipiélago desde el menú del juego', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '✦ Crear nuevo mundo' }).click();
  await page.locator('#mapTypeGrid [data-value="archipelago"]').click();
  await page.locator('#sizeGrid [data-value="180"]').click();
  await page.locator('#seedInput').fill('12345');
  await page.getByRole('button', { name: /Generar y jugar/ }).click();
  await expect(page.locator('#mapCreator')).toHaveClass(/hidden/);
  if (await page.locator('#tutorialOverlay:not(.hidden)').count()) await page.locator('#skipTutorial').click();
  await page.locator('#gameMenuBtn').click();
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toContainText('Mundo guardado');
  const saved = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('worldbox3d', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('saves', 'readonly').objectStore('saves').get('current');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(JSON.parse(read.result));
    };
  }));
  expect(saved.world.mapType).toBe('archipelago');
  expect(saved.world.seed).toBe(12345);
  await page.mouse.move(720, 400);
  await page.mouse.wheel(0, 1300);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(720, 470, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.screenshot({ path: testInfo.outputPath('archipelago.png') });
  expect(errors).toEqual([]);
});
