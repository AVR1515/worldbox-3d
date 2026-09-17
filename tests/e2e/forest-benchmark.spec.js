import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

test('perfil reproducible del archipiélago con árboles', async ({ page }, testInfo) => {
  test.skip(!process.env.WB3D_FOREST_BENCHMARK, 'Opt-in GPU benchmark');
  const duration = Number(process.env.WB3D_SAMPLE_MS || 60000);
  const warmup = Number(process.env.WB3D_WARMUP_MS || 15000);
  const repetitions = Number(process.env.WB3D_REPETITIONS || 3);
  const variants = (process.env.WB3D_VARIANTS || 'full').split(',');
  test.setTimeout((duration * repetitions + warmup + 15000) * variants.length + 120000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/forest-benchmark', route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0"><canvas></canvas></body>' }));
  await page.goto('/forest-benchmark');
  await page.evaluate(async () => {
    const { RenderSystem } = await import('/js/render-system.js');
    const { World } = await import('/js/world.js');
    const { CreatureManager } = await import('/js/creatures.js');
    const { GameRuntime } = await import('/js/game-runtime.js');
    let seed = 12345;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({ quality: 'high' });
    render.sun.position.set(60, 100, 40);
    const world = new World(render.scene, { size: 180, laws: { naturalRegrowth: false } });
    world.generate({ seed: 12345, mapType: 'archipelago', mountainLevel: 1 });
    const creatures = new CreatureManager(render.scene, world, { laws: { aging: false, hunger: false, reproduction: false, disease: false } });
    for (const [type, count] of [['herbivore', 9], ['carnivore', 3], ['fish', 15]]) {
      let made = 0;
      for (let z = 5; z < world.size - 5 && made < count; z++) for (let x = 5; x < world.size - 5 && made < count; x++) {
        if (world.isWater(x, z) !== (type === 'fish')) continue;
        if (creatures.spawn(type, ...world.gridToWorld(x, z))) made++;
      }
    }
    render.camera.position.set(100, 120, 160); render.camera.lookAt(0, 5, 0);
    const runtime = new GameRuntime({ world, creatures });
    runtime.profileSystems = true;
    const gl = render.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const b = window.forestBenchmark = { render, world, creatures, runtime, samples: [], gpuSamples: [], queries: [], recording: false, speed: 1,
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), gpuTimingAvailable: !!timer };
    let last = performance.now();
    function frame(now) {
      const dt = (now - last) / 1000; last = now;
      const start = performance.now(); runtime.update(dt, b.speed);
      const simulationMs = performance.now() - start;
      const visualStart = performance.now(); runtime.updateVisuals(Math.min(dt, .1), render.camera);
      if (world.treeRenderer) world.treeRenderer.group.visible = !b.hideTrees;
      else for (const set of Object.values(world.treeMeshes)) set.trunk.visible = !b.hideTrees;
      const visualMs = performance.now() - visualStart;
      if (timer) {
        if (gl.getParameter(timer.GPU_DISJOINT_EXT)) { for (const q of b.queries) gl.deleteQuery(q); b.queries.length = 0; }
        while (b.queries.length && gl.getQueryParameter(b.queries[0], gl.QUERY_RESULT_AVAILABLE)) {
          const q = b.queries.shift(); const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(q); if (b.recording) b.gpuSamples.push(ms);
        }
      }
      const q = timer && b.recording && b.queries.length < 4 ? gl.createQuery() : null;
      if (q) gl.beginQuery(timer.TIME_ELAPSED_EXT, q);
      const renderStart = performance.now(); render.render(); const renderCpuMs = performance.now() - renderStart;
      if (q) { gl.endQuery(timer.TIME_ELAPSED_EXT); b.queries.push(q); }
      if (b.adaptive) render.updateFrameBudget(dt);
      if (b.recording) b.samples.push({ frameMs: dt * 1000, simulationMs, visualMs, renderCpuMs,
        triangles: render.renderer.info.render.triangles, calls: render.renderer.info.render.calls });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
  await expect.poll(() => page.evaluate(() => Object.values(window.forestBenchmark.world.treeMeshes).every(s => s.asset))).toBe(true);
  const reports = [];
  for (const variant of variants) {
    await page.evaluate(variant => {
      const b = window.forestBenchmark;
      const settings = { quality: 'high', shadows: variant !== 'no-shadows', ambientOcclusion: false,
        bloom: variant !== 'no-post', antialias: variant !== 'no-post', resolution: variant === 'low-resolution' ? '0.75' : '1', dynamicResolution: variant === 'adaptive' };
      b.render.setGraphics(settings); b.world.setGraphics(settings); b.speed = variant === 'paused' ? 0 : 1;
      b.hideTrees = variant === 'no-trees';
      b.adaptive = variant === 'adaptive';
      for (const s of Object.values(b.world.treeMeshes)) s.trunk.visible = !b.world.treeRenderer && variant !== 'no-trees';
      if (b.world.treeRenderer) b.world.treeRenderer.group.visible = variant !== 'no-trees';
    }, variant);
    await page.waitForTimeout(warmup);
    for (let repetition = 0; repetition < repetitions; repetition++) {
      await page.evaluate(() => {
        const b = window.forestBenchmark; b.samples = []; b.gpuSamples = [];
        b.start = performance.now(); b.initial = b.runtime.snapshot(); b.recording = true;
      });
      await page.waitForTimeout(duration);
      const report = await page.evaluate(() => {
        const b = window.forestBenchmark; b.recording = false;
        const quantiles = values => {
          values.sort((a, b) => a - b);
          const p = n => values[Math.max(0, Math.ceil(values.length * n) - 1)] ?? null;
          return { median: p(.5), p95: p(.95), p99: p(.99) };
        };
        const elapsed = (performance.now() - b.start) / 1000;
        return { gpu: b.gpu, browser: navigator.userAgent, pixelRatio: b.render.renderer.getPixelRatio(),
          buffer: [b.render.renderer.domElement.width, b.render.renderer.domElement.height], trees: b.world.treeSlots.size,
          creatures: b.creatures.creatures.length, frames: b.samples.length, elapsed,
          droppedSeconds: b.runtime.snapshot().droppedSeconds - b.initial.droppedSeconds,
          simulatedRealRatio: (b.runtime.snapshot().simulatedSeconds - b.initial.simulatedSeconds) / elapsed,
          gpuTimingAvailable: b.gpuTimingAvailable, gpuMs: quantiles(b.gpuSamples),
          ...Object.fromEntries(['frameMs', 'simulationMs', 'visualMs', 'renderCpuMs', 'triangles', 'calls'].map(k => [k, quantiles(b.samples.map(s => s[k]))])) };
      });
      expect(report.frames).toBeGreaterThan(0);
      reports.push({ variant, repetition, ...report });
      console.log(JSON.stringify(reports.at(-1)));
    }
    await page.screenshot({ path: testInfo.outputPath(`forest-${variant}.png`) });
  }
  expect(errors).toEqual([]);
  const label = (process.env.WB3D_FOREST_BENCHMARK || 'sample').replace(/[^a-zA-Z0-9_-]/g, '_');
  await mkdir('docs/evidence', { recursive: true });
  await writeFile(`docs/evidence/forest-${label}.json`, JSON.stringify(reports, null, 2));
  await page.screenshot({ path: `docs/evidence/forest-${label}.png` });
});
