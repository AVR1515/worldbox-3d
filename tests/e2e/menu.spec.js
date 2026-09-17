import { test, expect } from '@playwright/test';
test('menú y creador renovados funcionan en escritorio y móvil',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#btnContinue')).toBeDisabled();
 await page.locator('#btnOptionsMenu').click();
 await expect(page.locator('#settingsPanel')).toBeVisible();
 await page.locator('#closeSettingsBtn').click();
 await page.locator('#btnHelpMenu').click();
 await expect(page.locator('#helpModal')).toBeVisible();
 await page.goto('/');
 await page.locator('#btnPlay').click();
 await expect(page.locator('#waterGrid')).toHaveCount(0);
 await expect(page.locator('#climateGrid .optionBtn')).toHaveCount(3);
 await page.locator('#climateGrid [data-value="mixto"]').click();
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#btnGenerate')).toBeVisible();
 const width=await page.locator('#mapCreator .menuCard').evaluate(e=>e.getBoundingClientRect().right);
 expect(width).toBeLessThanOrEqual(390);
});
