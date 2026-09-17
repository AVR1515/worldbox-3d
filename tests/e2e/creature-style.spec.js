import {test,expect} from '@playwright/test';

test('all species render with the same low-poly art direction',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/creature-style-preview',r=>r.fulfill({contentType:'text/html',body:'<body style="margin:0;background:#e3ddd0;font-family:Segoe UI,sans-serif"></body>'}));
  await page.goto('/creature-style-preview');
  const result=await page.evaluate(async()=>{
    const THREE=await import('/node_modules/three/build/three.module.js');
    const {buildCreatureModel}=await import('/js/models.js');
    const entries=[['human','Humano'],['orc','Orco'],['elf','Elfo'],['dwarf','Enano'],['mage','Mago'],['fairy','Hada'],['zombie','Zombi'],['skeleton','Esqueleto'],['demon','Demonio'],['ghost','Fantasma'],['alien','Alien'],['dragon','Dragón'],['herbivore','Ciervo'],['carnivore','Lobo'],['boar','Jabalí'],['bear','Oso'],['fish','Pez'],['human','Humana']];
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1440,900);renderer.setScissorTest(true);document.body.appendChild(renderer.domElement);
    const result=[];
    for(const [i,[type,label]] of entries.entries()){
      const scene=new THREE.Scene();scene.background=new THREE.Color(i%2?0xded9ce:0xe8e2d6);
      scene.add(new THREE.HemisphereLight(0xffffff,0x8b8671,2));
      const sun=new THREE.DirectionalLight(0xffeed6,2.5);sun.position.set(-3,5,4);scene.add(sun);
      const built=buildCreatureModel(type,i===17?'f':'m');scene.add(built.root);
      const camera=new THREE.OrthographicCamera(-1.05,1.05,1.31,-1.31,.1,30);camera.position.set(1.7,1.6,4);camera.lookAt(0,.75,0);
      renderer.setViewport(i%6*240,600-Math.floor(i/6)*300,240,300);renderer.setScissor(i%6*240,600-Math.floor(i/6)*300,240,300);renderer.render(scene,camera);
      const name=document.createElement('div');name.textContent=label;name.style.cssText=`position:absolute;left:${i%6*240}px;top:${Math.floor(i/6)*300+264}px;width:240px;text-align:center;color:#454b43;font-size:19px;font-weight:600`;document.body.appendChild(name);
      result.push(built.root.userData.style);
    }
    return result;
  });
  expect(result).toEqual(Array(18).fill('low-poly'));expect(errors).toEqual([]);
  await page.screenshot({path:testInfo.outputPath('creature-lineup.png')});
  await page.screenshot({path:'docs/evidence/creature-lineup.png'});
});
