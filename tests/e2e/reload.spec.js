import { test, expect } from '@playwright/test';
test('recargar conserva la partida y salir explícitamente conserva el menú', async ({page}) => {
 await page.goto('/');await page.locator('#btnPlay').click();await page.locator('#sizeGrid [data-value="132"]').click();await page.locator('#seedInput').fill('98127');await page.locator('#btnGenerate').click();await expect(page.locator('#mapCreator')).toBeHidden();if(await page.locator('#tutorialOverlay:not(.hidden)').count())await page.locator('#skipTutorial').click();
 await page.locator('.speedBtn[data-speed="4"]').click();
 await page.reload();
 await expect(page.locator('#mainMenu')).toBeHidden();await expect(page.locator('#toast')).toContainText('Mundo restaurado');await expect(page.locator('.speedBtn[data-speed="4"]')).toHaveClass(/active/);
 expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('worldbox3d.tabSnapshot')).world.seed)).toBe(98127);
 const menu=await page.locator('#gameMenuBtn').boundingBox();const actions=await page.locator('#topActions').boundingBox();expect(menu.x).toBeLessThan(25);expect(menu.x+menu.width).toBeLessThan(actions.x);
 await page.locator('#gameMenuBtn').click();await expect(page.locator('#pauseMenu')).toBeVisible();await page.locator('#exitToMenuBtn').click();await expect(page.locator('#mainMenu')).toBeVisible();await page.reload();await expect(page.locator('#mainMenu')).toBeVisible();
 await page.locator('#btnContinue').click();await expect(page.locator('#mainMenu')).toBeHidden();await page.reload();await expect(page.locator('#toast')).toContainText('Mundo restaurado');await expect(page.locator('#mainMenu')).toBeHidden();await page.setViewportSize({width:390,height:844});const mobile=await page.locator('#gameMenuBtn').boundingBox();expect(mobile.x).toBeLessThan(20);expect(await page.locator('#gameMenuBtn').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);await page.locator('#gameMenuBtn').click();await expect(page.locator('#pauseMenu')).toBeVisible();
});
