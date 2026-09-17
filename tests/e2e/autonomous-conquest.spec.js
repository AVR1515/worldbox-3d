import { test, expect } from '@playwright/test';

// Fase B/C, "Guerra": B-07/C-11 (docs/HISTORIAL-PROGRESO.md) ran real sustained war for 150
// simulated seconds across 6 benchmark repetitions and never saw a city fall on its own -
// documented honestly as "conquest as a purely autonomous outcome remains unconfirmed", not as a
// failure, since tests/e2e/war-journey.spec.js already proves siege -> breach -> conquest works
// when driven forward by hand (_updateSieges()). This test answers the open question directly:
// is 150s just not enough time, or is autonomous conquest structurally blocked?
//
// js/settlements.js's raiseSoldiers() only mobilizes 2-4 villagers per call, which is what
// B-07/C-11's single setup call produced. Calling it repeatedly (still through the normal,
// unmodified mobilization path - no code changed, no state poked directly) raises a much larger
// force, isolating "not enough soldiers" from other possible explanations without touching any
// game mechanic. Everything after that - marching, targeting, siege proximity, wall breach,
// clearing defenders, capture - runs purely through runtime.update() ticks, same as any real
// game session; nothing here calls _updateSieges()/captureSettlement() directly.
test('la conquista ocurre sola, sin fases forzadas, cuando el ejército atacante es lo bastante grande', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/autonomous-conquest', route => route.fulfill({ contentType: 'text/html', body: '<canvas></canvas>' }));
  await page.goto('/autonomous-conquest');
  const result = await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { GameSession } = await import('/js/game-session.js');
    const { populateMatureWorld } = await import('/tests/fixtures/mature-world.js');
    let seed = 777;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const render = new RenderSystem(document.querySelector('canvas'));
    const laws = { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: true, rebellions: false, naturalDisasters: false };
    const session = new GameSession({ scene: render.scene, size: 132, laws });
    const { empires } = populateMatureWorld(session, 240);
    session.settlements.declareWar(empires[0], empires[1]);
    session.settlements.makePeace = () => false;
    for (let i = 0; i < 25; i++) session.settlements.raiseSoldiers(empires[0], empires[1]);
    session.civilization._syncArmies(0);

    const targetId = session.civilization.armies.get(empires[0].id)?.targetSettlementId;
    const target = () => session.settlements.settlements.find(s => s.id === targetId);
    const startOwner = target()?.empireId;
    const resourcesValid = () => session.settlements.settlements.every(s => Object.values(s.resources).every(n => Number.isFinite(n) && n >= 0));

    const trace = [];
    // "conquered" means captureSettlement() actually changed ownership - not the target
    // disappearing entirely (a house-by-house wipeout via _damageBuildings, a different outcome
    // this test isn't after). Track that possibility separately instead of conflating the two.
    let conquered = false, conqueredAtMinute = null, corruptAt = null, targetDestroyed = false;
    const totalMinutes = 15, ticksPerMinute = 30 * 60;
    for (let minute = 0; minute < totalMinutes && !conquered && !targetDestroyed; minute++) {
      for (let i = 0; i < ticksPerMinute; i++) {
        session.runtime.update(1 / 30, 1);
        if (!corruptAt && !resourcesValid()) corruptAt = `minuto ${minute + 1}`;
      }
      const t = target();
      if (!t) { targetDestroyed = true; }
      else if (t.empireId !== startOwner) { conquered = true; conqueredAtMinute = minute; }
      const site = t ? session.civilization._siteFor(t) : null;
      trace.push({
        minute: minute + 1,
        wallsBreached: !!t?.wallsBreached,
        siegeHealth: site?.siegeHealth ?? null,
        targetOwner: t?.empireId ?? null,
        targetExists: !!t,
      });
    }
    return { startOwner, conquered, conqueredAtMinute, corruptAt, targetDestroyed, trace, finalOwner: target()?.empireId ?? null };
  });
  await testInfo.attach('autonomous-conquest.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.corruptAt).toBeNull();
  expect(result.targetDestroyed).toBe(false);
  expect(result.conquered).toBe(true);
  // Observed at minute 2 with this seed; generous margin above that for any legitimate variance.
  expect(result.conqueredAtMinute).toBeLessThan(10);
  expect(result.finalOwner).not.toBe(result.startOwner);
  expect(errors).toEqual([]);
});
