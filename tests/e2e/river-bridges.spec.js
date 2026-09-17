import { expect, test } from '@playwright/test';

test('río encajado en el terreno y puente transitable con barandillas',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/bridge-preview',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));
  await page.goto('/bridge-preview');
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {GameSession}=await import('/js/game-session.js');
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xb7d4dc);
    scene.add(new THREE.HemisphereLight(0xffffff,0x668052,2.2));
    const sun=new THREE.DirectionalLight(0xfff4dc,2.5);sun.position.set(-10,30,15);scene.add(sun);
    const session=new GameSession({scene,size:48,laws:{}}),{world,settlements}=session;
    world.jitter.fill(1);world.moisture.fill(.6);world.temperature.fill(18);
    for(let z=0;z<=world.size;z++)for(let x=0;x<=world.size;x++){
      const i=world.idx(x,z),bank=8-(z-24)*.025,offset=Math.sin((z-24)*.17)*1.2;
      const d=Math.abs(x-24-offset);
      world.height[i]=bank-Math.max(0,1-d/3)*.7;
      if(d<1.5){world.riverMask[i]=1;world.riverHeight[i]=bank-.18;}
    }
    world.rebuildEcology();world.buildTerrainMesh();world.buildRiverMesh();
    const route={nodes:Array.from({length:29},(_,i)=>[i-14,0]),group:new THREE.Group(),revealed:true};
    settlements.tradeRoutes.set('preview',route);settlements._layoutRoute(route);settlements._flushHousePaths();
    const human=session.creatures.spawn('human',0,0);if(human)session.creatures._updateInstance(human);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,900);document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(45,1440/900,.1,200);camera.position.set(12,17,17);camera.lookAt(0,7.6,0);
    renderer.render(scene,camera);
    return {bridges:world._bridges.length,deck:world.bridgeHeightAtWorld(0,0),water:world.riverSurfaceAtWorld(0,0),humanY:human?.y,vertices:settlements.bridgeMesh.geometry.attributes.position.count};
  });
  expect(result.bridges).toBe(1);expect(result.deck).toBeGreaterThan(result.water+.25);expect(result.humanY).toBeCloseTo(result.deck);
  expect(result.vertices).toBeGreaterThan(1000);expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('river-bridge.png')});
});
