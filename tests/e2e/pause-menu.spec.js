import { test, expect } from '@playwright/test';
async function start(page){await page.goto('/');await page.locator('#btnPlay').click();await page.locator('#sizeGrid [data-value="132"]').click();await page.locator('#btnGenerate').click();await expect(page.locator('#mapCreator')).toBeHidden();if(await page.locator('#tutorialOverlay:not(.hidden)').count())await page.locator('#skipTutorial').click();}
test('pausa, ajustes completos, guardado y regreso al inicio',async({page})=>{
 await start(page);
 await page.locator('.speedBtn[data-speed="2"]').click();
 await page.keyboard.press('Escape');
 await expect(page.locator('#pauseMenu')).toBeVisible();
 await expect(page.locator('.speedBtn[data-speed="0"]')).toHaveClass(/active/);
 await expect(page.locator('#topActions #saveBtn')).toHaveCount(0);
 await page.locator('#settingsBtn').click();
 const rect=await page.locator('#settingsPanel').boundingBox();expect(rect.x).toBe(0);expect(rect.width).toBe(1440);
 await page.locator('[data-settings-tab="accessibility"]').click();await expect(page.locator('#contrastSetting')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#settingsPanel')).toBeHidden();await expect(page.locator('#pauseMenu')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#pauseMenu')).toBeHidden();await expect(page.locator('.speedBtn[data-speed="2"]')).toHaveClass(/active/);
 await page.locator('#gameMenuBtn').click();await page.locator('#saveBtn').click();await expect(page.locator('#toast')).toContainText('Mundo guardado');
 await page.locator('#saveManagerBtn').click();await expect(page.locator('#saveManagerPanel')).toBeVisible();await page.keyboard.press('Escape');
 await page.locator('#regenBtn').click();await expect(page.locator('#mapCreator')).toBeVisible();await page.locator('#btnBack').click();await expect(page.locator('#pauseMenu')).toBeVisible();
 await page.locator('#exitToMenuBtn').click();await expect(page.locator('#mainMenu')).toBeVisible();await expect(page.locator('#btnContinue')).toBeEnabled();
 await page.locator('#btnContinue').click();await expect(page.locator('#mainMenu')).toBeHidden();await expect(page.locator('#pauseMenu')).toBeHidden();
});
test('subcategorías, paneles centrados y ajustes móviles',async({page})=>{
 await start(page);
 await page.getByRole('button',{name:'Biomas',exact:true}).click();await expect(page.locator('[data-tool="tree"]')).toBeVisible();await expect(page.locator('[data-tool="raise"]')).toBeHidden();
 await page.locator('#empiresBtn').click();const box=await page.locator('#empiresPanel').boundingBox();expect(Math.abs(box.x+box.width/2-720)).toBeLessThan(2);
 await page.keyboard.press('Escape');await page.locator('#settingsBtn').click();await page.setViewportSize({width:390,height:844});
 await page.locator('[data-settings-tab="simulation"]').click();await expect(page.locator('#autosaveSetting')).toBeVisible();const rect=await page.locator('#settingsPanel').boundingBox();expect(rect.width).toBe(390);expect(rect.height).toBe(844);
});
