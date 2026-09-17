import { expect, test } from '@playwright/test';

test('ciudades sin cajas y rutas compartidas conectadas por el exterior',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/city-access-preview',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0"></body>'}));
  await page.goto('/city-access-preview');
  await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {GameSession}=await import('/js/game-session.js');
    const scene=new THREE.Scene();scene.background=new THREE.Color(0xb2cfd8);
    scene.add(new THREE.HemisphereLight(0xffffff,0x61774a,2));
    const sun=new THREE.DirectionalLight(0xffefd5,2);sun.position.set(-20,60,25);scene.add(sun);
    const session=new GameSession({scene,size:96,laws:{}}),{world,settlements,civilization}=session;
    world.height.fill(8);world.jitter.fill(1);world.moisture.fill(.5);world.temperature.fill(18);world.rebuildEcology();world.buildTerrainMesh();
    for(const [i,[x,z]] of [[-22,-12],[22,-12],[0,22]].entries()){
      const empire=settlements.createEmpire();
      const city={id:i+1,x,z,level:1,pop:16,name:['Los sur','Monte luz','Bella mar'][i],empireId:empire.id,race:'human',houses:[],farms:[],resources:{wood:100,stone:100,food:100}};
      empire.capitalId=city.id;settlements.settlements.push(city);settlements._prepareSettlementGround(city,1);
      for(let k=0;k<4;k++)settlements.addHouse(city);
      const site=civilization._siteFor(city);for(const type of ['warehouse','workshop','market'])site.buildings.push({type,level:1,health:100});
    }
    for(const a of settlements.empires)for(const b of settlements.empires)if(a!==b)a.relations.set(b.id,{status:'peace'});
    civilization._rebuildBuildingVisuals();settlements._syncTradeRoutes();
    for(const route of settlements.tradeRoutes.values()){route.revealed=true;settlements._applyRouteVisibility(route);}
    settlements._flushHousePaths();
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,900);document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(45,1440/900,.1,300);camera.position.set(28,73,77);camera.lookAt(0,8,0);
    renderer.render(scene,camera);window.accessPreview={session,renderer,scene,camera};
  });
  const result=await page.evaluate(()=>{
    const {session}=window.accessPreview,{settlements,civilization}=session;
    const routes=[...settlements.tradeRoutes.values()];
    return {routes:routes.length,shared:settlements._sharedRoads.size<routes.reduce((n,r)=>n+r.meshes.length,0),
      boxes:[...civilization.buildingMeshes.values()].some(m=>m.visible&&m.count>0),
      entrances:settlements.settlements.map(s=>new Set(routes.filter(r=>r.capA===s.id||r.capB===s.id).map(r=>(r.capA===s.id?r.nodes[0]:r.nodes.at(-1)).join(','))).size)};
  });
  // Every city keeps exactly one road entrance for good, regardless of how many trade partners
  // it has or in which directions — letting each route pick its own best-facing gate (or share
  // one only within some angle/distance tolerance) still produced several separate roads out of
  // one city, reported live with screenshots as unwanted spaghetti. One shared entrance per city
  // gives every route the same anchor point to reuse instead of fresh infrastructure.
  expect(result).toEqual({routes:3,shared:true,boxes:false,entrances:[1,1,1]});expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('city-access.png')});
});
