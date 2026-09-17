import { expect, test } from '@playwright/test';

test('renderiza un lago elevado con salida continua hasta el mar', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  // A blank same-origin fixture avoids running a second game/render loop.
  await page.route('**/river-preview', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
  }));
  await page.goto('/river-preview');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { World, CONFIG } = await import('/js/world.js');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ecada);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x527044, 2.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(-25, 60, 30); scene.add(sun);
    const world = new World(scene, { size: 96 });
    world.jitter.fill(1);
    for (let z = 0; z <= world.size; z++) {
      for (let x = 0; x <= world.size; x++) {
        const d = Math.hypot(x - 48, z - 48);
        world.height[world.idx(x, z)] = Math.max(2, 15 - Math.max(0, d - 5) * 0.35);
        world.moisture[world.idx(x, z)] = 0.6;
      }
    }
    world.rebuildEcology();
    world.buildTerrainMesh();
    world.buildWaterMesh();
    const surface = world._lakeSurface(48, 48, 4);
    const trail = world._traceDownhillTrail(48, 48, 0, surface, 1.8);
    world.floodWater(48, 48, 4);
    world.buildRiverMesh();
    const [mx, mz] = trail.at(-1);
    const camera = new THREE.PerspectiveCamera(45, 1440 / 900, 0.1, 400);
    const direction = new THREE.Vector3(mx - 48, 0, mz - 48).normalize();
    camera.position.copy(direction.clone().multiplyScalar(67)).add(new THREE.Vector3(-direction.z * 28, 58, direction.x * 28));
    camera.lookAt(direction.clone().multiplyScalar(9).add(new THREE.Vector3(0, 6, 0)));
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 900);
    renderer.setPixelRatio(1);
    document.body.appendChild(renderer.domElement);
    renderer.render(scene, camera);
    const result = {
      wet: trail.every(([x, z]) => world.isWater(x, z)),
      source: world.riverHeight[world.idx(48, 48)],
      mouth: world.height[world.idx(mx, mz)],
      sea: CONFIG.WATER_LEVEL,
      triangles: world.riverMesh.geometry.index.count / 3,
    };
    return result;
  });
  expect(result.wet).toBe(true);
  expect(result.source).toBeGreaterThan(result.sea + 8);
  expect(result.mouth).toBeLessThan(result.sea);
  expect(result.triangles).toBeGreaterThan(50);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mountain-lake.png') });
});
