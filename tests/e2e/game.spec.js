import { expect, test } from '@playwright/test';

async function openOfflineGame(page) {
  const externalRequests = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '✦ Crear nuevo mundo' })).toBeVisible();
  expect(externalRequests).toEqual([]);
}

async function readIndexedDbSave(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('worldbox3d', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('saves', 'readonly');
      const read = transaction.objectStore('saves').get('current');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result ? JSON.parse(read.result) : null);
    };
  }));
}

async function generateWorld(page, size) {
  await page.getByRole('button', { name: '✦ Crear nuevo mundo' }).click();
  await page.locator(`#sizeGrid [data-value="${size}"]`).click();
  await page.getByRole('button', { name: /Generar y jugar/ }).click();
  await expect(page.locator('#mainMenu')).toHaveClass(/hidden/);
  await expect(page.locator('#mapCreator')).toHaveClass(/hidden/);
  await expect(page.locator('#dayCounter')).toContainText('Día');
  if (await page.locator('#tutorialOverlay:not(.hidden)').count()) await page.locator('#skipTutorial').click();
  await page.locator('#gameMenuBtn').click();
  await page.locator('#saveBtn').click();
  await expect(page.locator('#toast')).toContainText('Mundo guardado');
  await page.locator('#resumeGameBtn').click();
  return readIndexedDbSave(page);
}

for (const [label, size] of [['pequeño', 132], ['mediano', 180], ['grande', 240], ['gigante', 720]]) {
  test(`genera el mundo ${label} sin depender de servicios externos`, async ({ page }) => {
    await openOfflineGame(page);
    const saved = await generateWorld(page, size);
    expect(saved.version).toBe(8);
    expect(saved.world.size).toBe(size);
    if (size === 720) {
      await page.locator('#gameMenuBtn').click();
      await page.locator('#loadBtn').click();
      await expect(page.locator('#toast')).toContainText('Mundo restaurado');
      await expect(page.locator('html')).toHaveAttribute('data-world-size', '720');
      const diagnostics = await page.evaluate(() => window.__WB3D_DIAGNOSTICS__?.snapshot());
      expect(diagnostics.errors).toEqual([]);
    }
    expect(saved.world.biome.encoding).toBe('u8-base64');
    expect(saved.world.temperature.encoding).toBe('f32-base64');
    await expect(page.locator('html')).toHaveAttribute('data-world-size', String(size));
  });
}

test('completa un ciclo de guardado y carga y publica el diagnóstico', async ({ page }) => {
  await openOfflineGame(page);
  const firstSave = await generateWorld(page, 132);
  await page.locator('#gameMenuBtn').click();
  await page.locator('#loadBtn').click();
  await expect(page.locator('#toast')).toContainText('Mundo restaurado');

  const diagnostic = await page.evaluate(() => window.__WB3D_DIAGNOSTICS__?.snapshot());
  expect(firstSave.schema.version).toBe(8);
  expect(firstSave.civilization).toBeTruthy();
  expect(diagnostic.version).toBe('0.8.0');
  expect(diagnostic.counts.simulationSteps).toBeGreaterThanOrEqual(0);
  expect(diagnostic.samples).toBeGreaterThan(0);
  expect(diagnostic.render.calls).toBeGreaterThan(0);
  expect(diagnostic.errors).toEqual([]);
});

test('migra un guardado local v2 a IndexedDB antes de continuar', async ({ page }) => {
  await openOfflineGame(page);
  const saved = await generateWorld(page, 132);
  await page.locator('#gameMenuBtn').click();
  await page.locator('#exitToMenuBtn').click();
  await expect(page.locator('#mainMenu')).toBeVisible();
  await page.evaluate(async snapshot => {
    snapshot.version = 2;
    snapshot.schema.version = 2;
    delete snapshot.ships;
    if (snapshot.creatures?.creatures?.[0]) snapshot.creatures.creatures[0].sailing = true;
    localStorage.setItem('worldbox3d.save.v2', JSON.stringify(snapshot));
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('worldbox3d', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('saves', 'readwrite');
        transaction.objectStore('saves').clear();
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      };
    });
  }, saved);

  await page.reload();
  await expect(page.getByRole('button', { name: /Continuar partida/ })).toBeVisible();
  await page.getByRole('button', { name: /Continuar partida/ }).click();
  await expect(page.locator('#toast')).toContainText('Mundo restaurado');

  const migrated = await readIndexedDbSave(page);
  expect(migrated.version).toBe(8);
  expect(migrated.ships.ships).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('worldbox3d.save.v2'))).toBeNull();
});

test('ofrece minimapa, ajustes y ranuras independientes de la fase 7', async ({ page }) => {
  await openOfflineGame(page);
  await generateWorld(page, 132);
  await expect(page.locator('#minimapWrap')).not.toHaveClass(/hidden/);

  await page.locator('#gameMenuBtn').click();
  await page.locator('#settingsBtn').click();
  await page.locator('#qualitySetting').selectOption('low');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('worldbox3d.settings')).quality)).toBe('low');

  await page.locator('#closeSettingsBtn').click();
  await page.locator('#saveManagerBtn').click();
  await page.locator('.saveSlot[data-slot="1"] [data-slot-action="save"]').click();
  await expect(page.locator('#toast')).toContainText('ranura 1');
  const slot = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('worldbox3d', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction('saves', 'readonly').objectStore('saves').get('slot:1');
      read.onerror = () => reject(read.error);
      read.onsuccess = () => resolve(read.result ? JSON.parse(read.result) : null);
    };
  }));
  expect(slot.slot.name).toBe('Mundo 1');
  expect(slot.slot.thumbnail).toMatch(/^data:image\/jpeg/);

  await page.locator('#closeSaveManagerBtn').click();
  await page.locator('#resumeGameBtn').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#gameMenuBtn').click();
  await page.locator('#settingsBtn').click();
  const mobileLayout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    panel: document.getElementById('settingsPanel').getBoundingClientRect().toJSON(),
    panelZ: Number(getComputedStyle(document.getElementById('settingsPanel')).zIndex),
    toastZ: Number(getComputedStyle(document.getElementById('toast')).zIndex),
  }));
  expect(mobileLayout.overflow).toBeLessThanOrEqual(1);
  expect(mobileLayout.panel.left).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.panel.right).toBeLessThanOrEqual(391);
  expect(mobileLayout.panelZ).toBeGreaterThan(mobileLayout.toastZ);
});

test('ejecuta todos los poderes sin errores de ejecución', async ({ page }) => {
  test.setTimeout(120_000);
  await openOfflineGame(page);
  await generateWorld(page, 132);
  const groups = {
    world: ['inspect', 'raise', 'lower', 'water', 'tree', 'biome_forest', 'biome_dry', 'biome_swamp', 'frost', 'heat', 'lava', 'erase'],
    life: ['spawn_herb', 'spawn_carn', 'spawn_fish', 'spawn_boar', 'spawn_bear', 'spawn_human', 'spawn_orc', 'spawn_elf', 'spawn_dwarf', 'spawn_dragon', 'spawn_demon', 'spawn_skeleton', 'spawn_mage', 'spawn_fairy', 'spawn_ghost', 'spawn_alien', 'zombie', 'control'],
    divine: ['heal', 'shield', 'poison', 'madness', 'curse', 'clone', 'fire', 'rain', 'lightning', 'meteor', 'earthquake', 'plague', 'tornado', 'acidrain', 'magnet', 'landmine', 'bomb', 'tnt', 'megabomb', 'nuke', 'antimatter'],
    reino: ['diplomacy'],
  };
  await page.evaluate(groupsToTest => {
    const canvas = document.getElementById('scene');
    const rect = canvas.getBoundingClientRect();
    const pointer = { bubbles: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    for (const [category, tools] of Object.entries(groupsToTest)) {
      document.querySelector(`[data-category="${category}"]`).click();
      for (const tool of tools) {
        const button = document.querySelector(`[data-tool="${tool}"]`);
        if (!button) throw new Error(`Falta el poder ${tool}`);
        button.click();
        canvas.dispatchEvent(new PointerEvent('pointerdown', pointer));
        window.dispatchEvent(new PointerEvent('pointerup', pointer));
      }
    }
  }, groups);
  await page.waitForTimeout(1_000);
  expect((await page.evaluate(() => window.__WB3D_DIAGNOSTICS__.snapshot())).errors).toEqual([]);
});

test('un humano añadido manualmente junto a una ciudad se une a ella', async ({ page }) => {
  await openOfflineGame(page);
  await generateWorld(page, 132);
  const result = await page.evaluate(() => {
    const dbg = window.__WB3D_DEBUG__;
    const canvas = document.getElementById('scene');
    const rect = canvas.getBoundingClientRect();
    const pointer = { bubbles: true, button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const clickHuman = () => {
      document.querySelector('[data-category="life"]').click();
      document.querySelector('[data-tool="spawn_human"]').click();
      canvas.dispatchEvent(new PointerEvent('pointerdown', pointer));
      window.dispatchEvent(new PointerEvent('pointerup', pointer));
    };
    // World generation may have already seeded natural villages/humans — track ids before/after
    // each click to identify exactly the two humans this test creates, not any pre-existing one.
    const humanIds = () => new Set(dbg.dumpCitizens().filter(c => c.type === 'human').map(c => c.id));
    // First click with no settlement nearby — learn where this screen position actually lands
    // in world space (whatever the aerial camera happens to be framing), then plant a synthetic
    // settlement right there before clicking again.
    const before1 = humanIds();
    clickHuman();
    const strayId = [...humanIds()].find(id => !before1.has(id));
    const stray = dbg.dumpCitizens().find(c => c.id === strayId);
    const settlements = dbg.__TEMP_getSettlements();
    const empire = settlements.createEmpire();
    const city = {
      id: settlements.nextSettlementId++, x: stray.x, z: stray.z, level: 1, pop: 0, empireId: empire.id,
      race: 'human', name: 'Prueba', houses: [], farms: [], loyalty: 100, growTimer: 999, emptyTimer: 0,
      resources: { wood: 100, food: 100, stone: 100, gold: 0, gems: 0 },
    };
    settlements.settlements.push(city);
    empire.capitalId = city.id;
    const before2 = humanIds();
    clickHuman();
    const joinedId = [...humanIds()].find(id => !before2.has(id));
    const citizens = dbg.dumpCitizens().filter(c => c.type === 'human');
    return { strayId, joinedId, cityId: city.id, citizens };
  });
  const stray = result.citizens.find(c => c.id === result.strayId);
  const joined = result.citizens.find(c => c.id === result.joinedId);
  expect(stray?.settlementId).toBeNull();
  expect(joined).toBeTruthy();
  expect(joined.settlementId).toBe(result.cityId);
});
