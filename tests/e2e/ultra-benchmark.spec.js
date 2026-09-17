import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Opt-in: the normal regression suite must not silently run a long GPU benchmark.
for (const population of (process.env.WB3D_POPULATIONS || process.env.WB3D_POPULATION || '500').split(',').map(Number)) {
test(`perfil Ultra reproducible con GPU declarada y aislamiento de AO (${population})`, async ({ page }, testInfo) => {
  test.skip(!process.env.WB3D_BENCHMARK, 'Activar con WB3D_BENCHMARK=1');
  const warmup = Number(process.env.WB3D_WARMUP_MS || 30000);
  const duration = Number(process.env.WB3D_SAMPLE_MS || 120000);
  const repetitions = Number(process.env.WB3D_REPETITIONS || 3);
  const scenario = process.env.WB3D_SCENARIO || 'island';
  const mature = scenario === 'mature' || scenario === 'forest-cities';
  const forestTerrain = scenario === 'forest-cities';
  const aoResolutions = (process.env.WB3D_AO_RESOLUTIONS || '1,0.5').split(',').map(Number);
  const worldSize = Number(process.env.WB3D_WORLD_SIZE || (population === 1500 ? 240 : 132));
  // C-08: isolate render-cost categories by toggling existing graphics controls, and optionally
  // time each simulation subsystem, instead of guessing which one to optimize next.
  const profileSystems = process.env.WB3D_PROFILE_SYSTEMS === '1';
  const shadows = process.env.WB3D_SHADOWS !== '0';
  const ambientOcclusionOn = process.env.WB3D_AO !== '0';
  const bloom = process.env.WB3D_BLOOM !== '0';
  const antialias = process.env.WB3D_AA !== '0';
  const quality = process.env.WB3D_QUALITY || 'ultra';
  const adaptive = process.env.WB3D_ADAPTIVE === '1';
  // B-07/C-11: the C-03-C-10 chain only ever measured/optimized mature-flat-peace. War is the
  // heaviest documented gap in the Ultra objectives table (combat AI targeting, sieges,
  // projectiles, corpse cleanup on top of the usual load) — measure it instead of assuming C-09/
  // C-10 generalize.
  const war = process.env.WB3D_WAR === '1';
  // Fase C, continuación de B-07/C-11: disasters are the other documented gap in the Ultra
  // objectives table — every C-07-C-10 measurement used naturalDisasters:false. Force a rotating
  // sequence of moderate disasters near the 4 cities on a fixed interval instead of waiting on
  // _naturalDisaster()'s 100-240s autonomous timer, same reasoning as WB3D_WAR forcing war instead
  // of waiting on random diplomacy rolls.
  const disasters = process.env.WB3D_DISASTERS === '1';
  // C-13 follow-up: the in-game speed control (steps [0,1,2,4], js/main.js) runs GameRuntime's
  // fixed-step clock faster than real time, which can pack multiple simulation steps into one
  // rendered frame (see js/game-runtime.js's maxStepsPerFrame catch-up) — measure that instead of
  // only ever benchmarking at the default speed=1.
  const gameSpeed = Number(process.env.WB3D_SPEED || 1);
  test.setTimeout((warmup + duration + 15000) * repetitions * 2 + 120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const reports = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    for (const ambientOcclusionResolution of aoResolutions) {
      const ambientOcclusion = ambientOcclusionOn;
      await page.route('**/ultra-benchmark', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
      await page.goto('/ultra-benchmark');
      await page.evaluate(async ({ ambientOcclusion, ambientOcclusionResolution, population, worldSize, mature, forestTerrain, profileSystems, shadows, bloom, antialias, war, disasters, quality, adaptive, gameSpeed }) => {
        const { RenderSystem } = await import('/js/render-system.js');
        const { World } = await import('/js/world.js');
        const { CreatureManager } = await import('/js/creatures.js');
        const { GameRuntime } = await import('/js/game-runtime.js');
        const { GameSession } = await import('/js/game-session.js');
        const { populateMatureWorld } = await import('/tests/fixtures/mature-world.js');
        const { populateMatureWorldOnTerrain } = await import('/tests/fixtures/mature-world-forest.js');
        let seed = 12345;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const render = new RenderSystem(document.querySelector('canvas'));
        render.setGraphics({ quality, ambientOcclusion, ambientOcclusionResolution, bloom, antialias, shadows, dynamicResolution: adaptive });
        // declareWar()/raiseSoldiers() are no-ops unless the diplomacy law is on (js/settlements.js)
        // - flip it on for war runs. makePeace overridden below so the random peace-chance roll
        // updateDiplomacy() makes every tick can't end the war before the measurement window does
        // (same fix as tests/e2e/war-journey.spec.js's autonomous-march test).
        const laws = { aging: false, hunger: false, reproduction: false, disease: false, diplomacy: war, rebellions: false, naturalDisasters: disasters };
        const session = mature ? new GameSession({ scene: render.scene, size: worldSize, laws }) : null;
        const world = session?.world || new World(render.scene, { size: worldSize });
        // forest-cities: real generated terrain (hills/forest/rivers) instead of the flattened
        // mature-world.js reference plane, so vegetation/shadow cost and city cost are measured
        // together instead of in isolation (neither prior benchmark chain covered both at once).
        if (forestTerrain) world.generate({ seed: 12345, mapType: 'island', mountainLevel: 1, humidity: 'normal' });
        world.setGraphics({ quality });
        let triggerDisaster = null;
        if (mature) {
          const { cities, empires } = forestTerrain ? populateMatureWorldOnTerrain(session, population) : populateMatureWorld(session, population);
          if (war) {
            session.settlements.declareWar(empires[0], empires[1]);
            session.settlements.makePeace = () => false;
            session.settlements.raiseSoldiers(empires[0], empires[1]);
            session.settlements.raiseSoldiers(empires[1], empires[0]);
            session.civilization._syncArmies(0);
          }
          if (disasters && cities.length) {
            // Moderate magnitude, cycled across all 4 cities instead of one large hit repeated on
            // the same city — a wiped-out settlement mid-run would shrink population/complexity
            // and confound the very load this is meant to measure.
            const actions = [
              () => session.cataclysms.earthquake(cities[0].x, cities[0].z, 8, 0.8),
              () => session.cataclysms.detonate(cities[1].x + 2, cities[1].z, { radius: 2, damageRadius: 3, craterDepth: -2 }),
              () => { const [gx, gz] = world.worldToGrid(cities[2].x - 4, cities[2].z); world.meteorImpact(gx, gz, 1.2); session.creatures.killAllInRadius(cities[2].x - 4, cities[2].z, 2); },
              () => session.cataclysms.earthquake(cities[3].x, cities[3].z, 8, 0.8),
            ];
            let nextAction = 0;
            triggerDisaster = () => { actions[nextAction % actions.length](); nextAction++; };
          }
        }
        else world.generate({ seed: 12345, mapType: 'island', mountainLevel: 0 });
        const creatures = session?.creatures || new CreatureManager(render.scene, world, { laws });
        const groups = population === 1500
          ? [['human', 320], ['elf', 200], ['orc', 200], ['dwarf', 180], ['herbivore', 355], ['fish', 245]]
          : [['human', 300], ['elf', 200]];
        for (const [type, count] of mature ? [] : groups) {
          let made = 0;
          for (let z = 5; z < world.size - 5 && made < count; z++) for (let x = 5; x < world.size - 5 && made < count; x++) {
            if (world.isWater(x, z) !== (type === 'fish')) continue;
            if (creatures.spawn(type, ...world.gridToWorld(x, z))) made++;
          }
        }
        render.camera.position.set(worldSize * 100 / 132, worldSize * 120 / 132, worldSize * 100 / 132);
        render.camera.lookAt(0, 0, 0);
        const runtime = session?.runtime || new GameRuntime({ world, creatures });
        runtime.profileSystems = profileSystems;
        creatures.profileDetail = profileSystems;
        const gl = render.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const state = window.benchmark = {
          render, world, creatures, runtime, session, samples: [], longTasks: [], recording: false,
          gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          pixelRatio: render.renderer.getPixelRatio(), disasterCount: 0,
        };
        if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
          new PerformanceObserver(list => { if (state.recording) state.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ type: 'longtask' });
        }
        // Fires from t=0 (active through warmup too, same as how war is declared before warmup
        // starts) and every 20 simulated seconds after, so the sample window always finds the
        // "disaster aftermath" (re-pathing, damaged buildings) already steady rather than starting
        // mid-recording.
        let disasterTimer = 0;
        if (triggerDisaster) { triggerDisaster(); state.disasterCount++; }
        let last = performance.now();
        function frame(now) {
          const dt = (now - last) / 1000; last = now;
          if (triggerDisaster) {
            disasterTimer += dt;
            if (disasterTimer >= 20) { disasterTimer = 0; triggerDisaster(); state.disasterCount++; }
          }
          const start = performance.now(); runtime.update(dt, gameSpeed);
          const simulationMs = performance.now() - start;
          const visualStart = performance.now(); runtime.updateVisuals(Math.min(dt, 0.1), render.camera);
          const visualMs = performance.now() - visualStart;
          const renderStart = performance.now(); render.render();
          if (state.recording) state.samples.push({ frameMs: dt * 1000, simulationMs, visualMs, renderCpuMs: performance.now() - renderStart, calls: render.renderer.info.render.calls, triangles: render.renderer.info.render.triangles, systemTimings: runtime.lastSystemTimings, creatureTimings: creatures.lastDetailTimings });
          if (adaptive) render.updateFrameBudget(dt);
          requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      }, { ambientOcclusion, ambientOcclusionResolution, population, worldSize, mature, forestTerrain, profileSystems, shadows, bloom, antialias, war, disasters, quality, adaptive, gameSpeed });
      await page.waitForTimeout(warmup);
      await page.evaluate(() => {
        const b = window.benchmark;
        b.start = performance.now(); b.initial = b.runtime.snapshot(); b.recording = true;
      });
      await page.waitForTimeout(duration);
      const report = await page.evaluate(({ profileSystems, war, disasters, population }) => {
        const b = window.benchmark; b.recording = false;
        const elapsed = (performance.now() - b.start) / 1000;
        const quantiles = field => {
          const values = b.samples.map(s => s[field]).sort((a, b) => a - b);
          const p = n => values[Math.max(0, Math.ceil(values.length * n) - 1)];
          return { median: p(.5), p95: p(.95), p99: p(.99) };
        };
        const systemQuantiles = profileSystems ? Object.fromEntries(
          ['world', 'creatures', 'settlements', 'civilization', 'statuses', 'cataclysms', 'ships'].map(name => {
            const values = b.samples.map(s => s.systemTimings?.[name] ?? 0).sort((a, b) => a - b);
            const p = n => values[Math.max(0, Math.ceil(values.length * n) - 1)];
            return [name, { median: p(.5), p95: p(.95), p99: p(.99) }];
          })
        ) : undefined;
        const creatureQuantiles = profileSystems ? Object.fromEntries(
          ['navQueue', 'navQueueLength', 'settlementIndex', 'spatialRebuild', 'decide', 'mainLoop', 'cleanup', 'projectiles'].map(name => {
            const values = b.samples.map(s => s.creatureTimings?.[name] ?? 0).sort((a, b) => a - b);
            const p = n => values[Math.max(0, Math.ceil(values.length * n) - 1)];
            return [name, { median: p(.5), p95: p(.95), p99: p(.99) }];
          })
        ) : undefined;
        return { gpu: b.gpu, browser: navigator.userAgent, pixelRatio: b.render.renderer.getPixelRatio(), creatures: b.creatures.creatures.length,
          cities: b.session?.settlements.settlements.length || 0,
          houses: b.session?.settlements.settlements.reduce((sum, s) => sum + s.houses.length, 0) || 0,
          buildings: b.session ? [...b.session.civilization.productionSites.values()].reduce((sum, s) => sum + s.buildings.length, 0) : 0,
          heapBytes: performance.memory?.usedJSHeapSize ?? null,
          longTasks: { count: b.longTasks.length, totalMs: b.longTasks.reduce((sum, n) => sum + n, 0), maxMs: Math.max(0, ...b.longTasks) },
          simulatedRealRatio: (b.runtime.snapshot().simulatedSeconds - b.initial.simulatedSeconds) / elapsed,
          droppedSeconds: b.runtime.snapshot().droppedSeconds - b.initial.droppedSeconds,
          elapsed, frames: b.samples.length, frameMs: quantiles('frameMs'), simulationMs: quantiles('simulationMs'), visualMs: quantiles('visualMs'), renderCpuMs: quantiles('renderCpuMs'), calls: quantiles('calls'), triangles: quantiles('triangles'),
          ...(systemQuantiles ? { systemMs: systemQuantiles } : {}),
          ...(creatureQuantiles ? { creatureMs: creatureQuantiles } : {}),
          ...(war ? {
            // Sanity-checks this also functions as an autonomous-war soak test, not just a
            // benchmark: casualties confirm combat actually happened, cityOwners confirms whether
            // any settlement actually changed hands during the sample window.
            casualties: population - b.creatures.creatures.length,
            cityOwners: b.session.settlements.settlements.map(s => s.empireId),
          } : {}),
          ...(disasters ? {
            // Sanity-checks disasters actually ran (not just declared): count of forced events,
            // and total houses remaining across all cities as evidence of real, accumulating damage.
            disasterCount: b.disasterCount,
            housesRemaining: b.session.settlements.settlements.reduce((sum, s) => sum + s.houses.length, 0),
          } : {}) };
      }, { profileSystems, war, disasters, population });
      expect(report.frames).toBeGreaterThan(0);
      if (mature) { expect(report.cities).toBeGreaterThan(0); if (!disasters) expect(report.houses).toBeGreaterThanOrEqual(56); }
      // Combat casualties (war) and cataclysm deaths (disasters) both shrink creatures.creatures -
      // only the plain peace scenario keeps the exact spawned population.
      if (war || disasters) expect(report.creatures).toBeLessThanOrEqual(population);
      else expect(report.creatures).toBe(population);
      const scenarioLabel = forestTerrain ? 'forest-cities' : mature ? (war ? 'mature-flat-war' : disasters ? 'mature-flat-disasters' : 'mature-flat-peace') : 'island-creatures';
      reports.push({ scenario: scenarioLabel, quality, adaptive, repetition, ambientOcclusion, ambientOcclusionResolution, shadows, bloom, antialias, population, worldSize, warmup, duration, ...report });
      await testInfo.attach(`ultra-${repetition}-${ambientOcclusionResolution}.json`, { body: JSON.stringify(reports.at(-1), null, 2), contentType: 'application/json' });
      await writeFile(testInfo.outputPath('ultra-report.json'), JSON.stringify(reports, null, 2));
      console.log(`Muestra ${population}/${repetition}/${ambientOcclusionResolution}: p95=${report.frameMs.p95.toFixed(1)} ms; simulación/real=${report.simulatedRealRatio.toFixed(3)}`);
    }
  }
  await testInfo.attach('ultra-report.json', { body: JSON.stringify(reports, null, 2), contentType: 'application/json' });
  await writeFile(testInfo.outputPath('ultra-report.json'), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports));
});
}
