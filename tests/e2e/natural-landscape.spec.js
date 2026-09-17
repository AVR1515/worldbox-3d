import { test, expect } from '@playwright/test';

for (const overview of [false,true]) test(`natural landscape ${overview ? 'biome overview' : 'conifers'} renders without shader errors`, async ({ page }, info) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/natural-preview', route => route.fulfill({contentType:'text/html',body:'<body style="margin:0"><canvas></canvas></body>'}));
  await page.goto('/natural-preview');
  await page.evaluate(async overview => {
    const {World} = await import('/js/world.js');
    const {DayNightCycle} = await import('/js/daynight.js');
    const {RenderSystem} = await import('/js/render-system.js');
    const render = new RenderSystem(document.querySelector('canvas'));
    render.setGraphics({quality:'high',wind:'off'});
    const world = new World(render.scene,{size:132});
    world.setGraphics({quality:'high',wind:'off'});
    world.generate({seed:7249,mapType:'continents',climate:overview?'mixto':'templado',mountainLevel:overview?1:2});
    let target = null;
    for (const [cell, rec] of world.treeSlots) {
      if (rec.kind === 'pine' && (target == null || Math.hypot(cell%world.verts-world.half,Math.floor(cell/world.verts)-world.half) < Math.hypot(target%world.verts-world.half,Math.floor(target/world.verts)-world.half))) target=cell;
    }
    if (target == null) throw Error('Missing conifer habitat');
    const [x,z] = world.gridToWorld(target%world.verts,Math.floor(target/world.verts));
    const y = world.heightAtWorld(x,z);
    render.camera.position.set(x+11, Math.max(y+4,world.heightAtWorld(x+11,z+16)+3), z+16);
    render.camera.lookAt(x,y+1,z);
    if(overview) { render.camera.position.set(0,190,1); render.camera.lookAt(0,0,0); }
    const day = new DayNightCycle({fog:render.fog,sun:render.sun,hemi:render.hemi,rig:{target:render.camera.position},renderSystem:render,dayCounterEl:{}});
    day.lockDay = true; day.update();
    world.updateVisuals(.3,render.camera); render.render();
    window.naturalPreview={world,render};
  }, overview);
  await page.screenshot({path: info.outputPath(overview?'biome-overview.png':'natural-landscape.png')});
  expect(errors).toEqual([]);
});
